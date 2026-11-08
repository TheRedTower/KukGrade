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
from typing import TYPE_CHECKING, Any

from django.core.exceptions import ValidationError
from django.db import connection, transaction
from django.utils import timezone

from accounts.models import User
from audit.models import AuditAction
from audit.recording import record, record_many, student_label
from gradings.locking import lock_sessions, lock_student
from ranks.models import Rank
from students import wksa_ids
from students.models import PreviousWksaId, RetiredWksaId, Student, StudentExtraInfo

if TYPE_CHECKING:
    from gradings.models import GradingCandidate


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


# What a student event may carry: never a name or a date of birth. The audit log
# is permanent, so the personal fields appear only as the fact that they changed.
_PERSONAL_FIELDS = frozenset({"first_name", "last_name", "date_of_birth"})


def _audited_change(
    before: dict[str, Any],
    after: dict[str, Any],
    rebanded: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "changed_fields": [key for key in before if before[key] != after[key]],
        "before": {k: v for k, v in before.items() if k not in _PERSONAL_FIELDS},
        "after": {k: v for k, v in after.items() if k not in _PERSONAL_FIELDS},
        "rebanded": rebanded,
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
        f"{student_label(student, first=True)} created.",
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
            source_import=source_import,
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
    for student in created:
        # Checked above for these IDs only; a later save checks again.
        student.previous_ids_checked = False
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
        [
            (student, f"{student_label(student, first=True)} created.")
            for student in created
        ],
        actor=actor,
    )
    return created


def _unsettled_sessions(student_id: int) -> set[int]:
    from gradings.services import unsettled_registrations

    return set(
        unsettled_registrations()
        .filter(student_id=student_id)
        .values_list("session_id", flat=True),
    )


def _lock_registration_sessions(student_id: int, needed: bool) -> set[int]:
    """Lock the sessions a date-of-birth or rank change may touch, before the
    student, as every grading write orders its locks (gradings/locking.py)."""
    if not needed:
        return set()
    sessions = _unsettled_sessions(student_id)
    lock_sessions(sessions)
    return sessions


def _check_registrations_still_in_session(
    student_id: int,
    locked_sessions: set[int],
    field: str,
) -> None:
    if _unsettled_sessions(student_id) - locked_sessions:
        # Registered for another grading between reading and locking. Locking
        # that session now would break the order, so start again instead.
        raise ValidationError(
            {
                field: [
                    "This student was registered for another grading while "
                    "being changed. Try again.",
                ],
            },
        )


def _check_rank_change(student_id: int) -> None:
    """Refuse a rank change while the student has a grading still to reach its
    result: the rank they test for depends on the rank they hold.
    """
    if _unsettled_sessions(student_id):
        raise ValidationError(
            {
                "current_rank": [
                    "This student is registered for a grading that has not "
                    "reached its result, and the rank they test for depends "
                    "on their current rank. Withdraw them from it first.",
                ],
            },
        )


def _registrations_to_reband(student: Student) -> list[tuple[Any, str]]:
    """The unsettled registrations whose band the student's date of birth
    changes, with the band each moves to.

    The band is what the assessment's syllabus was chosen from, so once the
    form exists a different band cannot be applied quietly: the change is
    refused and the form must be removed first. A settled registration keeps
    the band it was graded in. A band with no syllabus for the testing rank
    is refused, as at registration.
    """
    from gradings.age import resolve_age_band
    from gradings.services import unsettled_registrations
    from syllabus.models import AgeBand
    from syllabus.services import has_recorded_syllabus

    moves: list[tuple[Any, str]] = []
    registrations = unsettled_registrations().filter(student=student)
    for registration in registrations.select_related(
        "session", "assessment", "testing_for_rank"
    ):
        band = resolve_age_band(
            student.date_of_birth, registration.session.grading_date
        )
        if band == registration.age_band:
            continue
        if hasattr(registration, "assessment"):
            raise ValidationError(
                {
                    "date_of_birth": [
                        "This date of birth puts the student in a different "
                        f"age band for '{registration.session.title}', where "
                        "their assessment form is already prepared. Remove the "
                        "assessment form first.",
                    ],
                },
            )
        # As registering checks (review N-08, 2026-11-07): the new band must
        # have a syllabus for the rank, or its form could never be prepared.
        if not has_recorded_syllabus(registration.testing_for_rank, band):
            raise ValidationError(
                {
                    "date_of_birth": [
                        "This date of birth puts the student in the "
                        f"{AgeBand(band).label} age band for "
                        f"'{registration.session.title}', which has no syllabus "
                        f"recorded for {registration.testing_for_rank.name} yet.",
                    ],
                },
            )
        moves.append((registration, band))
    return moves


