"""Suggested students and bulk links for historical records (import overhaul A6).

Suggestions only - KukGrade never links on its own (import Decision 3). The
names are written as the club's workbook writes them: first names, initials,
a title in front, a slip in the spelling. Synthetic names only.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date
from typing import Any

import pytest
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditAction, AuditEvent
from data_imports.testing import legacy_batch, legacy_record
from gradings.legacy_matching import name_tokens, person_groups, score_student
from gradings.legacy_services import (
    bulk_link_legacy_records,
    link_legacy_record_to_student,
    resolve_legacy_current_rank,
    unlink_legacy_record_from_student,
    void_legacy_record,
)
from gradings.models import LegacyGradingRecord
from kukgrade.testing import interleave, results
from ranks.models import Rank
from students.models import Student
from students.services import delete_student

pytestmark = pytest.mark.django_db

PEOPLE = "/api/gradings/legacy-records/people/"
BULK = "/api/gradings/legacy-records/bulk-link/"


def rank(code: str) -> Rank:
    return Rank.objects.get(code=code)


def student(
    first: str, last: str, rank_code: str = "BLUE", wksa_id: str = ""
) -> Student:
    number = Student.objects.count() + 1
    return Student.objects.create(
        wksa_id=wksa_id or f"206-2-{number:03d}",
        first_name=first,
        last_name=last,
        date_of_birth=date(2012, 5, 1),
        current_rank=rank(rank_code),
    )


def admin() -> User:
    user, _ = User.objects.get_or_create(
        email="people-admin@example.com",
        defaults={"role": User.Role.ADMINISTRATOR},
    )
    return user


def client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


# --- matching --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("written", "tokens"),
    [
        ("Zac W", ["zac", "w"]),
        ("JKN Alex", ["alex"]),
        ("  Alex   P. ", ["alex", "p"]),
        ("Hollie Tierny", ["hollie", "tierny"]),
    ],
)
def test_a_name_is_compared_without_titles_or_punctuation(
    written: str,
    tokens: list[str],
) -> None:
    assert name_tokens(written) == tokens


@pytest.mark.parametrize(
    ("written", "first", "last", "reasons"),
    [
        ("Zac", "Zac", "Wood", ["Same first name"]),
        ("Zac W", "Zac", "Wood", ["Same first name", "Surname initial matches"]),
        ("Zac Wood", "Zac", "Wood", ["Same first name", "Same surname"]),
        ("Sabastian", "Sebastian", "Bell", ["First name close to Sebastian"]),
        ("Wood Zac", "Zac", "Wood", ["Same name, written surname first"]),
        (
            "Hollie Tierny",
            "Hollie",
            "Tierney",
            ["Same first name", "Surname close to Tierney"],
        ),
    ],
)
def test_how_a_written_name_fits_a_student(
    written: str,
    first: str,
    last: str,
    reasons: list[str],
) -> None:
    fit = score_student(name_tokens(written), student(first, last), None)

    assert fit is not None
    assert list(fit.reasons) == reasons


@pytest.mark.parametrize(
    ("written", "first", "last"),
    [
        ("Zac B", "Zac", "Wood"),
        ("Zac Brown", "Zac", "Wood"),
        ("Max", "Zac", "Wood"),
    ],
)
def test_a_contradicting_name_rules_a_student_out(
    written: str,
    first: str,
    last: str,
) -> None:
    assert score_student(name_tokens(written), student(first, last), None) is None


def test_a_rank_that_fits_counts_for_a_student_and_a_lower_one_against() -> None:
    blue_now = student("Zac", "Wood", "BLUE")
    white_now = student("Zac", "Ward", "WHITE")

    fits = score_student(name_tokens("Zac"), blue_now, rank("YELLOW"))
    # Nobody goes down a grade: on a first name alone, a student at a lower
    # rank now than the record gave is not suggested at all...
    assert score_student(name_tokens("Zac"), white_now, rank("YELLOW")) is None
    # ...and with a surname that fits too, they are, with the reason said.
    lower = score_student(name_tokens("Zac Ward"), white_now, rank("YELLOW"))

    assert fits is not None and lower is not None
    assert fits.reasons[-1] == "Rank fits: Blue now, Yellow then"
    assert lower.reasons[-1] == "Lower rank now (White) than then (Yellow)"
    assert lower.score < score_student(name_tokens("Zac Ward"), white_now, None).score  # type: ignore[union-attr]


def test_records_are_grouped_by_the_name_as_written_with_suggestions() -> None:
    zac = student("Zac", "Wood", "RED")
    batch = legacy_batch()
    first = legacy_record(
        source_batch=batch,
        source_name="Zac W",
        source_testing_for_rank_text="Yellow Belt",
    )
    second = legacy_record(source_batch=batch, source_name="zac w.")
    legacy_record(source_batch=batch, source_name="Sheet note")
    voided = legacy_record(source_batch=batch, source_name="Zac W")
    void_legacy_record(voided, reason="Entered twice", actor=admin())

    [group] = person_groups(LegacyGradingRecord.objects.all())

    assert sorted(record.pk for record in group.records) == sorted(
        [first.pk, second.pk]
    )
    assert [candidate.student for candidate in group.candidates] == [zac]
    assert group.candidates[0].reasons == (
        "Same first name",
        "Surname initial matches",
        "Rank fits: Red now, Yellow then",
    )
    assert not group.shared


def test_two_students_who_fit_equally_well_are_both_shown_and_flagged() -> None:
    student("Alex", "Kim")
    student("Alex", "Park")
    legacy_record(source_name="Alex")

    [group] = person_groups(LegacyGradingRecord.objects.all())

    assert len(group.candidates) == 2
    assert group.shared


# --- the people endpoint ---------------------------------------------------------


def test_people_lists_groups_and_suggestions_for_the_screen() -> None:
    zac = student("Zac", "Wood", "RED")
    batch = legacy_batch()
    record = legacy_record(source_batch=batch, source_name="Zac W", cycle_year=2024)
    legacy_record(source_batch=batch, source_name="Zac W", cycle_year=2025)
    other = legacy_batch()
    legacy_record(source_batch=other, source_name="Someone Else")
    client = client_for(admin())

    [person] = results(client.get(PEOPLE, {"batch": batch.pk}))

    assert person["source_name"] == "Zac W"
    assert person["records"] == 2
    assert record.pk in person["record_ids"]
    assert (person["first_period"], person["last_period"]) == ("2024-06", "2025-06")
    assert person["linked_student"] is None
    assert person["candidates"][0]["student"] == zac.pk
    assert person["candidates"][0]["full_name"] == "Zac Wood"
    assert person["candidates"][0]["current_rank_name"] == "Red"
    assert person["shared"] is False


def test_people_filters_by_linked_and_refuses_anything_else() -> None:
    zac = student("Zac", "Wood")
    legacy_record(source_name="Zac W", student=zac)
    legacy_record(source_name="Max")
    client = client_for(admin())

    assert [
        p["source_name"] for p in results(client.get(PEOPLE, {"linked": "false"}))
    ] == [
        "Max",
    ]
    linked = results(client.get(PEOPLE, {"linked": "true"}))
    assert [p["linked_student"] for p in linked] == [zac.pk]
    assert client.get(PEOPLE, {"colour": "red"}).status_code == 400


def test_unlinked_people_include_only_records_still_waiting() -> None:
    first, second = student("Zac", "Wood"), student("Zac", "Ward")
    legacy_record(source_name="Zac W", student=first)
    legacy_record(source_name="zac w.", student=second)
    waiting = legacy_record(source_name="JKN Zac W")
    client = client_for(admin())

    [person] = results(client.get(PEOPLE, {"linked": "false"}))
    assert person["record_ids"] == [waiting.pk]
    assert person["group_key"] == "zac w"

    link_legacy_record_to_student(waiting, first, actor=admin())
    assert results(client.get(PEOPLE, {"linked": "false"})) == []
    linked = results(client.get(PEOPLE, {"linked": "true"}))
    assert linked[0]["records"] == 3
    assert linked[0]["linked_student"] is None


def test_group_key_lists_all_name_variants_in_one_batch() -> None:
    first_batch, other_batch = legacy_batch(), legacy_batch()
    first = legacy_record(source_batch=first_batch, source_name="Zac W")
    second = legacy_record(source_batch=first_batch, source_name="JKN zac w.")
    legacy_record(source_batch=other_batch, source_name="zac w")
    client = client_for(admin())

    [person] = results(
        client.get(PEOPLE, {"batch": str(first_batch.pk), "linked": "false"})
    )
    params = {
        "batch": str(first_batch.pk),
        "linked": "false",
        "voided": "false",
        "group_key": str(person["group_key"]),
    }
    response = client.get(
        "/api/gradings/legacy-records/",
        params,
    )

    assert response.status_code == 200
    assert {row["id"] for row in results(response)} == {first.pk, second.pk}
    assert (
        results(client.get("/api/gradings/legacy-records/", {"group_key": "other"}))
        == []
    )


def test_group_records_remain_paginated_when_more_than_one_page() -> None:
    records = [legacy_record(source_name="Zac W") for _ in range(101)]
    client = client_for(admin())
    [person] = results(client.get(PEOPLE, {"linked": "false"}))

    first = client.get(
        "/api/gradings/legacy-records/",
        {"group_key": person["group_key"], "page_size": 100},
    ).json()
    second = client.get(
        "/api/gradings/legacy-records/",
        {"group_key": person["group_key"], "page_size": 100, "page": 2},
    ).json()

    assert first["count"] == second["count"] == 101
    assert {row["id"] for row in first["results"] + second["results"]} == {
        record.pk for record in records
    }


def test_instructors_cannot_see_suggestions_or_link_in_bulk() -> None:
    instructor = User.objects.create_user(
        email="people-instructor@example.com",
        role=User.Role.INSTRUCTOR,
    )
    client = client_for(instructor)

    assert client.get(PEOPLE).status_code == 403
    assert client.post(BULK, {"links": []}, format="json").status_code == 403


# --- bulk links ------------------------------------------------------------------


def test_a_persons_whole_history_is_linked_at_once_each_audited() -> None:
    zac = student("Zac", "Wood")
    records = [legacy_record(source_name="Zac W") for _ in range(3)]

    response = client_for(admin()).post(
        BULK,
        {"links": [{"record": record.pk, "student": zac.pk} for record in records]},
        format="json",
    )

    assert response.status_code == 200, response.json()
    assert {row["student"] for row in response.json()} == {zac.pk}
    assert set(
        LegacyGradingRecord.objects.values_list("student_id", flat=True),
    ) == {zac.pk}
    assert (
        AuditEvent.objects.filter(action=AuditAction.LEGACY_GRADING_LINKED).count() == 3
    )


def test_one_refusal_links_none_of_them_and_names_the_record() -> None:
    zac = student("Zac", "Wood")
    good = legacy_record(source_name="Zac W")
    voided = legacy_record(source_name="Zac W")
    void_legacy_record(voided, reason="Entered twice", actor=admin())

    with pytest.raises(ValidationError) as refused:
        bulk_link_legacy_records([(good, zac), (voided, zac)], actor=admin())

    assert list(refused.value.message_dict) == [str(voided.pk)]
    assert "voided" in refused.value.message_dict[str(voided.pk)][0]
    good.refresh_from_db()
    assert good.student_id is None


def test_a_record_given_two_students_is_refused() -> None:
    record = legacy_record(source_name="Zac W")

    with pytest.raises(ValidationError, match="two different students"):
        bulk_link_legacy_records(
            [(record, student("Zac", "Wood")), (record, student("Zac", "Ward"))],
            actor=admin(),
        )


def test_moving_records_linked_elsewhere_needs_replace() -> None:
    first, second = student("Zac", "Wood"), student("Zac", "Ward")
    record = legacy_record(source_name="Zac W", student=first)
    client = client_for(admin())
    body: dict[str, Any] = {"links": [{"record": record.pk, "student": second.pk}]}

    refused = client.post(BULK, body, format="json")
    moved = client.post(BULK, {**body, "replace": True}, format="json")

    assert refused.status_code == 400
    assert "already linked to another student" in str(refused.json())
    assert moved.status_code == 200
    record.refresh_from_db()
    assert record.student_id == second.pk


def test_too_many_at_once_is_refused() -> None:
    zac = student("Zac", "Wood")
    record = legacy_record(source_name="Zac W")

    response = client_for(admin()).post(
        BULK,
        {"links": [{"record": record.pk, "student": zac.pk}] * 501},
        format="json",
    )

    assert response.status_code == 400
    assert "at most 500" in str(response.json())


# --- a voided record stays as it is -------------------------------------------------


def test_a_voided_record_cannot_be_linked_unlinked_or_given_a_rank() -> None:
    zac = student("Zac", "Wood")
    record = legacy_record(source_name="Zac W", student=zac)
    void_legacy_record(record, reason="Entered twice", actor=admin())

    changes: tuple[Callable[[], object], ...] = (
        lambda: link_legacy_record_to_student(
            record, student("Max", "Lee"), actor=admin()
        ),
        lambda: unlink_legacy_record_from_student(record, actor=admin()),
        lambda: resolve_legacy_current_rank(record, rank("WHITE"), actor=admin()),
    )
    for change in changes:
        with pytest.raises(ValidationError, match="voided"):
            change()


def test_a_student_with_a_voided_record_can_still_be_deleted() -> None:
    zac = student("Zac", "Wood")
    record = legacy_record(source_name="Zac W", student=zac)
    void_legacy_record(record, reason="Entered twice", actor=admin())

    delete_student(zac, admin())

    record.refresh_from_db()
    assert record.student_id is None


# --- the record list -------------------------------------------------------------


def test_the_record_list_filters_by_import_name_and_unmatched_rank() -> None:
    batch = legacy_batch()
    needs = legacy_record(
        source_batch=batch,
        source_name="Zac W",
        source_current_rank_text="Yellow Belt",
    )
    matched = legacy_record(
        source_batch=batch,
        source_name="Max",
        source_current_rank_text="White",
        current_rank=rank("WHITE"),
    )
    legacy_record(source_name="Zac W")
    client = client_for(admin())
    url = "/api/gradings/legacy-records/"

    def ids(**params: str | int) -> set[int]:
        return {row["id"] for row in results(client.get(url, params))}

    assert ids(batch=batch.pk) == {needs.pk, matched.pk}
    assert ids(batch=batch.pk, needs_rank="true") == {needs.pk}
    assert ids(batch=batch.pk, needs_rank="false") == {matched.pk}
    assert len(ids(source_name="zac w")) == 2
    assert ids(search="ma") == {matched.pk}
    row = next(
        r
        for r in results(client.get(url, {"batch": batch.pk}))
        if r["id"] == matched.pk
    )
    assert row["current_rank_name"] == "White"
    assert row["report"] == "" and row["note"] == ""
    assert row["source_batch"] == batch.pk


def test_the_record_list_counts_the_records_awaiting_a_student() -> None:
    batch = legacy_batch()
    waiting = legacy_record(source_batch=batch, source_name="Zac W")
    legacy_record(source_batch=batch, source_name="Max", student=student("Max", "Lee"))
    legacy_record(source_batch=batch, source_name="Sheet note")
    voided = legacy_record(source_batch=batch, source_name="Ann B")
    void_legacy_record(voided, reason="Entered twice", actor=admin())
    client = client_for(admin())
    url = "/api/gradings/legacy-records/"

    awaiting = client.get(f"{url}?batch={batch.pk}&awaiting_link=true").json()
    others = results(client.get(f"{url}?batch={batch.pk}&awaiting_link=false"))

    assert [row["id"] for row in awaiting["results"]] == [waiting.pk]
    assert awaiting["count"] == 1
    assert len(others) == 3
    assert results(client.get(url, {"awaiting_link": "maybe"})) == []


# --- linking while the student is deleted -----------------------------------------


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@pytest.mark.concurrency
def test_a_link_made_while_the_student_is_deleted_waits_then_is_refused() -> None:
    """Linking locks the student before the record, as deleting does, so the
    two cannot each wait on the other; the link sees the student gone."""
    zac = student("Zac", "Wood")
    record = legacy_record(source_name="Zac W")
    actor = admin()

    deleted, linked = interleave(
        lambda: delete_student(Student.objects.get(pk=zac.pk), actor),
        lambda: link_legacy_record_to_student(
            LegacyGradingRecord.objects.get(pk=record.pk),
            zac,
            actor=actor,
        ),
        pause_first_at="students.services.record",
    )

    assert deleted is None
    assert isinstance(linked, ValidationError), linked
    record.refresh_from_db()
    assert record.student_id is None
