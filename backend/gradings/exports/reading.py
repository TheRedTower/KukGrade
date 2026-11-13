"""How an export reads what it prints, and which candidates it may hold.

A file of many records is read in many queries; between two of them a mark
could be corrected or a comment added. Read in one repeatable-read
transaction, every query sees the grading as it stood at the first, so a file
never shows half a change. Nothing is locked: marking goes on while a file is
made, and the file shows the moment it started.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager

from django.core.exceptions import ValidationError
from django.db import connection, transaction
from django.db.models import QuerySet

from gradings.models import GradingCandidate, GradingSession, candidate_order

NOT_IN_SESSION = "This candidate is not registered in this grading."


@contextmanager
def snapshot() -> Iterator[None]:
    """One transaction in which every read sees the same moment.

    The isolation level can only be set as a transaction's first statement,
    so only an outermost one is set; a caller already inside a transaction
    (a test, a shell) reads under its own.
    """
    outermost = not connection.in_atomic_block
    with transaction.atomic():
        if outermost:
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        yield


def chosen_candidates(
    session: GradingSession,
    ids: Sequence[int],
    candidates: QuerySet[GradingCandidate],
    refusal: Callable[[GradingCandidate], str | None],
) -> list[GradingCandidate]:
    """The candidates `ids` names, read with `candidates`' joins, in the
    grading's own order (not the order they were ticked).

    All or nothing: when any cannot be included, nothing is, and the refusal
    names each by id with why - one not in this session, or one `refusal`
    gives a reason for.
    """
    found = {
        candidate.pk: candidate
        for candidate in candidates.filter(session=session, pk__in=ids).order_by(
            *candidate_order()
        )
    }
    errors: dict[str, list[str]] = {}
    for pk in ids:
        candidate = found.get(pk)
        reason = NOT_IN_SESSION if candidate is None else refusal(candidate)
        if reason:
            errors[str(pk)] = [reason]
    if errors:
        raise ValidationError(errors)
    return list(found.values())
