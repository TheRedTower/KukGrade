"""Deciding about the people from the imported history (gradings.legacy_people).

Each person ends in one of four states: linked to a student, not a current
student, later, or not decided yet. Every decision here is one administrator
action on one person (or two, for a merge), with one audit event that names
the person by id and a student by WKSA ID, never by a name as written: a
spelling in the workbook is a name, and the audit log keeps none. Each can be
undone: a decision by reopening, a split by a merge, a merge by a split.

A decision covers the person's live records (`person_confirmed`): a linked
person's records carry their student, a person who is not a student's carry
none. The database holds the two in step (PERSON_RECORDS_AGREE_TRIGGER).

Locks are taken in one order everywhere: the student, then the people in id
order, then their records (legacy_services takes the same order). Each
decision names the `version` of the person it was made on, and is refused
once the person has changed since: of two administrators deciding about one
person at once, one wins and the other is told to look again.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.utils import timezone

from accounts.people import title_of
from audit.models import AuditAction
from audit.recording import record, student_label
from gradings.legacy_people import (
    PersonQueue,
    entry_for,
    person_fields,
    person_views,
    refresh_people,
    suggest_students,
)
from gradings.locking import lock_student, lock_students
from gradings.models import (
    LegacyGradingRecord,
    LegacyNotAStudentReason,
    LegacyPerson,
    LegacyPersonState,
    LegacyRecordKind,
)
from ranks.matching import active_rank_lookup
from students.models import STUDENT_DELETED_MESSAGE

if TYPE_CHECKING:
    from accounts.models import User
    from students.models import Student


PERSON_GONE_MESSAGE = "This person no longer exists."
NO_RECORDS_MESSAGE = "Every record of this person has been voided."
CHANGED_MESSAGE = (
    "Someone else changed this person while you were looking. Look at them "
    "again before deciding."
)
REOPEN_FIRST_MESSAGE = "This person has already been decided. Reopen them first."
NOT_DECIDED_MESSAGE = "This person has not been decided yet."
LINKED_ELSEWHERE_MESSAGE = (
    "Some of these records are linked to another student. Confirm the change "
    "to move them."
)
NOTE_FOR_OTHER_MESSAGE = "Say why, when the reason is Other."

# A decision moves a person from one state to another; these may be left by
# any decision. A linked person or one who is not a student is reopened first.
_OPEN_STATES = (LegacyPersonState.PROPOSED, LegacyPersonState.LATER)


# --- locking -----------------------------------------------------------------


def _lock_people(person_ids: Iterable[int]) -> dict[int, LegacyPerson]:
    """Lock every person given, in id order. One that is gone is absent."""
    return {
        person.pk: person
        for person in LegacyPerson.objects.select_for_update()
        .filter(pk__in=set(person_ids))
        .order_by("pk")
    }


def _live_records(person: LegacyPerson) -> list[LegacyGradingRecord]:
    """The person's records not voided, locked, in id order."""
    return list(
        LegacyGradingRecord.objects.select_for_update(of=("self",))
        .filter(person=person, is_void=False)
        .order_by("pk"),
    )


def _checked(
    people: dict[int, LegacyPerson],
    pk: int,
    version: int,
) -> LegacyPerson:
    person = people.get(pk)
    if person is None:
        raise ValidationError({"person": [PERSON_GONE_MESSAGE]})
    if person.version != version:
        raise ValidationError({"version": [CHANGED_MESSAGE]})
    return person


def _set_records(records: Sequence[LegacyGradingRecord], **fields: Any) -> None:
    """Change the decision fields of records already locked, in one write.

    The fields a decision changes (person, person_confirmed, student) are
    ones a record may change after import (LegacyGradingRecord's mutable
    fields), so the per-record clean() that guards the source fields has
    nothing to check; the unbound QuerySet.update passes the queryset's
    refusal of a bulk change on purpose, as the cleanup services pass its
    refusal of a bulk delete.
    """
    allowed = {"person", "person_confirmed", "student"}
    assert set(fields) <= allowed, set(fields) - allowed
    if not records:
        return
    models.QuerySet.update(
        LegacyGradingRecord.objects.filter(pk__in=[r.pk for r in records]),
        **fields,
        updated_at=timezone.now(),
    )
    for record_ in records:
        for name, value in fields.items():
            setattr(record_, name, value)


