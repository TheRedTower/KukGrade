"""A number stays with its student and is never reused (decision log 2026-10-20).

When WKSA hands a student their black belt ID the student ID is replaced; it is
kept as a previous ID, and nobody else may ever take it.
"""

from __future__ import annotations

import importlib
from datetime import date
from typing import Any

import pytest
from django.apps import apps as django_apps
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditAction, AuditEvent
from kukgrade.testing import interleave, results
from ranks.models import Rank
from students.models import PreviousWksaId, RetiredWksaId, Student
from students.services import create_student, delete_student, update_student
from students.wksa_ids import PREVIOUS_ID_TAKEN_MESSAGE

pytestmark = pytest.mark.django_db

OLD = "206-2-150"
NEW = "A-20819"


def dahn_bo(wksa_id: str = OLD, **overrides: Any) -> Student:
    return Student.objects.create(
        **{
            "wksa_id": wksa_id,
            "first_name": "Sam",
            "last_name": "Lee",
            "date_of_birth": date(1990, 1, 1),
            "current_rank": Rank.objects.get(code="DAHN_BO"),
            **overrides,
        },
    )


def promoted(student: Student | None = None) -> Student:
    """A student whose student ID has been replaced by a black belt ID."""
    student = student or dahn_bo()
    return update_student(student, wksa_id=NEW, actor=admin())


def admin() -> User:
    user, _ = User.objects.get_or_create(
        email="previous-ids-admin@example.com",
        defaults={"role": User.Role.ADMINISTRATOR},
    )
    return user


def api() -> APIClient:
    client = APIClient()
    client.force_authenticate(user=admin())
    return client


def new_student_with(wksa_id: str) -> dict[str, Any]:
    return {
        "wksa_id": wksa_id,
        "first_name": "Jo",
        "last_name": "New",
        "date_of_birth": "2012-05-01",
        "current_rank": Rank.objects.get(code="WHITE").pk,
    }


def test_replacing_a_student_id_keeps_it_as_a_previous_id() -> None:
    student = promoted()

    kept = list(student.previous_wksa_ids.all())
    assert [previous.wksa_id for previous in kept] == [OLD]
    assert abs((kept[0].replaced_at - timezone.now()).total_seconds()) < 60
    assert student.wksa_id == NEW


def test_an_edit_that_leaves_the_id_alone_keeps_nothing() -> None:
    student = dahn_bo()

    update_student(student, first_name="Samuel", actor=admin())
    update_student(student, wksa_id=OLD, actor=admin())

    assert not PreviousWksaId.objects.exists()


def test_correcting_a_mistyped_id_keeps_nothing_but_the_audit() -> None:
    """A correction says the old ID was never theirs - it may be someone
    else's real number - so it is neither kept nor retired."""
    student = dahn_bo()

    update_student(student, wksa_id="206-2-151", actor=admin())

    assert not PreviousWksaId.objects.exists()
    student.refresh_from_db()
    assert student.wksa_id == "206-2-151"
    event = AuditEvent.objects.filter(entity_id=str(student.pk)).latest("pk")
    assert event.metadata["before"]["wksa_id"] == OLD
    # The mistyped number is free for its real holder.
    create_student(
        wksa_id=OLD,
        first_name="Real",
        last_name="Holder",
        date_of_birth=date(2012, 5, 1),
        current_rank=Rank.objects.get(code="WHITE"),
        actor=admin(),
    )


def test_a_mistyped_black_belt_id_is_corrected_and_its_previous_id_stays() -> None:
    student = promoted()

    update_student(student, wksa_id="A-20820", actor=admin())

    student.refresh_from_db()
    assert student.wksa_id == "A-20820"
    assert list(student.previous_wksa_ids.values_list("wksa_id", flat=True)) == [OLD]


def test_a_refused_change_keeps_nothing() -> None:
    student = promoted()

    with pytest.raises(ValidationError, match="never goes back to a student ID"):
        update_student(student, wksa_id="206-2-151", actor=admin())

    student.refresh_from_db()
    assert student.wksa_id == NEW
    assert list(PreviousWksaId.objects.values_list("wksa_id", flat=True)) == [OLD]


def test_nobody_else_can_take_a_previous_id() -> None:
    promoted()

    with pytest.raises(ValidationError) as refused:
        create_student(
            wksa_id=OLD,
            first_name="Jo",
            last_name="New",
            date_of_birth=date(2012, 5, 1),
            current_rank=Rank.objects.get(code="WHITE"),
            actor=admin(),
        )

    assert refused.value.message_dict["wksa_id"] == [PREVIOUS_ID_TAKEN_MESSAGE]
    assert Student.objects.count() == 1


