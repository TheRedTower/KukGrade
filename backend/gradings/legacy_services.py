"""Historical grading record lifecycle: create once, correct via service only.

`LegacyGradingRecord` is deliberately a weaker, distinct evidence model from
the native grading workflow (see its docstring in gradings/models.py). Every
function here either creates a record from already-parsed, already-validated
data (`create_legacy_grading_record`, called once per row from a data_imports
commit service) or performs one of the five explicit corrections a record
allows - nothing here ever touches `outcome`/`comments`/other source-derived
fields once a record exists; `LegacyGradingRecord.clean()` enforces that even
if a caller tried.
"""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from audit.models import AuditAction
from audit.recording import record
from gradings.locking import lock_student, lock_students
from gradings.models import LegacyAttendance, LegacyDatePrecision, LegacyGradingRecord

if TYPE_CHECKING:
    from accounts.models import User
    from data_imports.models import ImportBatch
    from ranks.models import Rank
    from students.models import Student


@transaction.atomic
def create_legacy_grading_record(
    *,
    source_batch: ImportBatch,
    record_kind: str,
    source_sheet: str,
    source_locator: str,
    cycle_year: int,
    cycle_month: int,
    source_name: str,
    source_section: str = "",
    grading_date: date | None = None,
    date_precision: str = LegacyDatePrecision.MONTH,
    source_current_rank_text: str = "",
    current_rank: Rank | None = None,
    source_testing_for_rank_text: str = "",
    testing_for_rank: Rank | None = None,
    source_outcome_text: str = "",
    outcome: str | None = None,
    attendance_status: str = LegacyAttendance.UNKNOWN,
    comments: str = "",
    admin_note: str = "",
) -> LegacyGradingRecord:
    """Create one canonical row. No audit event of its own.

    Called once per parsed row from a data_imports commit service, which
    records a single batch-level audit event covering the whole cascade -
    the same "one event per commit, not one per row" rule already applied
    to student-roster import (see data_imports.services.
    commit_student_import's IMPORT_BATCH_COMMITTED event).
    """
    return LegacyGradingRecord.objects.create(
        source_batch=source_batch,
        record_kind=record_kind,
        source_sheet=source_sheet,
        source_section=source_section,
        source_locator=source_locator,
        cycle_year=cycle_year,
        cycle_month=cycle_month,
        grading_date=grading_date,
        date_precision=date_precision,
        source_name=source_name,
        source_current_rank_text=source_current_rank_text,
        current_rank=current_rank,
        source_testing_for_rank_text=source_testing_for_rank_text,
        testing_for_rank=testing_for_rank,
        source_outcome_text=source_outcome_text,
        outcome=outcome,
        attendance_status=attendance_status,
        comments=comments,
        admin_note=admin_note,
    )


VOIDED_MESSAGE = (
    "This record has been voided, so it is no longer part of anyone's "
    "history and cannot be changed."
)
LINKED_ELSEWHERE_MESSAGE = (
    "This record is already linked to another student. Unlink it first, or "
    "confirm the change."
)


def _locked(pk: int, *, allow_void: bool = False) -> LegacyGradingRecord:
    locked = LegacyGradingRecord.objects.select_for_update(of=("self",)).get(pk=pk)
    if locked.is_void and not allow_void:
        raise ValidationError({"record": [VOIDED_MESSAGE]})
    return locked


def _link(
    locked: LegacyGradingRecord,
    student: Student,
    *,
    actor: User,
    replace: bool,
) -> LegacyGradingRecord:
    if locked.student_id == student.pk:
        # Already linked there: nothing changes, so nothing is recorded.
        return locked
    if locked.student_id is not None and not replace:
        raise ValidationError({"student": [LINKED_ELSEWHERE_MESSAGE]})
    previous_student_id = locked.student_id
    locked.student = student
    locked.save()
    record(
        AuditAction.LEGACY_GRADING_LINKED,
        locked,
        f"Historical grading record linked to {student}.",
        actor=actor,
        metadata={
            "legacy_record_id": locked.pk,
            "student_id": student.pk,
            "previous_student_id": previous_student_id,
            "batch_id": locked.source_batch_id,
        },
    )
    return locked


@transaction.atomic
def link_legacy_record_to_student(
    record_: LegacyGradingRecord,
    student: Student,
    *,
    actor: User,
    replace: bool = False,
) -> LegacyGradingRecord:
    """Import Decision 3: every link is an explicit administrator decision,
    never inferred from a name match, however strong the suggestion looked.

    A record already linked to someone else moves only when `replace` says
    so. The student is locked before the record, the order deleting a
    student takes (students.services.delete_student), so the two cannot
    wait on each other.
    """
    locked_student = lock_student(student.pk)
    return _link(_locked(record_.pk), locked_student, actor=actor, replace=replace)


