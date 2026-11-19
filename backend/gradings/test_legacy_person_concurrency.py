"""Two administrators deciding about one person at once
(gradings.legacy_person_services): one wins, the other is told to look again,
and nothing is half done. Real threads and connections (kukgrade.testing.
interleave). Made-up names only."""

from __future__ import annotations

import pytest
from django.core.exceptions import ValidationError

from accounts.models import User
from audit.models import AuditAction, AuditEntity, AuditEvent
from data_imports.services import commit_legacy_grading_import
from data_imports.testing import grading_workbook, legacy_batch
from data_imports.tests import admin_user
from gradings.legacy_person_services import CHANGED_MESSAGE, link_person, split_person
from gradings.legacy_services import void_legacy_record
from gradings.models import LegacyGradingRecord, LegacyPerson, LegacyPersonState
from gradings.testing import rank, student
from kukgrade.testing import interleave
from students.models import Student

pytestmark = [
    pytest.mark.django_db(transaction=True, serialized_rollback=True),
    pytest.mark.concurrency,
]

PAUSE_AT = "gradings.legacy_person_services.record"


def ada() -> tuple[LegacyPerson, Student, User, list[int]]:
    admin = admin_user()
    batch = legacy_batch(
        grading_workbook(
            {
                "062025": [["Ada Park", "White", "Yellow", "Pass", ""]],
                "122025": [["Ada Park", "Yellow", "Blue", "Pass", ""]],
            },
        ),
        uploaded_by=admin,
    )
    commit_legacy_grading_import(batch, actor=admin)
    person = LegacyPerson.objects.get()
    records = list(
        LegacyGradingRecord.objects.filter(person=person)
        .order_by("cycle_year", "cycle_month")
        .values_list("pk", flat=True),
    )
    ada_park = student(first_name="Ada", last_name="Park", current_rank=rank("BLUE"))
    return person, ada_park, admin, records


def changed(result: object) -> None:
    assert isinstance(result, ValidationError), result
    assert result.message_dict == {"version": [CHANGED_MESSAGE]}


def test_a_link_and_a_split_at_once_one_wins_and_the_other_is_refused() -> None:
    person, ada_park, admin, (first, second) = ada()

    linked, split = interleave(
        lambda: link_person(person.pk, ada_park, version=1, actor=admin),
        lambda: split_person(person.pk, [second], version=1, actor=admin),
        pause_first_at=PAUSE_AT,
    )

    assert isinstance(linked, LegacyPerson), linked
    changed(split)
    # The link, whole: one person, every record theirs and with the student.
    assert LegacyPerson.objects.count() == 1
    person.refresh_from_db()
    assert person.state == LegacyPersonState.LINKED
    assert set(
        LegacyGradingRecord.objects.filter(person=person).values_list(
            "student_id",
            "person_confirmed",
        ),
    ) == {(ada_park.pk, True)}
    assert [
        event.action
        for event in AuditEvent.objects.filter(
            entity_type=AuditEntity.LEGACY_PERSON,
        )
    ] == [AuditAction.LEGACY_PERSON_LINKED]


def test_a_split_and_a_link_at_once_one_wins_and_the_other_is_refused() -> None:
    person, ada_park, admin, (first, second) = ada()

    split, linked = interleave(
        lambda: split_person(person.pk, [second], version=1, actor=admin),
        lambda: link_person(person.pk, ada_park, version=1, actor=admin),
        pause_first_at=PAUSE_AT,
    )

    assert isinstance(split, LegacyPerson), split
    changed(linked)
    # The split, whole: two people, neither linked.
    assert LegacyPerson.objects.count() == 2
    assert not LegacyGradingRecord.objects.filter(student__isnull=False).exists()
    assert LegacyGradingRecord.objects.get(pk=second).person_id == split.pk


def test_a_void_waits_for_a_split_of_its_person() -> None:
    """A record's person is locked before the record, as a decision locks
    them, so a split and a correction to one of the records never deadlock:
    the correction waits, then finds the record has moved."""
    person, _, admin, (first, second) = ada()

    split, voided = interleave(
        lambda: split_person(person.pk, [second], version=1, actor=admin),
        lambda: void_legacy_record(
            LegacyGradingRecord.objects.get(pk=second),
            reason="Entered twice.",
            actor=admin,
        ),
        pause_first_at=PAUSE_AT,
    )

    assert isinstance(split, LegacyPerson), split
    assert isinstance(voided, ValidationError), voided
    assert "moved to another person" in str(voided)
    assert not LegacyGradingRecord.objects.filter(is_void=True).exists()