def _decide(
    person: LegacyPerson,
    state: LegacyPersonState,
    *,
    actor: User,
    student: Student | None = None,
    reason: str = "",
    note: str = "",
) -> None:
    person.state = state
    person.student = student
    person.not_a_student_reason = reason
    person.note = note
    if state == LegacyPersonState.PROPOSED:
        person.decided_by, person.decided_by_title, person.decided_at = None, "", None
    else:
        person.decided_by = actor
        person.decided_by_title = title_of(actor)
        person.decided_at = timezone.now()
    _bump(person)


def _bump(person: LegacyPerson) -> None:
    person.version += 1
    person.save()


def _students_of(records: Iterable[LegacyGradingRecord]) -> list[int]:
    return sorted({r.student_id for r in records if r.student_id is not None})


def _record_ids(records: Iterable[LegacyGradingRecord]) -> list[int]:
    return [r.pk for r in records]


# --- the decisions -----------------------------------------------------------


@dataclass
class _Link:
    person: LegacyPerson
    student: Student
    records: list[LegacyGradingRecord]


def _prepare_link(
    person: LegacyPerson,
    student: Student,
    *,
    replace: bool,
) -> _Link | None:
    """What linking `person` to `student` would do, or None when it is done
    already. Refused as the decision would be."""
    if person.state == LegacyPersonState.LINKED and person.student_id != student.pk:
        raise ValidationError({"person": [REOPEN_FIRST_MESSAGE]})
    if person.state == LegacyPersonState.NOT_A_STUDENT:
        raise ValidationError({"person": [REOPEN_FIRST_MESSAGE]})
    records = _live_records(person)
    if not records:
        raise ValidationError({"person": [NO_RECORDS_MESSAGE]})
    if person.state == LegacyPersonState.LINKED and all(
        r.person_confirmed and r.student_id == student.pk for r in records
    ):
        # Linked there already, every record with them: nothing to record.
        return None
    if student.deleted_at is not None:
        # A deleted student keeps the records already theirs, but their
        # record is closed: nothing new is linked to it.
        raise ValidationError({"student": [STUDENT_DELETED_MESSAGE]})
    if not replace and any(r.student_id not in (None, student.pk) for r in records):
        raise ValidationError({"student": [LINKED_ELSEWHERE_MESSAGE]})
    return _Link(person, student, records)


def _apply_link(link: _Link, *, actor: User, together: bool = False) -> None:
    person, student, records = link.person, link.student, link.records
    moved_from = [pk for pk in _students_of(records) if pk != student.pk]
    joined = [r.pk for r in records if not r.person_confirmed]
    _set_records(records, student=student, person_confirmed=True)
    _decide(person, LegacyPersonState.LINKED, actor=actor, student=student)
    how = " with others ready to confirm" if together else ""
    record(
        AuditAction.LEGACY_PERSON_LINKED,
        person,
        f"Historical person {person.pk} linked to {student_label(student)}{how}.",
        actor=actor,
        metadata={
            "person_id": person.pk,
            "student_id": student.pk,
            "records": len(records),
            "newly_confirmed": len(joined),
            "record_ids": _record_ids(records),
            "confirmed_record_ids": joined,
            # Students the records were linked to before: their history
            # shows the move too (audit.subjects).
            "student_ids": [student.pk, *moved_from],
            **({"confirmed_together": True} if together else {}),
        },
    )


