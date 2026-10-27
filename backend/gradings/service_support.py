from __future__ import annotations

from collections.abc import Callable, Sequence

from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction
from psycopg import errors as pg_errors


def each_independently[T, R](
    rows: Sequence[T],
    action: Callable[[T], R],
) -> tuple[list[R], dict[str, list[str]]]:
    """Apply `action` to every row, each in its own savepoint.

    The shared shape of every bulk endpoint: one row's refusal never blocks
    the others. A refusal is a ValidationError - including the one uniqueness
    race a service expects, which that service translates itself - and the
    savepoint rolls back whatever the row had written. Any other exception is
    a real failure and aborts the whole batch. Returns what
    succeeded plus a map of row index to that row's error messages.
    `.messages` flattens dict- and list-shaped ValidationErrors alike.
    """
    done: list[R] = []
    errors: dict[str, list[str]] = {}
    for index, row in enumerate(rows):
        try:
            with transaction.atomic():
                done.append(action(row))
        except ValidationError as exc:
            errors[str(index)] = exc.messages
    return done, errors


def unique_violation_on(exc: IntegrityError, model: type[models.Model]) -> bool:
    """Whether `exc` broke a unique constraint on `model`'s own table.

    That is the one integrity error a create expects - another request
    creating the same record first - so it becomes a domain error. Anything
    else is a real defect and propagates as itself rather than being
    reported as a duplicate.
    """
    cause = exc.__cause__
    return (
        isinstance(cause, pg_errors.UniqueViolation)
        and cause.diag.table_name == model._meta.db_table
    )
