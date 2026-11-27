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

from collections.abc import Iterable, Sequence
from typing import TYPE_CHECKING, Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from accounts.people import title_of
from audit.models import AuditAction
from audit.recording import record, student_label
from gradings.legacy_people import assign_people, refresh_people
from gradings.locking import lock_student
from gradings.models import (
    VOID_REASON_MESSAGE,
    LegacyGradingRecord,
    LegacyPerson,
    LegacyPersonState,
    LegacyRankField,
)
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
    caller. Each is given its person (legacy_people.assign_people) before it
    is saved. All or nothing, like the commit that calls it.
    """
    records = [LegacyGradingRecord(source_batch=source_batch, **row) for row in rows]
    for record_ in records:
        try:
            record_.full_clean(
                exclude=[
                    "source_batch",
                    "person",
                    "student",
                    "current_rank",
                    "testing_for_rank",
                ],
                validate_unique=False,
                validate_constraints=False,
            )
        except ValidationError as refused:
            raise ValidationError(
                {"rows": [f"{record_.source_locator}: {' '.join(refused.messages)}"]},
            ) from refused
    assign_people(records)
    return LegacyGradingRecord.objects.bulk_create(records, batch_size=500)


MOVED_MESSAGE = (
    "This record moved to another person while you were looking. Look at it again."
)
DECIDED_PERSON_MESSAGE = (
    "This record's person has been decided. Reopen the person, or split this "
    "record off, to change who it is about."
)


def _lock_people_of(record_ids: Iterable[int]) -> dict[int, int | None]:
    """Lock the people of these records, in id order, before any record: the
    order every decision about a person takes (legacy_person_services), so
    the two cannot wait on each other. Returns each record's person as read
    before the lock, for _locked to confirm."""
    people: dict[int, int | None] = dict(
        LegacyGradingRecord.objects.filter(pk__in=set(record_ids))
        .order_by()
        .values_list("pk", "person_id"),
    )
    list(
        LegacyPerson.objects.select_for_update()
        .filter(pk__in={pk for pk in people.values() if pk is not None})
        .order_by("pk")
        .values_list("pk", flat=True),
    )
    return people


def _locked(
    pk: int,
    *,
    allow_void: bool = False,
    person_of: dict[int, int | None] | None = None,
) -> LegacyGradingRecord:
    """The record locked, its person locked before it (_lock_people_of)."""
    if person_of is None:
        person_of = _lock_people_of([pk])
    locked = LegacyGradingRecord.objects.select_for_update(of=("self",)).get(pk=pk)
    if locked.person_id != person_of.get(pk):
        # Split or merged off between the two reads: its person is not locked.
        raise ValidationError({"record": [MOVED_MESSAGE]})
    if locked.is_void and not allow_void:
        raise ValidationError({"record": [VOIDED_MESSAGE]})
    return locked


def _changed_person(locked: LegacyGradingRecord) -> None:
    """Raise the version of the record's person (locked before the record),
    so a decision made on how the person looked before is refused."""
    if locked.person_id is not None:
        LegacyPerson.objects.filter(pk=locked.person_id).update(
            version=F("version") + 1,
            updated_at=timezone.now(),
        )


def _refuse_if_decided(locked: LegacyGradingRecord) -> None:
    """A decided person's records carry the decision: changing who one is
    about is a decision about the person, not the record."""
    if (
        locked.person_id is not None
        and LegacyPerson.objects.filter(
            pk=locked.person_id,
            state__in=(LegacyPersonState.LINKED, LegacyPersonState.NOT_A_STUDENT),
        ).exists()
    ):
        raise ValidationError({"student": [DECIDED_PERSON_MESSAGE]})


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
    _refuse_if_decided(locked)
    if student.deleted_at is not None:
        # A deleted student keeps the records already theirs, but their
        # record is closed: nothing new is linked to it.
        raise ValidationError({"student": [STUDENT_DELETED_MESSAGE]})
    if locked.student_id is not None and not replace:
        raise ValidationError({"student": [LINKED_ELSEWHERE_MESSAGE]})
    previous_student_id = locked.student_id
    locked.student = student
    locked.save()
    _changed_person(locked)
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
def unlink_legacy_record_from_student(
    record_: LegacyGradingRecord,
    *,
    actor: User,
) -> LegacyGradingRecord:
    return _unlink(_locked(record_.pk), actor=actor)


NOT_LINKED_MESSAGE = "This record is not linked to a student."


def _unlink(locked: LegacyGradingRecord, *, actor: User) -> LegacyGradingRecord:
    if locked.student_id is None:
        raise ValidationError({"student": [NOT_LINKED_MESSAGE]})
    _refuse_if_decided(locked)
    previous_student_id = locked.student_id
    locked.student = None
    locked.save()
    _changed_person(locked)
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
    refresh_people([locked.person_id])
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
        raise ValidationError({"void_reason": [VOID_REASON_MESSAGE]})
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
        f"Historical grading record voided{how}.",
        actor=actor,
        metadata={
            "legacy_record_id": locked.pk,
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
    refresh_people([locked.person_id])
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
    _lock_people_of(
        LegacyGradingRecord.objects.filter(source_batch_id=batch_id, is_void=False)
        .order_by()
        .values_list("pk", flat=True),
    )
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
    refresh_people(record_.person_id for record_ in records)
    return len(records)
