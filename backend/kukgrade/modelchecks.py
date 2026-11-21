"""Validating a row for a write that happens on every tap.

`Model.full_clean()` checks the fields, then asks the database, one statement each,
whether every foreign key exists and whether every UNIQUE and CHECK constraint holds
(a SAVEPOINT, a SELECT and a RELEASE for each). The write itself is then checked
again by the database, so on a path that writes dozens of times a minute that is
dozens of statements spent learning what the INSERT or UPDATE would say anyway.

`clean_without_database_checks` runs what is Python's to judge (field types and
choices, and the model's own `clean()`) and leaves the rest to the constraints and
foreign keys, which stay the authority: a row that breaks one is refused by the
database, never saved. Use it only where the service that writes the row already
decides every value, so a refusal here would be a defect, not a user's mistake.
"""

from __future__ import annotations

from collections.abc import Iterable

from django.db import models
from django.db.models import Q


def clean_without_database_checks(instance: models.Model) -> None:
    relations = [field.name for field in instance._meta.fields if field.is_relation]
    instance.full_clean(
        exclude=relations,
        validate_unique=False,
        validate_constraints=False,
    )


def changed_since_saved(
    instance: models.Model,
    fields: Iterable[str],
    *,
    saved_where: Q | None = None,
) -> list[str]:
    """Which of `fields` differ from the row as saved: the one statement of a
    model's "frozen once recorded" fields. Empty for a row not saved yet, and
    for one whose saved copy does not match `saved_where` (a final decision
    is frozen, a proposal is not)."""
    if instance._state.adding or instance.pk is None:
        return []
    saved = type(instance)._base_manager.filter(pk=instance.pk)
    if saved_where is not None:
        saved = saved.filter(saved_where)
    values = saved.values(*fields).first()
    if values is None:
        return []
    return sorted(
        field for field, value in values.items() if getattr(instance, field) != value
    )
