"""Student create and update, with audit recording.

Kept in one layer with the audit calls inline, the same shape as
gradings/services.py's create_grading_session / apply_candidate_update: a
thin function per action rather than recording scattered across serializers.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from django.db import transaction

from accounts.models import User
from audit.models import AuditAction
from audit.recording import record
from ranks.models import Rank
from students.models import Student


def _snapshot(student: Student) -> dict[str, Any]:
    return {
        "first_name": student.first_name,
        "last_name": student.last_name,
        "date_of_birth": str(student.date_of_birth),
        "current_rank": student.current_rank.code,
        "status": student.status,
    }


@transaction.atomic
def create_student(
    *,
    wksa_id: str,
    first_name: str,
    last_name: str,
    date_of_birth: date,
    current_rank: Rank,
    status: str | None = None,
    actor: User | None = None,
) -> Student:
    student = Student.objects.create(
        wksa_id=wksa_id,
        first_name=first_name,
        last_name=last_name,
        date_of_birth=date_of_birth,
        current_rank=current_rank,
        **({"status": status} if status is not None else {}),
    )
    record(
        AuditAction.STUDENT_CREATED,
        student,
        f"Student {student} created.",
        actor=actor,
    )
    return student


@transaction.atomic
def update_student(
    student: Student,
    *,
    first_name: str | None = None,
    last_name: str | None = None,
    date_of_birth: date | None = None,
    current_rank: Rank | None = None,
    status: str | None = None,
    actor: User | None = None,
) -> Student:
    # Read fresh from the database rather than snapshotting `student` as
    # received: Django admin's own save flow constructs the new field
    # values onto this exact instance before save_model() ever runs, so a
    # comparison against the argument as-is would always see the new value
    # on both sides. The API path is unaffected, since DRF passes the
    # unmodified instance.
    persisted = Student.objects.get(pk=student.pk)
    before = _snapshot(persisted)
    status_changing = status is not None and status != persisted.status

    if first_name is not None:
        student.first_name = first_name
    if last_name is not None:
        student.last_name = last_name
    if date_of_birth is not None:
        student.date_of_birth = date_of_birth
    if current_rank is not None:
        student.current_rank = current_rank
    if status is not None:
        student.status = status
    student.save()

    after = _snapshot(student)
    if before == after:
        # A no-op PATCH (resending the same values) writes nothing: an audit
        # trail exists to show what changed, and nothing did.
        return student

    # One event per call, not one per changed field and not both a generic
    # and a specific event for the same edit. A status change is the more
    # specific fact whenever it happens, even alongside other field changes,
    # so it is what gets recorded; that same event's metadata still carries
    # every field that moved.
    if status_changing:
        record(
            AuditAction.STUDENT_STATUS_CHANGED,
            student,
            (
                f"Student {student} status changed from "
                f"{before['status']} to {after['status']}."
            ),
            actor=actor,
            metadata={"before": before, "after": after},
        )
    else:
        record(
            AuditAction.STUDENT_UPDATED,
            student,
            f"Student {student} updated.",
            actor=actor,
            metadata={"before": before, "after": after},
        )
    return student