@transaction.atomic
def link_person(
    person_id: int,
    student: Student,
    *,
    version: int,
    actor: User,
    replace: bool = False,
) -> LegacyPerson:
    """Link the person to `student`: every live record of theirs joins the
    student's history. Linking them there again confirms records that joined
    since. Records already linked to another student move only when
    `replace` says so."""
    locked_student = lock_student(student.pk)
    person = _checked(_lock_people([person_id]), person_id, version)
    link = _prepare_link(person, locked_student, replace=replace)
    if link is not None:
        _apply_link(link, actor=actor)
    return person


@transaction.atomic
def mark_not_a_student(
    person_id: int,
    *,
    reason: str,
    note: str = "",
    version: int,
    actor: User,
) -> LegacyPerson:
    """Mark the person not a current student (an instructor, someone who
    left before KukGrade, an entry that is not a person): their records stay
    unlinked, and any linked to a student let go. Doing it again confirms
    records that joined since, with the reason given."""
    reason = LegacyNotAStudentReason(reason)
    note = (note or "").strip()
    if reason == LegacyNotAStudentReason.OTHER and not note:
        raise ValidationError({"note": [NOTE_FOR_OTHER_MESSAGE]})
    person = _checked(_lock_people([person_id]), person_id, version)
    if person.state == LegacyPersonState.LINKED:
        raise ValidationError({"person": [REOPEN_FIRST_MESSAGE]})
    records = _live_records(person)
    if not records:
        raise ValidationError({"person": [NO_RECORDS_MESSAGE]})
    if (
        person.state == LegacyPersonState.NOT_A_STUDENT
        and (person.not_a_student_reason, person.note) == (reason, note)
        and all(r.person_confirmed for r in records)
    ):
        return person
    let_go = _students_of(records)
    joined = [r.pk for r in records if not r.person_confirmed]
    _set_records(records, student=None, person_confirmed=True)
    _decide(
        person,
        LegacyPersonState.NOT_A_STUDENT,
        actor=actor,
        reason=reason,
        note=note,
    )
    record(
        AuditAction.LEGACY_PERSON_NOT_A_STUDENT,
        person,
        f"Historical person {person.pk} marked not a current student: {reason.label}.",
        actor=actor,
        metadata={
            "person_id": person.pk,
            "reason": reason.value,
            # Whether a note was given, not what it says: it may name them.
            "note_given": bool(note),
            "records": len(records),
            "newly_confirmed": len(joined),
            "record_ids": _record_ids(records),
            "confirmed_record_ids": joined,
            **({"student_ids": let_go} if let_go else {}),
        },
    )
    return person


@transaction.atomic
def leave_for_later(person_id: int, *, version: int, actor: User) -> LegacyPerson:
    """Leave the person for later: shared by every administrator, and
    counted until sorted. Doing it again confirms records that joined
    since."""
    person = _checked(_lock_people([person_id]), person_id, version)
    if person.state not in _OPEN_STATES:
        raise ValidationError({"person": [REOPEN_FIRST_MESSAGE]})
    records = _live_records(person)
    if not records:
        raise ValidationError({"person": [NO_RECORDS_MESSAGE]})
    if person.state == LegacyPersonState.LATER and all(
        r.person_confirmed for r in records
    ):
        return person
    joined = [r.pk for r in records if not r.person_confirmed]
    _set_records(records, person_confirmed=True)
    _decide(person, LegacyPersonState.LATER, actor=actor)
    record(
        AuditAction.LEGACY_PERSON_LATER,
        person,
        f"Historical person {person.pk} left for later.",
        actor=actor,
        metadata={
            "person_id": person.pk,
            "records": len(records),
            "newly_confirmed": len(joined),
            "record_ids": _record_ids(records),
            "confirmed_record_ids": joined,
        },
    )
    return person


