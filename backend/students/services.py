"""Student create and update, with audit recording.

Kept in one layer with the audit calls inline, the same shape as
gradings/services.py's create_grading_session / apply_candidate_update: a
thin function per action rather than recording scattered across serializers.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from django.core.exceptions import ValidationError
from django.db import models, transaction

from accounts.models import User
from audit.models import AuditAction
from audit.recording import record
from gradings.locking import lock_sessions, lock_student
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
    # Only `student`'s id is used. The API loaded it before this transaction
    # began, and Django admin has already written its form onto it, so
    # saving it as received wrote back every field another edit changed in
    # the meantime (KG-A12). The requested changes go onto the locked row -
    # the same student lock promotion and rank rollback take.
    locked = lock_student(student.pk)
    before = _snapshot(locked)

    if first_name is not None:
        locked.first_name = first_name
    if last_name is not None:
        locked.last_name = last_name
    if date_of_birth is not None:
        locked.date_of_birth = date_of_birth
    if current_rank is not None:
        locked.current_rank = current_rank
    if status is not None:
        locked.status = status
    # The same normalising clean() that save() runs, so a resent value that
    # only differs by surrounding whitespace still counts as unchanged.
    locked.full_clean()

    after = _snapshot(locked)
    if before == after:
        # A no-op PATCH (resending the same values) writes nothing at all -
        # no row update and no audit event.
        return locked
    locked.save()

    # One event per call, not one per changed field and not both a generic
    # and a specific event for the same edit. A status change is the more
    # specific fact whenever it happens, even alongside other field changes,
    # so it is what gets recorded; that same event's metadata still carries
    # every field that moved.
    if before["status"] != after["status"]:
        record(
            AuditAction.STUDENT_STATUS_CHANGED,
            locked,
            (
                f"Student {locked} status changed from "
                f"{before['status']} to {after['status']}."
            ),
            actor=actor,
            metadata={"before": before, "after": after},
        )
    else:
        record(
            AuditAction.STUDENT_UPDATED,
            locked,
            f"Student {locked} updated.",
            actor=actor,
            metadata={"before": before, "after": after},
        )
    return locked


@transaction.atomic
def delete_student(student: Student, actor: User) -> None:
    """Hard-delete a student, for corruption or test-data cleanup only.

    GradingCandidate.student and Promotion.student are both PROTECT, so
    nothing cascades automatically - every grading-session registration,
    assessment, outcome and promotion involving this student is removed
    explicitly, in dependency order, before the student row itself can go:
    Promotion (blocks Promotion.outcome, a PROTECT one-to-one) before
    CandidateOutcome, before GradingCandidate (whose CASCADE then takes
    CandidateAssessment/CandidateAssessmentItem with it). Promotion and a
    finalised CandidateOutcome both refuse ordinary bulk delete - the same
    sanctioned bypass as delete_candidate_assessment
    (gradings/services.py) is used here: models.QuerySet.delete, the real
    unbound base implementation, called directly. Unlike a single
    assessment's cascade, no "is this still the student's most recent
    promotion" check applies: every promotion this student has is being
    removed together, so there is no surviving promotion it could still
    supersede.

    LegacyGradingRecord.student is nullable but PROTECT - it is independent
    historical evidence of an imported workbook, not the student's own
    record, so it is unlinked (student set to null) via
    gradings.legacy_services.unlink_legacy_record_from_student, never
    deleted.
    """
    from gradings.legacy_services import unlink_legacy_record_from_student
    from gradings.models import (
        CandidateOutcome,
        GradingCandidate,
        LegacyGradingRecord,
        Promotion,
    )

    # Sessions before the student, as every grading write takes them
    # (gradings/locking.py). This deletes rows inside each of the student's
    # sessions, and a promotion holding one of those sessions takes the
    # student last: locking the student first here is how the two came to
    # wait on each other.
    sessions = set(
        GradingCandidate.objects.filter(student_id=student.pk).values_list(
            "session_id",
            flat=True,
        ),
    )
    lock_sessions(sessions)
    locked = lock_student(student.pk)
    registered_since = (
        set(
            GradingCandidate.objects.filter(student=locked).values_list(
                "session_id",
                flat=True,
            ),
        )
        - sessions
    )
    if registered_since:
        # Registered into another session in the moment between reading the
        # sessions and taking the locks. That session is not locked, and
        # locking it now would break the order, so start again instead.
        raise ValidationError(
            {
                "student": [
                    "This student was registered for another grading while "
                    "being deleted. Try again.",
                ],
            },
        )

    cascaded_candidates = list(
        GradingCandidate.objects.filter(student=locked).values_list(
            "id",
            "session_id",
            "session__title",
        ),
    )
    promotion_count = models.QuerySet.delete(
        Promotion.objects.filter(student=locked),
    )[0]
    outcome_count = CandidateOutcome.objects.filter(
        candidate__student=locked,
    ).delete()[0]
    models.QuerySet.delete(GradingCandidate.objects.filter(student=locked))

    legacy_records = list(LegacyGradingRecord.objects.filter(student=locked))
    for legacy_record in legacy_records:
        unlink_legacy_record_from_student(legacy_record, actor=actor)

    record(
        AuditAction.STUDENT_DELETED,
        locked,
        f"Student {locked} permanently deleted.",
        actor=actor,
        metadata={
            "wksa_id": locked.wksa_id,
            "cascaded_grading_candidates": [
                {"id": candidate_id, "session_id": session_id, "session_title": title}
                for candidate_id, session_id, title in cascaded_candidates
            ],
            "cascaded_promotions": promotion_count,
            "cascaded_outcomes": outcome_count,
            "legacy_records_unlinked": [record_.pk for record_ in legacy_records],
        },
    )
    locked.delete()
