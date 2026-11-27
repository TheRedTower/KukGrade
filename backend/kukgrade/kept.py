"""Records kept as written: refused a change or a delete, alone or in bulk.

A model states its refusal once - `refusal_field`, `change_refused`,
`delete_refused` - and its queryset gives the same refusal to
`QuerySet.update()` and `QuerySet.delete()`, which never call a model's
`save()` or `delete()`. A model that keeps only some rows (a finalised
outcome, not a proposed one) says which with `kept_rows()` and `is_kept()`.

The database holds the same line (`kept_triggers`), so `psql`, raw SQL or a
later migration is refused too, not only the ORM.

The few services that change or remove kept rows on purpose say so through
`bypass_update`, `bypass_delete` or `bypassing`, each with its reason, which
is logged; a test keeps the list of modules that may (`kukgrade/test_kept.py`).
A row declared `deleted_with` its parent (a comment, a mark change) goes with
it through Django's cascade, and the database checks only that the parent
went too; a cascade onto any other kept row is refused, by both.
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import Iterator, Sequence
from typing import Any, ClassVar, TypeVar, cast

import pgtrigger
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import Q

_Kept = TypeVar("_Kept", bound="KeptModel")
logger = logging.getLogger(__name__)


class KeptModel(models.Model):
    refusal_field: ClassVar[str]
    change_refused: ClassVar[str]
    delete_refused: ClassVar[str]
    # A saved row is never saved again: comments, mark changes, audit events.
    final_once_saved: ClassVar[bool] = False

    class Meta:
        abstract = True

    def save(self, *args: Any, **kwargs: Any) -> None:
        if self.final_once_saved and not self._state.adding:
            raise self.refusal(self.change_refused)
        self.check_before_save()
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        if self.is_kept():
            raise self.refusal(self.delete_refused)
        return super().delete(*args, **kwargs)

    @classmethod
    def refusal(cls, message: str) -> ValidationError:
        return ValidationError({cls.refusal_field: [message]})

    @classmethod
    def kept_rows(cls) -> Q | None:
        """The rows kept, as a filter; None for every row."""
        return None

    def is_kept(self) -> bool:
        return True

    def check_before_save(self) -> None:
        self.full_clean()


class KeptQuerySet(models.QuerySet[_Kept, _Kept]):
    def _refuse_if_kept(self, message: str) -> None:
        model = cast(type[KeptModel], self.model)
        rows = model.kept_rows()
        if rows is None or self.filter(rows).exists():
            raise model.refusal(message)

    def update(self, **kwargs: Any) -> int:
        self._refuse_if_kept(cast(type[KeptModel], self.model).change_refused)
        return super().update(**kwargs)

    def delete(self) -> tuple[int, dict[str, int]]:
        self._refuse_if_kept(cast(type[KeptModel], self.model).delete_refused)
        return super().delete()


# --------------------------------------------------------------------------
# The same line in the database
# --------------------------------------------------------------------------

NO_UPDATE = "kept_no_update"
NO_DELETE = "kept_no_delete"
# A new row under a kept one (a mark added to a decided grading).
NO_INSERT = "kept_no_insert"
GOES_WITH_PARENT = "kept_goes_with_parent"


class _AllOf(pgtrigger.Condition):
    """Every condition at once (pgtrigger's Q and AnyChange do not combine)."""

    def __init__(self, *conditions: pgtrigger.Condition) -> None:
        self.conditions = conditions

    def resolve(self, model: type[models.Model]) -> str:
        # pgtrigger's resolve() is untyped; each returns its SQL.
        parts = [cast(Any, condition).resolve(model) for condition in self.conditions]
        # Wrapped whole: the trigger's WHEN takes one parenthesised condition.
        return "(" + " AND ".join(f"({part})" for part in parts) + ")"


class _GoesWithParent(pgtrigger.Trigger):
    """Refuse, at the commit, deleting a row whose parent is still there."""

    def __init__(self, *, parent_field: str) -> None:
        self.parent_field = parent_field
        super().__init__(
            name=GOES_WITH_PARENT,
            when=pgtrigger.After,
            operation=pgtrigger.Delete,
            timing=pgtrigger.Deferred,
        )

    def get_func(self, model: models.Model) -> str:
        field = model._meta.get_field(self.parent_field)
        parent = cast(type[models.Model], field.related_model)._meta
        return (
            f'IF EXISTS (SELECT 1 FROM "{parent.db_table}" '
            f'WHERE "{parent.pk.column}" = OLD."{cast(Any, field).column}") '
            "THEN RAISE EXCEPTION 'kukgrade: % rows are kept, and go only with "
            "what they belong to', TG_TABLE_NAME; END IF; RETURN NULL;"
        )


def kept_triggers(
    *,
    kept_rows: pgtrigger.Condition | None = None,
    fields: Sequence[str] = (),
    exclude: Sequence[str] = (),
    deleted_with: str | None = None,
) -> list[pgtrigger.Trigger]:
    """The database's refusal of a change or a delete, as the model's own.

    `kept_rows` limits both to the rows kept (a finalised outcome), as
    `KeptModel.kept_rows` does. `fields` or `exclude` limit a change to the
    columns kept, as `changed_since_saved` does; neither means every column.
    `deleted_with` names the foreign key of a row that goes with its parent:
    deleting it is checked at the commit, and refused only if the parent is
    still there. No bypass passes that check, so such a row goes only with
    its parent.
    """
    if deleted_with is not None and kept_rows is not None:
        msg = "A row kept only in some states cannot also go only with its parent."
        raise ValueError(msg)
    changed: pgtrigger.Condition = (
        pgtrigger.AnyChange(*fields, exclude=list(exclude))
        if fields or exclude
        else pgtrigger.Condition("OLD.* IS DISTINCT FROM NEW.*")
    )
    triggers: list[pgtrigger.Trigger] = [
        pgtrigger.Protect(
            name=NO_UPDATE,
            operation=pgtrigger.Update,
            condition=_AllOf(kept_rows, changed) if kept_rows else changed,
        ),
    ]
    if deleted_with is None:
        triggers.append(
            pgtrigger.Protect(
                name=NO_DELETE,
                operation=pgtrigger.Delete,
                condition=kept_rows,
            ),
        )
    else:
        triggers.append(_GoesWithParent(parent_field=deleted_with))
    return triggers


# --------------------------------------------------------------------------
# The sanctioned ways past both
# --------------------------------------------------------------------------


@contextlib.contextmanager
def bypassing(*models_: type[models.Model], reason: str) -> Iterator[None]:
    """Let the database change, remove or add to kept rows of `models_` (every
    kept model when none is named) for the length of the block. `reason` says
    why, beside the call; the allowlist test reads where it is used."""
    if not reason.strip():
        msg = "Say why the kept records are being changed."
        raise ValueError(msg)
    uris = [
        f"{model._meta.app_label}.{model.__name__}:{name}"
        for model in models_
        for name in (NO_UPDATE, NO_DELETE, NO_INSERT)
        if any(t.name == name for t in getattr(model._meta, "triggers", ()))
    ]
    logger.info(
        "Kept records of %s changed on purpose: %s",
        ", ".join(model.__name__ for model in models_) or "every kept model",
        reason,
    )
    if models_ and not uris:
        # Nothing to let past: pgtrigger.ignore() with no names would
        # otherwise let every trigger past.
        yield
        return
    # The block runs in its own savepoint: pgtrigger resets its setting on the
    # way out with one more query, which in a transaction a failed statement
    # had aborted would replace that statement's error with its own.
    with pgtrigger.ignore(*uris), transaction.atomic():
        yield


def bypass_update(queryset: models.QuerySet[Any], *, reason: str, **fields: Any) -> int:
    """Change kept rows on purpose, past the queryset's and the database's
    refusal."""
    with bypassing(queryset.model, reason=reason):
        return models.QuerySet.update(queryset, **fields)


def bypass_delete(
    queryset: models.QuerySet[Any],
    *,
    reason: str,
) -> tuple[int, dict[str, int]]:
    """Remove kept rows on purpose, past the queryset's and the database's
    refusal. Not for a row that goes only with its parent: the database
    checks that at the commit, past any bypass."""
    triggers = getattr(queryset.model._meta, "triggers", ())
    if any(trigger.name == GOES_WITH_PARENT for trigger in triggers):
        msg = f"{queryset.model.__name__} goes only with what it belongs to."
        raise ValueError(msg)
    with bypassing(queryset.model, reason=reason):
        return models.QuerySet.delete(queryset)