@transaction.atomic
def reopen_person(person_id: int, *, version: int, actor: User) -> LegacyPerson:
    """Undo a decision: the person is not decided yet, and a linked
    person's records leave the student's history."""
    person = _checked(_lock_people([person_id]), person_id, version)
    if person.state == LegacyPersonState.PROPOSED:
        raise ValidationError({"person": [NOT_DECIDED_MESSAGE]})
    records = _live_records(person)
    if not records:
        # Nothing left to decide about: no list shows them any more.
        raise ValidationError({"person": [NO_RECORDS_MESSAGE]})
    was, student_id = person.state, person.student_id
    if was == LegacyPersonState.LINKED:
        _set_records(records, student=None, person_confirmed=False)
    else:
        _set_records(records, person_confirmed=False)
    _decide(person, LegacyPersonState.PROPOSED, actor=actor)
    record(
        AuditAction.LEGACY_PERSON_REOPENED,
        person,
        f"Historical person {person.pk} reopened: was "
        f"{LegacyPersonState(was).label.lower()}.",
        actor=actor,
        metadata={
            "person_id": person.pk,
            "previous_state": was,
            "records": len(records),
            "record_ids": _record_ids(records),
            **({"student_id": student_id} if student_id is not None else {}),
        },
    )
    return person


@transaction.atomic
def split_person(
    person_id: int,
    record_ids: Sequence[int],
    *,
    version: int,
    actor: User,
) -> LegacyPerson:
    """Move the chosen records to a new person, not decided yet: "these
    aren't all the same person". At least one record stays. Records leaving
    a linked person leave the student's history with it. Returns the new
    person."""
    person = _checked(_lock_people([person_id]), person_id, version)
    records = _live_records(person)
    wanted = set(record_ids)
    theirs = {r.pk for r in records}
    if not wanted:
        raise ValidationError({"records": ["Choose the records to move."]})
    if wanted - theirs:
        raise ValidationError(
            {"records": ["Only this person's records, not voided, can be moved."]},
        )
    if wanted == theirs:
        raise ValidationError(
            {"records": ["Leave at least one record with this person."]},
        )
    moving = [r for r in records if r.pk in wanted]
    ranks = active_rank_lookup()
    new_person = LegacyPerson.objects.create(
        **person_fields([entry_for(r, ranks) for r in moving], compared_all=True),
    )
    unlinked = person.student_id if person.state == LegacyPersonState.LINKED else None
    if unlinked is not None:
        _set_records(moving, person=new_person, person_confirmed=False, student=None)
    else:
        _set_records(moving, person=new_person, person_confirmed=False)
    # Rated again from the records now theirs, and its version raised.
    refresh_people([person.pk])
    person.refresh_from_db()
    record(
        AuditAction.LEGACY_PERSON_SPLIT,
        person,
        f"Historical person {person.pk} split: {len(moving)} of their records "
        f"moved to person {new_person.pk}.",
        actor=actor,
        metadata={
            "person_id": person.pk,
            "new_person_id": new_person.pk,
            "records_moved": len(wanted),
            "record_ids": sorted(wanted),
            **({"student_id": unlinked} if unlinked is not None else {}),
        },
    )
    return new_person


