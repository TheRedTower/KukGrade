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

from django.db import models


def clean_without_database_checks(instance: models.Model) -> None:
    relations = [field.name for field in instance._meta.fields if field.is_relation]
    instance.full_clean(
        exclude=relations,
        validate_unique=False,
        validate_constraints=False,
    )
