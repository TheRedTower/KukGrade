"""Historical grading record lifecycle: create once, correct via service only.

`LegacyGradingRecord` is deliberately a weaker, distinct evidence model from
the native grading workflow (see its docstring in gradings/models.py). Every
function here either creates a record from already-parsed, already-validated
data (`create_legacy_grading_record`, called once per row from a data_imports
commit service) or performs one of the five explicit corrections the
Definitive Implementation Spec's section 14 allows - nothing here ever
touches `outcome`/`comments`/other source-derived fields once a record
exists; `LegacyGradingRecord.clean()` enforces that even if a caller tried.
"""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from audit.models import AuditAction
from audit.recording import record
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
    to student-roster import (spec section 29; see data_imports.services.
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


def _locked(pk: int) -> LegacyGradingRecord:
    return LegacyGradingRecord.objects.select_for_update(of=("self",)).get(pk=pk)


@transaction.atomic
def link_legacy_record_to_student(
    record_: LegacyGradingRecord,
    student: Student,
    *,
    actor: User,
) -> LegacyGradingRecord:
    """Decision 3: every link is an explicit administrator decision, never
    inferred from a name match, however strong the suggestion looked."""
    locked = _locked(record_.pk)
    locked.student = student
    locked.save()
    record(
        AuditAction.LEGACY_GRADING_LINKED,
        locked,
        f"Legacy grading record linked to {student}.",
        actor=actor,
        metadata={
            "legacy_record_id": locked.pk,
            "student_id": student.pk,
            "batch_id": locked.source_batch_id,
        },
    )
    return locked


@transaction.atomic
def unlink_legacy_record_from_student(
    record_: LegacyGradingRecord,
    *,
    actor: User,
) -> LegacyGradingRecord:
    locked = _locked(record_.pk)
    if locked.student_id is None:
        raise ValidationError({"student": ["This record is not linked to a student."]})
    previous_student_id = locked.student_id
    locked.student = None
    locked.save()
    record(
        AuditAction.LEGACY_GRADING_UNLINKED,
        locked,
        "Legacy grading record unlinked from student.",
        actor=actor,
        metadata={
            "legacy_record_id": locked.pk,
            "student_id": previous_student_id,
            "batch_id": locked.source_batch_id,
        },
    )
    return locked


@transaction.atomic
def resolve_legacy_current_rank(
    record_: LegacyGradingRecord,
    rank: Rank | None,
    *,
    actor: User,
) -> LegacyGradingRecord:
    """`rank=None` explicitly leaves the mapping unresolved (Decision 4/17) -
    source text is never touched either way."""
    locked = _locked(record_.pk)
    locked.current_rank = rank
    locked.save()
    resolved_display = rank.code if rank else "unresolved"
    record(
        AuditAction.LEGACY_GRADING_RANK_RESOLVED,
        locked,
        f"Legacy record current-rank mapping resolved to {resolved_display}.",
        actor=actor,
        metadata={
            "legacy_record_id": locked.pk,
            "field": "current_rank",
            "source_text": locked.source_current_rank_text,
            "resolved_rank_code": rank.code if rank else None,
            "batch_id": locked.source_batch_id,
        },
    )
    return locked


@transaction.atomic
def resolve_legacy_testing_for_rank(
    record_: LegacyGradingRecord,
    rank: Rank | None,
    *,
    actor: User,
) -> LegacyGradingRecord:
    locked = _locked(record_.pk)
    locked.testing_for_rank = rank
    locked.save()
    resolved_display = rank.code if rank else "unresolved"
    record(
        AuditAction.LEGACY_GRADING_RANK_RESOLVED,
        locked,
        f"Legacy record testing-for-rank mapping resolved to {resolved_display}.",
        actor=actor,
        metadata={
            "legacy_record_id": locked.pk,
            "field": "testing_for_rank",
            "source_text": locked.source_testing_for_rank_text,
            "resolved_rank_code": rank.code if rank else None,
            "batch_id": locked.source_batch_id,
        },
    )
    return locked


@transaction.atomic
def void_legacy_record(
    record_: LegacyGradingRecord,
    *,
    reason: str,
    actor: User,
) -> LegacyGradingRecord:
    """Excludes the record from active history without deleting it
    (Decision 16). Deterministically refused a second time - no "unvoid"
    path exists (spec section 40.13's own framing: idempotent or
    deterministically rejected; this codebase's convention elsewhere is
    always the latter, e.g. a second import-batch commit)."""
    cleaned_reason = (reason or "").strip()
    if not cleaned_reason:
        raise ValidationError(
            {"void_reason": ["A reason is required to void a record."]}
        )
    locked = _locked(record_.pk)
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
        f"Legacy grading record voided: {cleaned_reason}",
        actor=actor,
        metadata={
            "legacy_record_id": locked.pk,
            "reason": cleaned_reason,
            "batch_id": locked.source_batch_id,
        },
    )
    return locked


__all__ = [
    "create_legacy_grading_record",
    "link_legacy_record_to_student",
    "resolve_legacy_current_rank",
    "resolve_legacy_testing_for_rank",
    "unlink_legacy_record_from_student",
    "void_legacy_record",
]