@transaction.atomic
def move_records(
    person_id: int,
    record_ids: Sequence[int],
    to_id: int,
    *,
    version: int,
    to_version: int,
    actor: User,
) -> LegacyPerson:
    """Move the chosen records to another person already there: "these are
    that person's". At least one record stays; moving them all is a merge.
    Between two people decided alike (the same student, say) the records stay
    covered by the decision. Otherwise they leave this person's decision
    (and a linked person's student) and wait for the other's to be confirmed,
    as records joining by a merge do. Returns the person they went to."""
    if person_id == to_id:
        raise ValidationError({"to": ["Choose another person to move them to."]})
    people = _lock_people([person_id, to_id])
    person = _checked(people, person_id, version)
    try:
        to = _checked(people, to_id, to_version)
    except ValidationError as refused:
        raise ValidationError({"to": refused.messages}) from refused
    records = _live_records(person)
    wanted = set(record_ids)
    theirs = {r.pk for r in records}
    if not wanted:
        raise ValidationError({"records": ["Choose the records to move."]})
    if wanted - theirs:
        raise ValidationError(
            {"records": ["Only this person's records, not voided, can be moved."]},
        )
    if wanted == theirs:
        raise ValidationError(
            {
                "records": [
                    "These are all of this person's records: merge the two "
                    "people instead.",
                ],
            },
        )
    destination = _live_records(to)
    if not destination:
        raise ValidationError({"to": [NO_RECORDS_MESSAGE]})
    moving = [r for r in records if r.pk in wanted]
    sheets = Counter(
        (r.cycle_year, r.cycle_month)
        for r in (*destination, *moving)
        if r.record_kind == LegacyRecordKind.GRADING_RESULT
    )
    if any(count > 1 for count in sheets.values()):
        raise ValidationError(
            {"to": ["Two results on one sheet cannot be one person."]},
        )

    decided = _STRENGTH[LegacyPersonState(person.state)] == 2
    alike = decided and _decision(person) == _decision(to)
    left = (
        person.student_id
        if person.state == LegacyPersonState.LINKED and not alike
        else None
    )
    if alike:
        _set_records(moving, person=to)
    elif left is not None:
        _set_records(moving, person=to, person_confirmed=False, student=None)
    else:
        _set_records(moving, person=to, person_confirmed=False)
    # Both rated again from the records now theirs, and their versions raised.
    refresh_people([person.pk, to.pk])
    to.refresh_from_db()
    record(
        AuditAction.LEGACY_RECORDS_MOVED,
        to,
        f"Historical person {person.pk}: {len(moving)} of their records moved "
        f"to person {to.pk}.",
        actor=actor,
        metadata={
            "person_id": person.pk,
            "to_person_id": to.pk,
            "records_moved": len(moving),
            "record_ids": sorted(wanted),
            **({"student_id": left} if left is not None else {}),
        },
    )
    return to


# Which decision a merged person keeps: a linked person, or one who is not a
# student, over one left for later, over one not decided yet.
_STRENGTH = {
    LegacyPersonState.PROPOSED: 0,
    LegacyPersonState.LATER: 1,
    LegacyPersonState.LINKED: 2,
    LegacyPersonState.NOT_A_STUDENT: 2,
}


def _decision(person: LegacyPerson) -> tuple[str, int | None, str, str]:
    return (
        person.state,
        person.student_id,
        person.not_a_student_reason,
        person.note,
    )


