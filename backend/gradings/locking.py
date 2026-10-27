"""The grading lock protocol.

Every grading write takes its row locks in one order, inside one transaction:

1. Grading sessions, in ascending id. A session's lock coordinates everything
   inside it: nothing locks or changes a session's candidates, assessments,
   items or outcomes without holding it first.
2. Then the session's own rows, and any students - students always in
   ascending id, because a student is the one row two sessions share.

Validation happens after the locks, against rows re-read under them, never
against the instance a caller passed in: a view loaded that before the
transaction began, and Django admin has already written its form onto it.

A lock first taken inside a savepoint is released when that savepoint rolls
back (PostgreSQL 17; one taken before it is kept). A bulk operation therefore
takes every session and student lock it will need before its first row's
savepoint, or one failed row would leave the rest of the batch unprotected.

Why whole-session locks rather than a lock per row: the rules that matter span
rows - a completed assessment has every required item assessed, a locked
session has every candidate complete, a rank rollback undoes the student's
latest promotion. Locking each row on its own cannot make those checks atomic.
Contention is not a concern at this scale: a session's writes
are single-row edits that finish in milliseconds.

Every lock is taken by a query that joins nothing, and a row is read with its
joins only once it is locked - see lock_students() for what goes wrong
otherwise. Locks that `select_related` picked up incidentally, in no
particular order, were removed; these are deliberate, ordered and explicit.
"""

from __future__ import annotations

from collections.abc import Collection, Iterable

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import QuerySet

from gradings.models import GradingSession
from students.models import Student

SESSION_GONE_MESSAGE = "This grading session no longer exists."
STUDENT_GONE_MESSAGE = "This student no longer exists."


def lock_sessions(session_ids: Iterable[int]) -> dict[int, GradingSession]:
    """Lock every session given, in ascending id. One that is gone is absent."""
    return {
        session.pk: session
        for session in GradingSession.objects.select_for_update()
        .filter(pk__in=set(session_ids))
        .order_by("pk")
    }


def lock_session(session_id: int) -> GradingSession:
    session = lock_sessions([session_id]).get(session_id)
    if session is None:
        raise ValidationError({"session": [SESSION_GONE_MESSAGE]})
    return session


def lock_students(student_ids: Iterable[int]) -> dict[int, Student]:
    """Lock every student given, in ascending id. One that is gone is absent.

    Locked with a bare query and only then read with its rank joined. A
    FOR UPDATE that waits re-checks its whole WHERE and join against the row
    as the other transaction left it: a student whose rank a promotion has
    just moved no longer matches the rank row the join first read, and
    PostgreSQL silently drops them from the result. Once the lock is held
    nothing can move them, so the second read is safe.
    """
    wanted = set(student_ids)
    list(
        Student.objects.select_for_update()
        .filter(pk__in=wanted)
        .order_by("pk")
        .values_list("pk", flat=True),
    )
    return {
        student.pk: student
        for student in Student.objects.select_related("current_rank").filter(
            pk__in=wanted,
        )
    }


def lock_student(student_id: int) -> Student:
    student = lock_students([student_id]).get(student_id)
    if student is None:
        raise ValidationError({"student": [STUDENT_GONE_MESSAGE]})
    return student


def _session_id_on(row: models.Model, session_path: str) -> object:
    value: object = row
    for step in session_path.split("__"):
        value = getattr(value, step)
    return value


def lock_in_session[M: models.Model](
    queryset: QuerySet[M],
    pk: int,
    *,
    session_path: str,
    name: str,
    also_lock: Collection[int] = (),
) -> M:
    """Lock the session a row belongs to, then the row itself, re-read.

    Which session that is comes from an unlocked read, so it is confirmed on
    the locked row: a candidate moved to another session in between would
    otherwise be changed under the wrong session's lock. `also_lock` adds
    sessions to take in the same ascending pass - the one a candidate is
    moving to.

    The row is locked with a bare query and read with `queryset`'s joins
    afterwards, for the reason lock_students() gives.
    """
    manager = queryset.model._default_manager
    found = manager.filter(pk=pk).values_list(session_path, flat=True).first()
    if found is not None:
        wanted = {found, *also_lock}
        if len(lock_sessions(wanted)) != len(wanted):
            raise ValidationError({"session": [SESSION_GONE_MESSAGE]})
        # Without the cleared ordering, a model whose Meta.ordering runs
        # through its session and student - a candidate, assessment or
        # outcome - joined both, and FOR UPDATE locked every joined row: the
        # student was locked as a side effect, in row order rather than
        # ascending, and callers came to rely on it without saying so (audit
        # D1). OF self keeps it to this row whatever the query becomes; a
        # caller that needs the student locks it explicitly.
        locked = (
            manager.select_for_update(of=("self",))
            .filter(pk=pk)
            .order_by()
            .values_list("pk")
            .first()
        )
        row = queryset.filter(pk=pk).first() if locked is not None else None
        if row is not None:
            if _session_id_on(row, session_path) == found:
                return row
            raise ValidationError(
                {
                    name: [
                        f"This {name} was moved to another grading session "
                        "while the change was being made. Reload and try again.",
                    ],
                },
            )
    raise ValidationError({name: [f"This {name} no longer exists."]})


def lock_sessions_of(
    model: type[models.Model],
    pks: Iterable[int],
    session_path: str,
) -> dict[int, int]:
    """Lock the sessions of many rows at once, before a bulk operation starts.

    Returns each row's session id, for the rows now pinned to a session this
    transaction holds. A row left out was deleted, or moved to a session that
    was not locked, before the locks were taken: the bulk operation reports
    it rather than locking that session out of order mid-batch.
    """
    wanted = list(pks)
    manager = model._default_manager
    held = lock_sessions(
        manager.filter(pk__in=wanted).values_list(session_path, flat=True),
    )
    return {
        pk: session_id
        for pk, session_id in manager.filter(pk__in=wanted).values_list(
            "pk",
            session_path,
        )
        if session_id in held
    }


def require_pinned(pk: int, pinned: Collection[int], name: str) -> None:
    """Refuse a bulk row whose session `lock_sessions_of` did not pin."""
    if pk not in pinned:
        raise ValidationError(
            {
                name: [
                    f"This {name} changed while the change was being made - it "
                    "was removed or moved to another grading session. Reload "
                    "and try again.",
                ],
            },
        )


__all__ = [
    "STUDENT_GONE_MESSAGE",
    "lock_in_session",
    "lock_session",
    "lock_sessions",
    "lock_sessions_of",
    "lock_student",
    "lock_students",
    "require_pinned",
]