def test_the_api_refuses_a_previous_id_in_plain_words() -> None:
    promoted()

    response = api().post("/api/students/", new_student_with(OLD), format="json")

    assert response.status_code == 400
    assert response.json()["error"]["fields"]["wksa_id"] == [PREVIOUS_ID_TAKEN_MESSAGE]


def test_correcting_to_an_id_someone_holds_or_held_is_refused() -> None:
    other = promoted()
    student = dahn_bo("206-2-160")
    client = api()

    for taken in (OLD, NEW):
        response = client.patch(
            f"/api/students/{student.pk}/",
            {"wksa_id": taken},
            format="json",
        )
        assert response.status_code == 400, taken
    student.refresh_from_db()
    assert student.wksa_id == "206-2-160"
    assert other.previous_wksa_ids.count() == 1


def test_the_database_holds_each_previous_id_to_one_student_in_student_form() -> None:
    first = promoted()
    other = dahn_bo("206-2-151")

    with pytest.raises(IntegrityError), transaction.atomic():
        PreviousWksaId.objects.create(student=other, wksa_id=OLD)
    with pytest.raises(IntegrityError), transaction.atomic():
        PreviousWksaId.objects.create(student=first, wksa_id="A-20999")
    with pytest.raises(IntegrityError), transaction.atomic():
        RetiredWksaId.objects.create(wksa_id="DEMO-001")
    with pytest.raises(IntegrityError), transaction.atomic():
        PreviousWksaId.objects.create(student=first, wksa_id="206-2-777")


def test_the_detail_shows_previous_ids_and_the_list_finds_a_student_by_one() -> None:
    student = promoted()
    other = dahn_bo("206-2-151", first_name="Pat")
    client = api()

    detail = client.get(f"/api/students/{student.pk}/").json()
    assert [row["wksa_id"] for row in detail["previous_wksa_ids"]] == [OLD]
    assert client.get(f"/api/students/{other.pk}/").json()["previous_wksa_ids"] == []

    by_old = results(client.get("/api/students/", {"search": OLD}))
    assert [row["id"] for row in by_old] == [student.pk]
    assert by_old[0]["wksa_id"] == NEW
    by_new = results(client.get("/api/students/", {"search": NEW}))
    assert [row["id"] for row in by_new] == [student.pk]
    assert len(results(client.get("/api/students/"))) == 2


def test_the_audit_event_of_the_change_still_names_both() -> None:
    student = promoted()

    event = AuditEvent.objects.filter(
        action=AuditAction.STUDENT_UPDATED,
        entity_id=str(student.pk),
    ).latest("pk")
    assert event.metadata["before"]["wksa_id"] == OLD
    assert event.metadata["after"]["wksa_id"] == NEW


def test_deleting_a_student_records_their_previous_ids() -> None:
    student = promoted()

    delete_student(student, admin())

    event = AuditEvent.objects.get(action=AuditAction.STUDENT_DELETED)
    assert event.metadata["wksa_id"] == NEW
    assert event.metadata["previous_wksa_ids"] == [OLD]
    assert not PreviousWksaId.objects.exists()


@pytest.mark.parametrize("taken", [OLD, NEW])
def test_a_deleted_students_ids_are_never_given_to_anyone_else(taken: str) -> None:
    delete_student(promoted(), admin())

    assert sorted(RetiredWksaId.objects.values_list("wksa_id", flat=True)) == [
        OLD,
        NEW,
    ]
    payload = new_student_with(taken)
    if taken == NEW:
        payload["current_rank"] = Rank.objects.get(code="JKN").pk
    response = api().post("/api/students/", payload, format="json")
    assert response.status_code == 400
    assert response.json()["error"]["fields"]["wksa_id"] == [PREVIOUS_ID_TAKEN_MESSAGE]


def test_a_student_with_no_previous_id_retires_just_their_own() -> None:
    delete_student(dahn_bo(), admin())

    assert list(RetiredWksaId.objects.values_list("wksa_id", flat=True)) == [OLD]


def test_a_roster_row_quoting_a_deleted_students_id_needs_review() -> None:
    from data_imports.services import preview_student_import
    from data_imports.tests import STANDARD_MAPPING, student_workbook, upload_batch

    delete_student(dahn_bo(), admin())
    batch = upload_batch(
        content=student_workbook(
            [[OLD, "Jo", "New", "2012-05-01", "White", "ACTIVE"]],
        ),
        uploaded_by=admin(),
    )

    preview = preview_student_import(batch, column_mapping=STANDARD_MAPPING)

    assert (preview.ready, preview.review_required) == (0, 1)
    assert "was deleted" in " ".join(preview.rows[0].issues)