@transaction.atomic
def merge_people(
    person_id: int,
    other_id: int,
    *,
    version: int,
    other_version: int,
    actor: User,
) -> LegacyPerson:
    """Join `other` to the person: "these are one person". Every record of
    the other moves here and the other person is gone. The merged person
    keeps the firmer decision of the two, which then covers only the records
    it covered; two different firm decisions are refused, as are two
    results on one sheet."""
    if person_id == other_id:
        raise ValidationError({"other": ["Choose another person to merge with."]})
    people = _lock_people([person_id, other_id])
    person = _checked(people, person_id, version)
    try:
        other = _checked(people, other_id, other_version)
    except ValidationError as refused:
        raise ValidationError({"other": refused.messages}) from refused
    if (
        _STRENGTH[LegacyPersonState(person.state)] == 2
        and _STRENGTH[LegacyPersonState(other.state)] == 2
        and _decision(person) != _decision(other)
    ):
        raise ValidationError(
            {
                "other": [
                    "These two people have been decided differently. Reopen "
                    "one of them first.",
                ],
            },
        )
    mine = _live_records(person)
    theirs = _live_records(other)
    if not mine:
        raise ValidationError({"person": [NO_RECORDS_MESSAGE]})
    if not theirs:
        raise ValidationError({"other": [NO_RECORDS_MESSAGE]})
    sheets = Counter(
        (r.cycle_year, r.cycle_month)
        for r in (*mine, *theirs)
        if r.record_kind == LegacyRecordKind.GRADING_RESULT
    )
    if any(count > 1 for count in sheets.values()):
        raise ValidationError(
            {"other": ["Two results on one sheet cannot be one person."]},
        )

    # The firmer decision stays; ties keep this person's.
    keeper = (
        other
        if _STRENGTH[LegacyPersonState(other.state)]
        > _STRENGTH[LegacyPersonState(person.state)]
        else person
    )
    same = _decision(person) == _decision(other)
    every = LegacyGradingRecord.objects.select_for_update(of=("self",)).filter(
        person=other,
    )
    moved = list(every.order_by("pk"))
    if same or keeper is other:
        _set_records(moved, person=person)
    else:
        _set_records(moved, person=person, person_confirmed=False)
    if keeper is other and not same:
        _set_records(mine, person_confirmed=False)
    if keeper is other:
        person.state = other.state
        person.student_id = other.student_id
        person.not_a_student_reason = other.not_a_student_reason
        person.note = other.note
        person.decided_by_id = other.decided_by_id
        person.decided_by_title = other.decided_by_title
        person.decided_at = other.decided_at
        person.save()
    other.delete()
    # Rated again from the records now theirs, and its version raised.
    refresh_people([person.pk])
    person.refresh_from_db()
    record(
        AuditAction.LEGACY_PERSON_MERGED,
        person,
        f"Historical person {other_id} merged into person {person.pk}.",
        actor=actor,
        metadata={
            "person_id": person.pk,
            "merged_person_id": other_id,
            "records_moved": len(moved),
            "decision_kept": person.state,
            "record_ids": _record_ids(moved),
            **({"student_id": person.student_id} if person.student_id else {}),
        },
    )
    return person


@transaction.atomic
def confirm_people(
    confirmations: Sequence[tuple[int, int, int]],
    *,
    actor: User,
) -> list[LegacyPerson]:
    """Confirm many people ready to confirm at once, each to the student
    suggested for them, all or nothing: (person id, student id, version).

    Each must still be ready, with that student the one who fits, when the
    locks are held: an import, a correction or another administrator may
    have moved them since the list was shown. A refusal names the person
    (their id as the error key) and nothing is linked.
    """
    students = lock_students({student_id for _, student_id, _ in confirmations})
    people = _lock_people(person_id for person_id, _, _ in confirmations)
    confirmations = sorted(confirmations)
    errors: dict[str, list[str]] = {}
    seen: dict[int, int] = {}
    for person_id, student_id, version in confirmations:
        if seen.setdefault(person_id, student_id) != student_id:
            errors.setdefault(str(person_id), []).append(
                "This person is given two different students.",
            )
        try:
            _checked(people, person_id, version)
        except ValidationError as refused:
            errors.setdefault(str(person_id), []).extend(refused.messages)
        if student_id not in students:
            errors.setdefault(str(person_id), []).append(
                "This student no longer exists.",
            )
    if errors:
        raise ValidationError(errors)

    views = {
        view.person.pk: view
        for view in person_views(LegacyPerson.objects.filter(pk__in=people))
    }
    suggest_students(views.values())
    links: list[_Link] = []
    for person_id, student_id in seen.items():
        view = views.get(person_id)
        if (
            view is None
            or view.queue != PersonQueue.READY
            or view.candidates[0].student.pk != student_id
        ):
            errors[str(person_id)] = [
                "This person is no longer ready to confirm with this student.",
            ]
            continue
        try:
            link = _prepare_link(people[person_id], students[student_id], replace=False)
        except ValidationError as refused:
            errors[str(person_id)] = refused.messages
            continue
        assert link is not None
        links.append(link)
    if errors:
        raise ValidationError(errors)
    for link in links:
        _apply_link(link, actor=actor, together=True)
    return [link.person for link in links]