@transaction.atomic
def bulk_link_legacy_records(
    links: list[tuple[LegacyGradingRecord, Student]],
    *,
    actor: User,
    replace: bool = False,
) -> list[LegacyGradingRecord]:
    """Link many records at once, all or nothing - each as
    link_legacy_record_to_student would, with its own audit event.

    Every student is locked first, then every record, each in ascending
    order, so two bulk links cannot each wait on the other. A refusal names
    the record (its id as the error key) and nothing is linked.
    """
    students = lock_students({student.pk for _, student in links})
    records: dict[int, LegacyGradingRecord] = {}
    errors: dict[str, list[str]] = {}
    for pk in sorted({record_.pk for record_, _ in links}):
        try:
            records[pk] = _locked(pk)
        except LegacyGradingRecord.DoesNotExist:
            errors[str(pk)] = ["This record no longer exists."]
        except ValidationError as refused:
            errors[str(pk)] = refused.messages
    seen: dict[int, int] = {}
    for record_, student in links:
        if seen.setdefault(record_.pk, student.pk) != student.pk:
            errors.setdefault(str(record_.pk), []).append(
                "This record is given two different students.",
            )
        if student.pk not in students:
            errors.setdefault(str(record_.pk), []).append(
                "This student no longer exists.",
            )
    if errors:
        raise ValidationError(errors)
    linked: list[LegacyGradingRecord] = []
    for record_, student in links:
        try:
            linked.append(
                _link(
                    records[record_.pk],
                    students[student.pk],
                    actor=actor,
                    replace=replace,
                ),
            )
        except ValidationError as refused:
            errors.setdefault(str(record_.pk), []).extend(refused.messages)
    if errors:
        raise ValidationError(errors)
    return linked


@transaction.atomic
def unlink_legacy_record_from_student(
    record_: LegacyGradingRecord,
    *,
    actor: User,
    allow_void: bool = False,
) -> LegacyGradingRecord:
    """`allow_void` is for deleting the student: a voided record still has to
    let go of them (students.services.delete_student)."""
    locked = _locked(record_.pk, allow_void=allow_void)
    if locked.student_id is None:
        raise ValidationError({"student": ["This record is not linked to a student."]})
    previous_student_id = locked.student_id
    locked.student = None
    locked.save()
    record(
        AuditAction.LEGACY_GRADING_UNLINKED,
        locked,
        "Historical grading record unlinked from its student.",
        actor=actor,
        metadata={
            "legacy_record_id": locked.pk,
            "student_id": previous_student_id,
            "batch_id": locked.source_batch_id,
        },
    )
    return locked


_RANK_FIELD_LABELS = {
    "current_rank": "current rank",
    "testing_for_rank": "testing-for rank",
}


@transaction.atomic
def _resolve_legacy_rank(
    record_: LegacyGradingRecord,
    field: str,
    rank: Rank | None,
    actor: User,
) -> LegacyGradingRecord:
    """`rank=None` explicitly leaves the mapping unresolved (import
    Decision 4) - the source text is never touched either way."""
    locked = _locked(record_.pk)
    if getattr(locked, f"{field}_id") == (rank.pk if rank else None):
        # Already resolved that way: nothing changes, so nothing is recorded.
        return locked
    setattr(locked, field, rank)
    locked.save()
    resolved_display = rank.code if rank else "unresolved"
    record(
        AuditAction.LEGACY_GRADING_RANK_RESOLVED,
        locked,
        f"Historical record {_RANK_FIELD_LABELS[field]} set to {resolved_display}.",
        actor=actor,
        metadata={
            "legacy_record_id": locked.pk,
            "field": field,
            "source_text": getattr(locked, f"source_{field}_text"),
            "resolved_rank_code": rank.code if rank else None,
            "batch_id": locked.source_batch_id,
        },
    )
    return locked


def resolve_legacy_current_rank(
    record_: LegacyGradingRecord,
    rank: Rank | None,
    *,
    actor: User,
) -> LegacyGradingRecord:
    return _resolve_legacy_rank(record_, "current_rank", rank, actor)


def resolve_legacy_testing_for_rank(
    record_: LegacyGradingRecord,
    rank: Rank | None,
    *,
    actor: User,
) -> LegacyGradingRecord:
    return _resolve_legacy_rank(record_, "testing_for_rank", rank, actor)


@transaction.atomic
def void_legacy_record(
    record_: LegacyGradingRecord,
    *,
    reason: str,
    actor: User,
) -> LegacyGradingRecord:
    """Excludes the record from active history without deleting it
    (import Decision 16). Deterministically refused a second time - no
    "unvoid" path exists, the same convention as a second import-batch
    commit."""
    cleaned_reason = (reason or "").strip()
    if not cleaned_reason:
        raise ValidationError(
            {"void_reason": ["A reason is required to void a record."]}
        )
    locked = _locked(record_.pk, allow_void=True)
    if locked.is_void:
        raise ValidationError({"is_void": ["This record has already been voided."]})
    locked.is_void = True
    locked.void_reason = cleaned_reason
    locked.voided_by = actor
    locked.voided_at = timezone.now()
    locked.save()
    record(
        AuditAction.LEGACY_GRADING_VOIDED,
        locked,
        f"Historical grading record voided:  {cleaned_reason}",
        actor=actor,
        metadata={
            "legacy_record_id": locked.pk,
            "reason": cleaned_reason,
            "batch_id": locked.source_batch_id,
        },
    )
    return locked


__all__ = [
    "bulk_link_legacy_records",
    "create_legacy_grading_record",
    "link_legacy_record_to_student",
    "resolve_legacy_current_rank",
    "resolve_legacy_testing_for_rank",
    "unlink_legacy_record_from_student",
    "void_legacy_record",
]
