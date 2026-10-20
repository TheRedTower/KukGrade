"""Student create and update, with audit recording.

Kept in one layer with the audit calls inline, the same shape as
gradings/services.py's create_grading_session / apply_candidate_update: a
thin function per action rather than recording scattered across serializers.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any

from django.core.exceptions import ValidationError
from django.db import connection, models, transaction

from accounts.models import User
from audit.models import AuditAction
from audit.recording import record, record_many
from gradings.locking import lock_sessions, lock_student
from ranks.models import Rank
from students import wksa_ids
from students.models import PreviousWksaId, RetiredWksaId, Student, StudentExtraInfo


def _snapshot(student: Student) -> dict[str, Any]:
    return {
        # Kept, so a student ID replaced by a black belt ID stays on record.
        "wksa_id": student.wksa_id,
        "first_name": student.first_name,
        "last_name": student.last_name,
        "date_of_birth": str(student.date_of_birth),
        "current_rank": student.current_rank.code,
        "status": student.status,
    }


def lock_wksa_ids(*ids: str) -> None:
    """Hold each ID's transaction lock, in a fixed order, until commit.

    An ID is never held by two people, current or previous. The student table's
    unique index covers the current ones, but an ID moves from one table to
    the other when a student becomes a black belt, so a student created with
    that ID at the same moment could pass both checks. Whoever creates a
    student with an ID, or replaces one, takes its lock first; the other then
    waits and sees the committed result.
    """
    keys = [f"wksa_id:{wksa_id}" for wksa_id in sorted(set(ids))]
    if not keys:
        return
    with connection.cursor() as cursor:
        # One statement however many: taken in the sorted order given, so two
        # callers holding overlapping IDs cannot each wait on the other.
        cursor.execute(
            "SELECT pg_advisory_xact_lock(hashtext(key)) "
            "FROM unnest(%s::text[]) AS keys(key)",
            [keys],
        )
        cursor.fetchall()


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
    lock_wksa_ids(wksa_ids.normalise(wksa_id))
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


@dataclass(frozen=True)
class NewStudent:
    wksa_id: str
    first_name: str
    last_name: str
    date_of_birth: date
    current_rank: Rank
    status: str = Student.Status.ACTIVE
    # (label, value) pairs a file had no field for; blank values are dropped.
    extra_information: tuple[tuple[str, str], ...] = ()


TAKEN_MESSAGE = "This WKSA ID is now held by a student."


def wksa_ids_held(ids: Sequence[str]) -> set[str]:
    """Which of `ids` a student holds, or held before (replaced or deleted)."""
    wanted = set(ids)
    return (
        set(
            Student.objects.filter(wksa_id__in=wanted).values_list("wksa_id", flat=True)
        )
        | set(
            PreviousWksaId.objects.filter(wksa_id__in=wanted).values_list(
                "wksa_id",
                flat=True,
            ),
        )
        | set(
            RetiredWksaId.objects.filter(wksa_id__in=wanted).values_list(
                "wksa_id",
                flat=True,
            ),
        )
    )


@transaction.atomic
def create_students(
    new_students: Sequence[NewStudent],
    *,
    actor: User | None = None,
    source_import: int | None = None,
) -> list[Student]:
    """Many students at once - each as create_student makes one, together.

    The same rules and the same STUDENT_CREATED event per student, but each
    rule that needs the database is asked once for all of them: every ID's
    lock is taken in one statement, then whether any is held is one query
    per table. All or nothing: any refusal raises with the student's ID as
    the error key, and nothing is created.
    """
    candidates = [
        Student(
            wksa_id=wksa_ids.normalise(new.wksa_id),
            first_name=new.first_name,
            last_name=new.last_name,
            date_of_birth=new.date_of_birth,
            current_rank=new.current_rank,
            status=new.status,
        )
        for new in new_students
    ]
    errors: dict[str, list[str]] = {}
    for candidate in candidates:
        # Checked below for all of them at once.
        candidate.previous_ids_checked = True
        try:
            candidate.full_clean(
                exclude=["current_rank"],
                validate_unique=False,
                validate_constraints=False,
            )
        except ValidationError as refused:
            errors.setdefault(candidate.wksa_id, []).extend(refused.messages)
    ids = [candidate.wksa_id for candidate in candidates]
    for repeated in [wksa_id for wksa_id, times in Counter(ids).items() if times > 1]:
        errors.setdefault(repeated, []).append("This WKSA ID is given twice.")
    lock_wksa_ids(*ids)
    for held in wksa_ids_held(ids):
        errors.setdefault(held, []).append(TAKEN_MESSAGE)
    if errors:
        raise ValidationError(errors)

    created = Student.objects.bulk_create(candidates, batch_size=500)
    StudentExtraInfo.objects.bulk_create(
        [
            StudentExtraInfo(
                student=student,
                label=label.strip()[:150],
                value=value.strip(),
                source_import=source_import,
            )
            for student, new in zip(created, new_students, strict=True)
            for label, value in new.extra_information
            if label.strip() and value.strip()
        ],
        batch_size=500,
    )
    record_many(
        AuditAction.STUDENT_CREATED,
        [(student, f"Student {student} created.") for student in created],
        actor=actor,
    )
    return created


@transaction.atomic
def update_student(
    student: Student,
    *,
    wksa_id: str | None = None,
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

    # Only ever a student ID becoming a black belt ID; Student.clean() refuses
    # any other change (students/wksa_ids.py).
    if wksa_id is not None:
        locked.wksa_id = wksa_id
        lock_wksa_ids(before["wksa_id"], wksa_ids.normalise(wksa_id))
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
    if before["wksa_id"] != after["wksa_id"]:
        # The ID it replaced stays with them for good.
        PreviousWksaId.objects.create(student=locked, wksa_id=before["wksa_id"])

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
    outcome_count = models.QuerySet.delete(
        CandidateOutcome.objects.filter(candidate__student=locked),
    )[0]
    models.QuerySet.delete(GradingCandidate.objects.filter(student=locked))

    legacy_records = list(LegacyGradingRecord.objects.filter(student=locked))
    for legacy_record in legacy_records:
        unlink_legacy_record_from_student(legacy_record, actor=actor, allow_void=True)

    # Their numbers go with them, never to anyone else (owner, 2026-10-20).
    retired = [
        locked.wksa_id,
        *locked.previous_wksa_ids.values_list("wksa_id", flat=True),
    ]
    lock_wksa_ids(*retired)
    RetiredWksaId.objects.bulk_create(
        [RetiredWksaId(wksa_id=wksa_id) for wksa_id in retired],
    )

    record(
        AuditAction.STUDENT_DELETED,
        locked,
        f"Student {locked} permanently deleted.",
        actor=actor,
        metadata={
            "wksa_id": locked.wksa_id,
            "previous_wksa_ids": retired[1:],
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
