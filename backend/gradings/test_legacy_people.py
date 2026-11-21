"""Suggested students and record corrections for historical records.

Suggestions only - KukGrade never links on its own. The
names are written as the club's workbook writes them: first names, initials,
a title in front, a slip in the spelling. Synthetic names only.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date

import pytest
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from accounts.models import User
from data_imports.testing import legacy_batch, legacy_record
from gradings.legacy_matching import (
    name_tokens,
    names_compatible,
    score_student,
)
from gradings.legacy_services import (
    link_legacy_record_to_student,
    resolve_legacy_rank,
    unlink_legacy_record_from_student,
    void_legacy_record,
)
from gradings.models import LegacyGradingRecord, LegacyRankField
from kukgrade.testing import interleave, results
from ranks.models import Rank
from students.models import Student
from students.services import delete_student

pytestmark = pytest.mark.django_db


CURRENT_RANK = LegacyRankField.CURRENT_RANK

PEOPLE = "/api/gradings/legacy-records/people/"
BULK = "/api/gradings/legacy-records/bulk-link/"
BULK_UNLINK = "/api/gradings/legacy-records/bulk-unlink/"
SUMMARY = "/api/gradings/legacy-records/people-summary/"
SET_ASIDE = "/api/gradings/legacy-records/people/set-aside/"


def rank(code: str) -> Rank:
    return Rank.objects.get(code=code)


def student(
    first: str, last: str, rank_code: str = "BLUE", wksa_id: str = ""
) -> Student:
    number = Student.objects.count() + 1
    return Student.objects.create(
        wksa_id=wksa_id or f"123-4-{number:03d}",
        first_name=first,
        last_name=last,
        date_of_birth=date(2012, 5, 1),
        current_rank=rank(rank_code),
    )


def admin(email: str = "people-admin@example.com") -> User:
    user, _ = User.objects.get_or_create(
        email=email,
        defaults={"role": User.Role.ADMINISTRATOR},
    )
    return user


def instructor(email: str) -> User:
    return User.objects.create_user(email=email, role=User.Role.INSTRUCTOR)


def client_for(user: User | None) -> APIClient:
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


# --- matching --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("written", "tokens"),
    [
        ("Tom W", ["tom", "w"]),
        ("JKN Kai", ["kai"]),
        ("  Kai   P. ", ["kai", "p"]),
        ("Nell Garrety", ["nell", "garrety"]),
        ("Kit (White Belt)", ["kit"]),
        ("Kit (White", ["kit"]),
        ("Ivo Lund-Hart", ["ivo", "lund-hart"]),
    ],
)
def test_a_name_is_compared_without_titles_or_punctuation(
    written: str,
    tokens: list[str],
) -> None:
    assert name_tokens(written) == tokens


@pytest.mark.parametrize(
    ("one", "other"),
    [
        ("Kit B", "Kit B"),
        ("Omar", "Omar Haddad"),
        ("Finn C", "Fin Cole"),
        ("Ruby Moss", "Rubi Moss"),
        ("Mara Quinlan", "Mara Quinlen"),
        ("JKN Cara", "cara"),
        ("Ben Marsh", "Benjamin Marsh"),
        ("Benj M", "Benjamin Marsh"),
        ("Ivo Hart", "Ivo Lund-Hart"),
        ("Ivo Lund-Hart", "Ivo Lunt Hart"),
        ("Ivo James Lund-Hart", "Ivo James Hart"),
        ("Kit (White Belt)", "Kit B"),
    ],
)
def test_names_that_could_be_one_person_are_compatible(one: str, other: str) -> None:
    assert names_compatible(name_tokens(one), name_tokens(other))
    assert names_compatible(name_tokens(other), name_tokens(one))


@pytest.mark.parametrize(
    ("one", "other"),
    [
        ("Cara P", "Cara K"),
        ("Omar Haddad", "Omar Smith"),
        ("Tom", "Max"),
        ("Mo", "Mi"),
        ("Ruby Moss", "Ruby Mossington"),
        ("", "Cara"),
        # A shortened first name is one person only with a surname to go by.
        ("Kit", "Kitson"),
        ("Kit", "Kitson Lee"),
        ("Ben Marsh", "Benjamin Cole"),
        ("Al Marsh", "Alan Marsh"),
        ("Ivo Hart", "Ivo Lund-Smith"),
        # Only the surname's parts count, never a middle name both give.
        ("Ivo James Lund-Hart", "Ivo James Cole"),
    ],
)
def test_names_that_cannot_be_one_person_are_not(one: str, other: str) -> None:
    assert not names_compatible(name_tokens(one), name_tokens(other))
    assert not names_compatible(name_tokens(other), name_tokens(one))


@pytest.mark.parametrize(
    ("written", "first", "last", "reasons"),
    [
        ("Tom", "Tom", "Wood", ["Same first name"]),
        ("Tom W", "Tom", "Wood", ["Same first name", "Surname initial matches"]),
        ("Tom Wood", "Tom", "Wood", ["Same first name", "Same surname"]),
        ("Jonathon", "Jonathan", "Bell", ["First name close to Jonathan"]),
        ("Wood Tom", "Tom", "Wood", ["Same name, written surname first"]),
        (
            "Nell Garrety",
            "Nell",
            "Garrity",
            ["Same first name", "Surname close to Garrity"],
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
        ("Tom B", "Tom", "Wood"),
        ("Tom Brown", "Tom", "Wood"),
        ("Max", "Tom", "Wood"),
    ],
)
def test_a_contradicting_name_rules_a_student_out(
    written: str,
    first: str,
    last: str,
) -> None:
    assert score_student(name_tokens(written), student(first, last), None) is None


def test_a_rank_that_fits_counts_for_a_student_and_a_lower_one_against() -> None:
    blue_now = student("Tom", "Wood", "BLUE")
    white_now = student("Tom", "Ward", "WHITE")

    fits = score_student(name_tokens("Tom"), blue_now, rank("YELLOW"))
    # Nobody goes down a grade: on a first name alone, a student at a lower
    # rank now than the record gave is not suggested at all...
    assert score_student(name_tokens("Tom"), white_now, rank("YELLOW")) is None
    # ...and with a surname that fits too, they are, with the reason said.
    lower = score_student(name_tokens("Tom Ward"), white_now, rank("YELLOW"))

    assert fits is not None and lower is not None
    assert fits.reasons[-1] == "Rank fits: Blue now, Yellow then"
    assert lower.reasons[-1] == "Lower rank now (White) than then (Yellow)"
    assert lower.score < score_student(name_tokens("Tom Ward"), white_now, None).score  # type: ignore[union-attr]


# --- the people endpoint ---------------------------------------------------------


def seeded_names() -> None:
    """One name each: clearly Tom Wood, between two Theos, and nobody."""
    student("Tom", "Wood")
    student("Theo", "Barker")
    student("Theo", "Lane")
    legacy_record(source_name="Tom W")
    legacy_record(source_name="Theo")
    legacy_record(source_name="Nobody Known")


# --- bulk links ------------------------------------------------------------------


# --- bulk unlinks (Undo) ----------------------------------------------------------


# --- a voided record stays as it is -------------------------------------------------


def test_a_voided_record_cannot_be_linked_unlinked_or_given_a_rank() -> None:
    tom = student("Tom", "Wood")
    record = legacy_record(source_name="Tom W", student=tom)
    void_legacy_record(record, reason="Entered twice", actor=admin())

    changes: tuple[Callable[[], object], ...] = (
        lambda: link_legacy_record_to_student(
            record, student("Max", "Lee"), actor=admin()
        ),
        lambda: unlink_legacy_record_from_student(record, actor=admin()),
        lambda: resolve_legacy_rank(record, CURRENT_RANK, rank("WHITE"), actor=admin()),
    )
    for change in changes:
        with pytest.raises(ValidationError, match="voided"):
            change()


def test_a_student_with_a_voided_record_can_still_be_deleted() -> None:
    tom = student("Tom", "Wood")
    record = legacy_record(source_name="Tom W", student=tom)
    void_legacy_record(record, reason="Entered twice", actor=admin())

    # The record is history, so Tom's record is kept with it.
    assert delete_student(tom, admin()) is False

    record.refresh_from_db()
    assert record.student_id == tom.pk


# --- the record list -------------------------------------------------------------


def test_the_record_list_filters_by_import_name_and_unmatched_rank() -> None:
    batch = legacy_batch()
    needs = legacy_record(
        source_batch=batch,
        source_name="Tom W",
        source_current_rank_text="Yellow Belt",
    )
    matched = legacy_record(
        source_batch=batch,
        source_name="Max",
        source_current_rank_text="White",
        current_rank=rank("WHITE"),
    )
    legacy_record(source_name="Tom W")
    client = client_for(admin())
    url = "/api/gradings/legacy-records/"

    def ids(**params: str | int) -> set[int]:
        return {row["id"] for row in results(client.get(url, params))}

    assert ids(batch=batch.pk) == {needs.pk, matched.pk}
    assert ids(batch=batch.pk, needs_rank="true") == {needs.pk}
    assert ids(batch=batch.pk, needs_rank="false") == {matched.pk}
    assert len(ids(source_name="tom w")) == 2
    assert ids(search="ma") == {matched.pk}
    row = next(
        r
        for r in results(client.get(url, {"batch": batch.pk}))
        if r["id"] == matched.pk
    )
    assert row["current_rank_name"] == "White"
    assert row["report"] == "" and row["note"] == ""


def test_the_record_list_counts_the_records_awaiting_a_student() -> None:
    batch = legacy_batch()
    waiting = legacy_record(source_batch=batch, source_name="Tom W")
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


def test_the_counts_say_how_many_records_await_a_student_for_either_role() -> None:
    batch, other = legacy_batch(), legacy_batch()
    legacy_record(source_batch=batch, source_name="Tom W")
    legacy_record(source_batch=batch, source_name="Max", student=student("Max", "Lee"))
    legacy_record(source_batch=batch, source_name="Sheet note")
    voided = legacy_record(source_batch=batch, source_name="Ann B")
    void_legacy_record(voided, reason="Entered twice", actor=admin())
    legacy_record(source_batch=other, source_name="Theo")
    instructor = User.objects.create_user(
        email="counts-instructor@example.com",
        role=User.Role.INSTRUCTOR,
    )
    url = "/api/gradings/legacy-records/counts/"

    assert client_for(admin()).get(url).json() == {"awaiting_link": 2}
    assert client_for(instructor).get(url, {"batch": batch.pk}).json() == {
        "awaiting_link": 1
    }
    assert client_for(admin()).get(url, {"linked": "true"}).status_code == 400
    assert APIClient().get(url).status_code in {401, 403}


# --- linking while the student is deleted -----------------------------------------


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@pytest.mark.concurrency
def test_a_link_made_while_the_student_is_deleted_waits_then_is_refused() -> None:
    """Linking locks the student before the record, as deleting does, so the
    two cannot each wait on the other; the link sees the student gone."""
    tom = student("Tom", "Wood")
    record = legacy_record(source_name="Tom W")
    actor = admin()

    deleted, linked = interleave(
        lambda: delete_student(Student.objects.get(pk=tom.pk), actor),
        lambda: link_legacy_record_to_student(
            LegacyGradingRecord.objects.get(pk=record.pk),
            tom,
            actor=actor,
        ),
        pause_first_at="students.services.record",
    )

    assert deleted is True
    assert isinstance(linked, ValidationError), linked
    record.refresh_from_db()
    assert record.student_id is None
