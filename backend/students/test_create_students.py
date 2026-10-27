"""Many students at once, under the same rules as one."""

from __future__ import annotations

from datetime import date

import pytest
from django.core.exceptions import ValidationError

from accounts.models import User
from audit.models import AuditAction, AuditEvent
from kukgrade.testing import interleave
from ranks.models import Rank
from students.models import Student
from students.services import (
    TAKEN_MESSAGE,
    NewStudent,
    create_student,
    create_students,
    delete_student,
    update_student,
)

pytestmark = pytest.mark.django_db


def new(wksa_id: str, rank: str = "WHITE", **overrides: object) -> NewStudent:
    fields: dict[str, object] = {
        "wksa_id": wksa_id,
        "first_name": "Alex",
        "last_name": "Kim",
        "date_of_birth": date(2012, 5, 1),
        "current_rank": Rank.objects.get(code=rank),
    }
    fields.update(overrides)
    return NewStudent(**fields)  # type: ignore[arg-type]


def admin() -> User:
    user, _ = User.objects.get_or_create(
        email="bulk-students@example.com",
        defaults={"role": User.Role.ADMINISTRATOR, "first_name": "Bea"},
    )
    return user


def refusal(raised: pytest.ExceptionInfo[ValidationError]) -> dict[str, list[str]]:
    return raised.value.message_dict


def test_each_is_created_and_audited_as_one_created_alone_would_be() -> None:
    actor = admin()
    alone = create_student(
        wksa_id="206-2-100",
        first_name="Alex",
        last_name="Kim",
        date_of_birth=date(2012, 5, 1),
        current_rank=Rank.objects.get(code="WHITE"),
        actor=actor,
    )

    created = create_students(
        [new(" 206-2-101 "), new("a-20819", "JKN", status=Student.Status.INACTIVE)],
        actor=actor,
    )

    assert [student.wksa_id for student in created] == ["206-2-101", "A-20819"]
    assert all(student.pk for student in created)
    assert created[1].status == Student.Status.INACTIVE
    events = {
        event.entity_id: event
        for event in AuditEvent.objects.filter(action=AuditAction.STUDENT_CREATED)
    }
    single = events[str(alone.pk)]
    for student in created:
        event = events[str(student.pk)]
        assert event.summary == f"Student {student} created."
        assert (event.actor, event.actor_email, event.actor_name) == (
            single.actor,
            single.actor_email,
            single.actor_name,
        )
        assert event.entity_type == "Student"
        assert event.metadata == single.metadata == {}


@pytest.mark.parametrize(
    ("wksa_id", "rank", "overrides", "message"),
    [
        ("NOT-AN-ID", "WHITE", {}, "Use a student ID"),
        ("206-2-150", "JKN", {}, "A black belt rank needs a black belt ID"),
        ("206-2-150", "WHITE", {"last_name": ""}, "Last name is required."),
        (
            "206-2-150",
            "WHITE",
            {"date_of_birth": date(2999, 1, 1)},
            "cannot be in the future",
        ),
    ],
)
def test_one_refusal_creates_none_of_them(
    wksa_id: str,
    rank: str,
    overrides: dict[str, object],
    message: str,
) -> None:
    bad = new(wksa_id, rank, **overrides)
    with pytest.raises(ValidationError) as raised:
        create_students([new("206-2-001"), bad], actor=admin())

    assert any(message in text for text in refusal(raised)[bad.wksa_id.strip()])
    assert not Student.objects.exists()
    assert not AuditEvent.objects.exists()


def test_an_id_given_twice_is_refused() -> None:
    with pytest.raises(ValidationError) as raised:
        create_students([new("206-2-001"), new("206-2-001")], actor=admin())

    assert refusal(raised) == {"206-2-001": ["This WKSA ID is given twice."]}


def test_an_id_held_now_before_or_by_a_deleted_student_is_refused() -> None:
    actor = admin()
    create_students([new("206-2-001")], actor=actor)
    black_belt = create_students([new("206-2-002", "DAHN_BO")], actor=actor)[0]
    update_student(black_belt, wksa_id="A-20000", actor=actor)
    gone = create_students([new("206-2-003")], actor=actor)[0]
    delete_student(gone, actor)

    with pytest.raises(ValidationError) as raised:
        create_students(
            [new("206-2-001"), new("206-2-002"), new("206-2-003"), new("206-2-004")],
            actor=actor,
        )

    assert refusal(raised) == {
        "206-2-001": [TAKEN_MESSAGE],
        "206-2-002": [TAKEN_MESSAGE],
        "206-2-003": [TAKEN_MESSAGE],
    }
    assert not Student.objects.filter(wksa_id="206-2-004").exists()


def test_nothing_given_creates_nothing() -> None:
    assert create_students([], actor=admin()) == []


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@pytest.mark.concurrency
def test_a_student_created_alone_meanwhile_holds_the_bulk_back_then_refuses_it() -> (
    None
):
    actor = admin()

    alone, bulk = interleave(
        lambda: create_student(
            wksa_id="206-2-001",
            first_name="First",
            last_name="Here",
            date_of_birth=date(2012, 5, 1),
            current_rank=Rank.objects.get(code="WHITE"),
            actor=actor,
        ),
        lambda: create_students([new("206-2-001"), new("206-2-002")], actor=actor),
        pause_first_at="students.services.record",
    )

    assert isinstance(alone, Student)
    assert isinstance(bulk, ValidationError), bulk
    assert bulk.message_dict == {"206-2-001": [TAKEN_MESSAGE]}
    assert list(Student.objects.values_list("first_name", flat=True)) == ["First"]
