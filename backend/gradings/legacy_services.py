"""Historical grading record lifecycle: create once, correct via service only.

`LegacyGradingRecord` is deliberately a weaker, distinct evidence model from
the native grading workflow (see its docstring in gradings/models.py). Every
function here either creates a record from already-parsed, already-validated
data (`create_legacy_grading_records`, every record of a data_imports
commit in one write, with no audit event of its own: the commit records one
for the whole batch) or performs one of the explicit corrections a record
allows - nothing here ever touches `outcome`/`comments`/other source-derived
fields once a record exists; `LegacyGradingRecord.clean()` enforces that even
if a caller tried.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING, Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from accounts.people import title_of
from audit.models import AuditAction
from audit.recording import record, student_label
from gradings.locking import lock_student, lock_students
from gradings.models import LegacyGradingRecord, LegacyRankField, SetAsideName
from students.models import STUDENT_DELETED_MESSAGE

if TYPE_CHECKING:
    from datetime import datetime

    from accounts.models import User
    from data_imports.models import ImportBatch
    from ranks.models import Rank
    from students.models import Student


VOIDED_MESSAGE = (
    "This record has been voided, so it is no longer part of anyone's "
    "history and cannot be changed."
)
LINKED_ELSEWHERE_MESSAGE = (
    "This record is already linked to another student. Unlink it first, or "
    "confirm the change."
)


@transaction.atomic
def create_legacy_grading_records(
    source_batch: ImportBatch,
    rows: Sequence[dict[str, Any]],
) -> list[LegacyGradingRecord]:
    """Every record of one import, in one write. No audit event of its own:
    the commit records one IMPORT_BATCH_COMMITTED event for the whole batch.

    Each is checked by the model's own field and clean() rules; the checks
    that would ask the database once per record - the batch and ranks it
    names, a locator repeated in the batch - are the database's own
    constraints on insert, and the batch and ranks were just read by the
    caller. All or nothing, like the commit that calls it.
    """
    records = [LegacyGradingRecord(source_batch=source_batch, **row) for row in rows]
    for record_ in records:
        try:
            record_.full_clean(
                exclude=["source_batch", "student", "current_rank", "testing_for_rank"],
                validate_unique=False,
                validate_constraints=False,
            )
        except ValidationError as refused:
            raise ValidationError(
                {"rows": [f"{record_.source_locator}: {' '.join(refused.messages)}"]},
            ) from refused
    return LegacyGradingRecord.objects.bulk_create(records, batch_size=500)


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
    if student.deleted_at is not None:
        # A deleted student keeps the records already theirs, but their
        # record is closed: nothing new is linked to it.
        raise ValidationError({"student": [STUDENT_DELETED_MESSAGE]})
    if locked.student_id is not None and not replace:
        raise ValidationError({"student": [LINKED_ELSEWHERE_MESSAGE]})
    previous_student_id = locked.student_id
    locked.student = student
    locked.save()
    record(
        AuditAction.LEGACY_GRADING_LINKED,
        locked,
        f"Historical grading record linked to {student_label(student)}.",
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
    """Every link is an explicit administrator decision,
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
    return _unlink(_locked(record_.pk, allow_void=allow_void), actor=actor)


NOT_LINKED_MESSAGE = "This record is not linked to a student."


def _unlink(locked: LegacyGradingRecord, *, actor: User) -> LegacyGradingRecord:
    if locked.student_id is None:
        raise ValidationError({"student": [NOT_LINKED_MESSAGE]})
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


@transaction.atomic
def bulk_unlink_legacy_records(
    record_ids: list[int],
    *,
    actor: User,
) -> list[LegacyGradingRecord]:
    """Unlink many records at once, all or nothing - the undo of a bulk link,
    each record with its own audit event as unlink_legacy_record_from_student
    would write.

    The records are locked in ascending order, as a bulk link locks them. A
    refusal names the record (its id as the error key) and nothing is unlinked.
    """
    records: dict[int, LegacyGradingRecord] = {}
    errors: dict[str, list[str]] = {}
    for pk in sorted(set(record_ids)):
        try:
            records[pk] = _locked(pk)
        except LegacyGradingRecord.DoesNotExist:
            errors[str(pk)] = ["This record no longer exists."]
            continue
        except ValidationError as refused:
            errors[str(pk)] = refused.messages
            continue
        if records[pk].student_id is None:
            errors[str(pk)] = [NOT_LINKED_MESSAGE]
    if errors:
        raise ValidationError(errors)
    return [_unlink(records[pk], actor=actor) for pk in sorted(records)]


