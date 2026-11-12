from __future__ import annotations

from collections.abc import Callable, Sequence

from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction
from psycopg import errors as pg_errors


def each_independently[T, R](
    rows: Sequence[T],
    action: Callable[[T], R],
    *,
    key: Callable[[T], int],
    codes: dict[str, set[str]] | None = None,
) -> tuple[list[R], dict[str, list[str]]]:
    """Apply `action` to every row, each in its own savepoint.

    The shared shape of every bulk endpoint: one row's refusal never blocks
    the others. A refusal is a ValidationError - including the one uniqueness
    race a service expects, which that service translates itself - and the
    savepoint rolls back whatever the row had written. Any other exception is
    a real failure and aborts the whole batch. Returns what succeeded plus a
    map of each refused row's id (`key`: the record the row names, such as
    its student or candidate) to its error messages, so a client names the
    row by what it sent rather than by its position.
    `.messages` flattens dict- and list-shaped ValidationErrors alike.
    When `codes` is given, it is filled with each failed row's error codes,
    for a caller that must tell one kind of refusal from the rest.
    """
    done: list[R] = []
    errors: dict[str, list[str]] = {}
    for row in rows:
        try:
            with transaction.atomic():
                done.append(action(row))
        except ValidationError as exc:
            # A record named twice is refused under its one id, once per reason.
            named = str(key(row))
            errors[named] = list(dict.fromkeys([*errors.get(named, []), *exc.messages]))
            if codes is not None:
                codes[named] = codes.get(named, set()) | error_codes(exc)
    return done, errors


def error_codes(exc: ValidationError) -> set[str]:
    """Every code in a dict- or list-shaped ValidationError."""
    found: set[str] = set()
    if hasattr(exc, "error_dict"):
        for errors in exc.error_dict.values():
            found.update(error.code for error in errors if error.code)
    else:
        found.update(error.code for error in exc.error_list if error.code)
    return found


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