def test_a_roster_row_quoting_an_old_id_is_an_existing_student() -> None:
    from data_imports.services import preview_student_import
    from data_imports.tests import STANDARD_MAPPING, student_workbook, upload_batch

    promoted()
    batch = upload_batch(
        content=student_workbook(
            [[OLD, "Sam", "Lee", "1990-01-01", "Dahn Bo", "ACTIVE"]],
        ),
        uploaded_by=admin(),
    )

    preview = preview_student_import(batch, column_mapping=STANDARD_MAPPING)

    assert (preview.ready, preview.skip_existing, preview.review_required) == (0, 1, 0)
    assert f"now holds {NEW}" in " ".join(preview.rows[0].issues)


def test_the_migration_carries_over_ids_replaced_before_it_existed() -> None:
    migration = importlib.import_module("students.migrations.0007_previous_wksa_ids")
    student = dahn_bo()
    Student.objects.filter(pk=student.pk).update(wksa_id=NEW)
    for before, after in ((OLD, NEW), (NEW, "A-20820"), ("junk", NEW), (OLD, OLD)):
        AuditEvent.objects.create(
            action=AuditAction.STUDENT_UPDATED,
            entity_type="Student",
            entity_id=str(student.pk),
            summary="x",
            metadata={"before": {"wksa_id": before}, "after": {"wksa_id": after}},
        )
    AuditEvent.objects.create(
        action=AuditAction.STUDENT_UPDATED,
        entity_type="Student",
        entity_id="999999",
        summary="a student since deleted",
        metadata={"before": {"wksa_id": "206-2-999"}, "after": {"wksa_id": "A-20999"}},
    )
    deletion = AuditEvent.objects.create(
        action=AuditAction.STUDENT_DELETED,
        entity_type="Student",
        entity_id="999999",
        summary="deleted after receiving a black belt ID",
        metadata={"wksa_id": "A-20999"},
    )

    AuditEvent.objects.create(
        action=AuditAction.STUDENT_DELETED,
        entity_type="Student",
        entity_id="888888",
        summary="deleted before retirement existed",
        metadata={"wksa_id": "A-30000", "previous_wksa_ids": ["206-2-300"]},
    )
    AuditEvent.objects.create(
        action=AuditAction.STUDENT_DELETED,
        entity_type="Student",
        entity_id="777777",
        summary="an older deletion, with an ID in neither form",
        metadata={"wksa_id": "DEMO-001"},
    )

    migration.carry_over_from_audit(django_apps, None)

    assert list(PreviousWksaId.objects.values_list("wksa_id", flat=True)) == [OLD]
    assert sorted(RetiredWksaId.objects.values_list("wksa_id", flat=True)) == [
        "206-2-300",
        "206-2-999",
        "A-20999",
        "A-30000",
    ]
    assert (
        RetiredWksaId.objects.get(wksa_id="206-2-999").retired_at
        == deletion.occurred_at
    )
    migration.carry_over_from_audit(django_apps, None)
    assert PreviousWksaId.objects.count() == 1
    assert RetiredWksaId.objects.count() == 4


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@pytest.mark.concurrency
def test_a_student_created_while_the_id_is_being_replaced_is_refused() -> None:
    """The ID moves from one table to the other: neither check alone sees it.

    Created at that moment, a student could pass the student table's unique
    index (the ID is about to be free) and the previous-ID check (not yet
    written). The ID's lock makes the creation wait, then see the result.
    """
    student = dahn_bo()
    stale = Student.objects.get(pk=student.pk)
    actor = admin()
    creator = admin()

    replaced, created = interleave(
        lambda: update_student(stale, wksa_id=NEW, actor=actor),
        lambda: create_student(
            wksa_id=OLD,
            first_name="Jo",
            last_name="New",
            date_of_birth=date(2012, 5, 1),
            current_rank=Rank.objects.get(code="WHITE"),
            actor=creator,
        ),
        pause_first_at="students.services.record",
    )

    assert isinstance(replaced, Student)
    assert isinstance(created, ValidationError), created
    assert PREVIOUS_ID_TAKEN_MESSAGE in created.messages
    assert Student.objects.filter(wksa_id=OLD).count() == 0
    assert PreviousWksaId.objects.filter(wksa_id=OLD).count() == 1