@transaction.atomic
def resolve_legacy_rank(
    record_: LegacyGradingRecord,
    field: LegacyRankField,
    rank: Rank | None,
    *,
    actor: User,
) -> LegacyGradingRecord:
    """Map the record's current or testing-for rank (`field`) to `rank`;
    `rank=None` explicitly leaves it unresolved. The source text is never
    touched either way."""
    field = LegacyRankField(field)
    locked = _locked(record_.pk)
    if getattr(locked, f"{field}_id") == (rank.pk if rank else None):
        # Already resolved that way: nothing changes, so nothing is recorded.
        return locked
    setattr(locked, field, rank)
    locked.save()
    resolved_display = rank.name if rank else "unresolved"
    record(
        AuditAction.LEGACY_GRADING_RANK_RESOLVED,
        locked,
        f"Historical record {field.label} set to {resolved_display}.",
        actor=actor,
        metadata={
            "legacy_record_id": locked.pk,
            "field": field.value,
            "source_text": getattr(locked, f"source_{field}_text"),
            "resolved_rank_code": rank.code if rank else None,
            "batch_id": locked.source_batch_id,
        },
    )
    return locked


def _void_reason(reason: str) -> str:
    cleaned = (reason or "").strip()
    if not cleaned:
        raise ValidationError(
            {"void_reason": ["A reason is required to void a record."]}
        )
    return cleaned


def _void(
    locked: LegacyGradingRecord,
    *,
    reason: str,
    actor: User,
    at: datetime,
    whole_import: bool = False,
) -> None:
    locked.is_void = True
    locked.void_reason = reason
    locked.voided_by = actor
    locked.voided_by_title = title_of(actor)
    locked.voided_at = at
    locked.save()
    how = " with its whole import" if whole_import else ""
    record(
        AuditAction.LEGACY_GRADING_VOIDED,
        locked,
        f"Historical grading record voided{how}: {reason}",
        actor=actor,
        metadata={
            "legacy_record_id": locked.pk,
            "reason": reason,
            "batch_id": locked.source_batch_id,
            **({"whole_import": True} if whole_import else {}),
        },
    )


@transaction.atomic
def void_legacy_record(
    record_: LegacyGradingRecord,
    *,
    reason: str,
    actor: User,
) -> LegacyGradingRecord:
    """Excludes the record from active history without deleting it.
    Deterministically refused a second time - no
    "unvoid" path exists, the same convention as a second import-batch
    commit."""
    cleaned_reason = _void_reason(reason)
    locked = _locked(record_.pk, allow_void=True)
    if locked.is_void:
        raise ValidationError({"is_void": ["This record has already been voided."]})
    _void(locked, reason=cleaned_reason, actor=actor, at=timezone.now())
    return locked


@transaction.atomic
def void_legacy_records_from(
    batch_id: int,
    *,
    reason: str,
    actor: User,
) -> int:
    """Void every record not yet voided that import `batch_id` created.

    Each as void_legacy_record would, with its own LEGACY_GRADING_VOIDED
    event marked as part of the whole import's void; all or nothing.
    """
    cleaned_reason = _void_reason(reason)
    records = list(
        LegacyGradingRecord.objects.select_for_update(of=("self",))
        .filter(source_batch_id=batch_id, is_void=False)
        .order_by("pk"),
    )
    if not records:
        raise ValidationError(
            {"batch": ["Every record from this import is already voided."]},
        )
    voided_at = timezone.now()
    for locked in records:
        _void(
            locked,
            reason=cleaned_reason,
            actor=actor,
            at=voided_at,
            whole_import=True,
        )
    return len(records)


def set_aside_keys(user: User) -> list[str]:
    """The names this person has put aside on the linking page."""
    return list(
        SetAsideName.objects.filter(user=user).values_list("group_key", flat=True),
    )


def set_aside_names(user: User, keys: Sequence[str]) -> list[str]:
    """Put names aside for now. A name already aside stays as it was."""
    SetAsideName.objects.bulk_create(
        [SetAsideName(user=user, group_key=key) for key in dict.fromkeys(keys)],
        ignore_conflicts=True,
    )
    return set_aside_keys(user)


def put_back_name(user: User, key: str) -> None:
    """Return a name put aside to the list still to link."""
    SetAsideName.objects.filter(user=user, group_key=key).delete()
