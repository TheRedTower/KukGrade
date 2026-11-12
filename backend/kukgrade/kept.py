"""Records kept as written: refused a change or a delete, alone or in bulk.

A model states its refusal once - `refusal_field`, `change_refused`,
`delete_refused` - and its queryset gives the same refusal to
`QuerySet.update()` and `QuerySet.delete()`, which never call a model's
`save()` or `delete()`. A model that keeps only some rows (a finalised
outcome, not a proposed one) says which with `kept_rows()` and `is_kept()`.

The cleanup services that remove rows on purpose call the unbound base
`models.QuerySet.delete`. Django's cascade from a deleted parent passes both,
by design: a comment goes with its assessment.
"""

from __future__ import annotations

from typing import Any, ClassVar, TypeVar, cast

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

_Kept = TypeVar("_Kept", bound="KeptModel")


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
