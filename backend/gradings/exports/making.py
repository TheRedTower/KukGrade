"""How every export is made: read as one moment, its candidates chosen all
or nothing, and audited once.

A file of many records is read in many queries; between two of them a mark
could be corrected or a comment added. Read in one repeatable-read
transaction, every query sees the grading as it stood at the first, so a file
never shows half a change. Nothing is locked: marking goes on while a file is
made, and the file shows the moment it started.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass

from django.core.exceptions import ValidationError
from django.db import connection, transaction
from django.db.models import QuerySet

from accounts.models import User
from accounts.people import name_of, person_label, title_of
from audit.recording import record
from gradings.exports import pdf
from gradings.models import GradingCandidate, GradingSession, candidate_order

# Each refusal is said of a candidate the screen names beside it.
NOT_IN_SESSION = "Not registered in this grading."


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


@dataclass(frozen=True)
class Exported:
    """A file made, and what to call it."""

    document: pdf.Document
    content: bytes


def made_by(actor: User) -> str:
    """Who made a file, as the foot of each page names them."""
    return person_label(name_of(actor), title_of(actor))


def audit_export(
    action: str,
    session: GradingSession,
    summary: str,
    candidates: Sequence[GradingCandidate],
    actor: User,
) -> None:
    """One event for the file, whatever it holds: everyone in it by WKSA ID,
    never by name, and their ids so each one's history finds it."""
    record(
        action,
        session,
        summary,
        actor=actor,
        metadata={
            "session_id": session.pk,
            "candidates": [candidate.student.wksa_id for candidate in candidates],
            "candidate_ids": [candidate.pk for candidate in candidates],
            "student_ids": [candidate.student_id for candidate in candidates],
        },
    )