def _reband_registrations(student: Student) -> list[dict[str, object]]:
    """Move each unsettled registration to the band the corrected date of
    birth gives, until its assessment form is prepared."""
    from gradings.models import GradingCandidate

    rebanded: list[dict[str, object]] = []
    for registration, band in _registrations_to_reband(student):
        GradingCandidate.objects.filter(pk=registration.pk).update(
            age_band=band,
            updated_at=timezone.now(),
        )
        rebanded.append(
            {"candidate": registration.pk, "from": registration.age_band, "to": band},
        )
    return rebanded


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
    # the meantime. The requested changes go onto the locked row -
    # the same student lock promotion and rank rollback take.
    registered_in = _lock_registration_sessions(
        student.pk,
        date_of_birth is not None or current_rank is not None,
    )
    locked = lock_student(student.pk)
    before = _snapshot(locked)
    if date_of_birth is not None:
        _check_registrations_still_in_session(
            locked.pk,
            registered_in,
            "date_of_birth",
        )
    if current_rank is not None and current_rank.pk != locked.current_rank_id:
        _check_registrations_still_in_session(locked.pk, registered_in, "current_rank")
        _check_rank_change(locked.pk)

    # A student ID becoming the black belt ID, or a mistyped ID corrected;
    # Student.clean() refuses anything else (students/wksa_ids.py).
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
    rebanded = (
        _reband_registrations(locked)
        if before["date_of_birth"] != after["date_of_birth"]
        else []
    )
    if wksa_ids.is_black_belt_change(before["wksa_id"], after["wksa_id"]):
        # The student ID a black belt ID replaced stays with them for good. A
        # corrected typo does not: it was never theirs, and may be someone
        # else's real number (the edit's audit event keeps both).
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
                f"{student_label(locked, first=True)} status changed from "
                f"{before['status']} to {after['status']}."
            ),
            actor=actor,
            metadata=_audited_change(before, after, rebanded),
        )
    else:
        record(
            AuditAction.STUDENT_UPDATED,
            locked,
            f"{student_label(locked, first=True)} updated.",
            actor=actor,
            metadata=_audited_change(before, after, rebanded),
        )
    return locked


def student_deletion_blocker(student: Student) -> str | None:
    """Why this student cannot be deleted yet, or None when they can.

    A student is never deleted before a final decision (owner, 2026-11-07):
    while a grading for them has not reached its result, they stay. Once it
    has, the decision is recorded and the student may be deleted after the
    fact, their history kept (delete_student).
    """
    from gradings.services import unsettled_registrations

    registration = (
        unsettled_registrations()
        .filter(student=student)
        .select_related("session")
        .order_by("session__grading_date", "session_id")
        .first()
    )
    if registration is None:
        return None
    title = registration.session.title
    if _has_final_decision(registration):
        # A Pass is settled by the promotion that follows it.
        return (
            f"This student passed in the grading '{title}' and their promotion "
            "has not been recorded yet. They can be deleted once it has."
        )
    return (
        f"This student is in the grading '{title}', which has not reached its "
        "final decision for them yet. They can be deleted once that decision "
        "is recorded, or once they are taken out of that grading."
    )


def _has_final_decision(registration: GradingCandidate) -> bool:
    from gradings.models import CandidateOutcome

    return CandidateOutcome.objects.filter(
        candidate=registration,
        status=CandidateOutcome.Status.FINALISED,
    ).exists()


def student_has_history(student: Student) -> bool:
    """Whether anything is recorded for this student: any grading they were
    in, a promotion, or an imported grading record."""
    from gradings.models import GradingCandidate, LegacyGradingRecord, Promotion

    return (
        GradingCandidate.objects.filter(student=student).exists()
        or Promotion.objects.filter(student=student).exists()
        or LegacyGradingRecord.objects.filter(student=student).exists()
    )


@transaction.atomic
def delete_student(student: Student, actor: User) -> bool:
    """Delete a student. True when the record is erased, False when it is
    kept for their history.

    Refused while a grading for them has not reached its final decision
    (student_deletion_blocker). After that, a student with history - any
    grading they were in, its marks and decision, a promotion, an imported
    record - is deleted from the lists but kept, so every past grading still
    shows who it was (owner, 2026-11-07): their record can no longer be
    changed, registered or found in a search, and their WKSA IDs stay with
    it. A record with no history at all (added by mistake, a duplicate, test
    data) is erased, and its numbers retired so no one else is given them
    (owner, 2026-10-20).
    """
    # Sessions before the student, as every grading write takes them
    # (gradings/locking.py), so a decision or registration in one of their
    # gradings cannot slip past the checks below.
    from gradings.models import GradingCandidate

    sessions = set(
        GradingCandidate.objects.filter(student_id=student.pk).values_list(
            "session_id",
            flat=True,
        ),
    )
    lock_sessions(sessions)
    locked = lock_student(student.pk)
    if locked.deleted_at is not None:
        raise ValidationError({"student": ["This student has already been deleted."]})
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

    # Read under the locks, so a registration or decision made meanwhile is
    # seen.
    blocker = student_deletion_blocker(locked)
    if blocker is not None:
        raise ValidationError({"student": [blocker]})

    keep = student_has_history(locked)
    retired: list[str] = []
    if not keep:
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
        (
            f"{student_label(locked, first=True)} deleted; their grading "
            "history is kept."
            if keep
            else f"{student_label(locked, first=True)} permanently deleted."
        ),
        actor=actor,
        metadata={
            "wksa_id": locked.wksa_id,
            "previous_wksa_ids": retired[1:],
            "kept_for_their_history": keep,
        },
    )
    if keep:
        locked.deleted_at = timezone.now()
        locked.save(update_fields=["deleted_at", "updated_at"])
        return False
    locked.delete()
    return True
