"""Every list's search box, through the API, on the cases a person actually types.

The cases are the ones that failed with the old per-word `icontains`: a date or
status word shown on the screen, an accent, a part of a word, a slip of the
keyboard, a different order of words. One engine (kukgrade/search.py) serves
every list, so one set of behaviours is tested here and each list is shown to
use it.
"""

from __future__ import annotations

from datetime import date

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditAction
from gradings.models import GradingSession
from gradings.testing import (
    auth_client,
    candidate,
    grading_session,
    student,
    user,
)
from kukgrade.testing import results
from students.services import create_student, update_student

pytestmark = pytest.mark.django_db


def titles(
    client: APIClient, term: str, path: str = "/api/gradings/sessions/"
) -> list[str]:
    return [row["title"] for row in results(client.get(path, {"search": term}))]


def names(client: APIClient, term: str) -> list[str]:
    rows = results(client.get("/api/students/", {"search": term}))
    return [f"{row['first_name']} {row['last_name']}" for row in rows]


# --- the grading list: what is on the screen can be typed ---------------------


@pytest.fixture
def gradings() -> APIClient:
    grading_session(
        title="Spring Grading",
        location="Riverside Dojang",
        grading_date=date(2026, 10, 25),
        status=GradingSession.Status.LOCKED,
    )
    grading_session(
        title="Autumn Grading",
        location="Hillside Hall",
        grading_date=date(2026, 3, 14),
        status=GradingSession.Status.COMPLETED,
    )
    return auth_client("search-gradings@example.com")


@pytest.mark.parametrize(
    ("term", "found"),
    [
        ("Spring", ["Spring Grading"]),
        ("spr", ["Spring Grading"]),
        ("riverside dojang", ["Spring Grading"]),
        ("dojang riverside", ["Spring Grading"]),
        # The words the screen shows beside it.
        ("October", ["Spring Grading"]),
        ("oct 2026", ["Spring Grading"]),
        ("25 october", ["Spring Grading"]),
        ("2026-10-25", ["Spring Grading"]),
        ("25/10/2026", ["Spring Grading"]),
        ("locked", ["Spring Grading"]),
        ("COMPLETED", ["Autumn Grading"]),
        ("march", ["Autumn Grading"]),
        # A slip of the keyboard.
        ("Sprng", ["Spring Grading"]),
        ("autum", ["Autumn Grading"]),
        # No row has every word.
        ("hall dojang", []),
        ("zzzz", []),
    ],
)
def test_the_grading_list_finds_what_its_screen_shows(
    gradings: APIClient,
    term: str,
    found: list[str],
) -> None:
    assert titles(gradings, term) == found


def test_the_best_match_comes_first_when_nobody_chose_an_order() -> None:
    grading_session(title="Winter Grading", location="Spring Hall")
    grading_session(title="Spring Grading", location="Riverside")
    client = auth_client("search-order@example.com")

    assert titles(client, "spring")[0] == "Spring Grading"


def test_a_chosen_order_beats_relevance() -> None:
    grading_session(title="Spring Grading", grading_date=date(2026, 1, 1))
    grading_session(title="Spring Hall Grading", grading_date=date(2026, 6, 1))
    client = auth_client("search-chosen-order@example.com")

    by_date = [
        row["title"]
        for row in results(
            client.get(
                "/api/gradings/sessions/",
                {"search": "spring", "ordering": "grading_date"},
            ),
        )
    ]

    assert by_date == ["Spring Grading", "Spring Hall Grading"]


def test_an_empty_or_blank_search_changes_nothing(gradings: APIClient) -> None:
    assert sorted(titles(gradings, "")) == ["Autumn Grading", "Spring Grading"]
    assert sorted(titles(gradings, "   ")) == ["Autumn Grading", "Spring Grading"]


def test_a_very_long_search_is_not_a_way_to_make_the_server_work(
    gradings: APIClient,
) -> None:
    response = gradings.get("/api/gradings/sessions/", {"search": "spring " * 500})

    assert response.status_code == 200


# --- students: names, accents, IDs, typos -------------------------------------


@pytest.fixture
def people() -> APIClient:
    student(first_name="José", last_name="Hartley", wksa_id="123-4-150")
    student(first_name="Alex", last_name="Kim", wksa_id="123-4-151")
    student(first_name="Katherine", last_name="Adeyemi", wksa_id="123-4-152")
    return auth_client("search-people@example.com")


@pytest.mark.parametrize(
    ("term", "found"),
    [
        ("kim alex", ["Alex Kim"]),
        ("alex kim", ["Alex Kim"]),
        ("jose", ["José Hartley"]),
        ("JOSÉ", ["José Hartley"]),
        ("hart", ["José Hartley"]),
        ("hartly", ["José Hartley"]),
        ("catherine", ["Katherine Adeyemi"]),
        ("adeyemy", ["Katherine Adeyemi"]),
        ("123-4-150", ["José Hartley"]),
        ("1234151", ["Alex Kim"]),
        ("jose 150", ["José Hartley"]),
        ("zzzz", []),
    ],
)
def test_the_student_list_finds_a_person_the_way_people_type_them(
    people: APIClient,
    term: str,
    found: list[str],
) -> None:
    assert names(people, term) == found


def test_an_id_one_character_off_is_somebody_else_not_a_slip(
    people: APIClient,
) -> None:
    # 123-4-150 and 123-4-151 are two students: IDs are exact, never "alike".
    assert names(people, "123-4-15") != []
    assert names(people, "123-4-150") == ["José Hartley"]


def test_the_student_list_finds_a_student_by_the_rank_or_status_it_shows(
    people: APIClient,
) -> None:
    assert len(names(people, "white")) == 3
    assert names(people, "left") == []


# --- users and the other lists use the same engine -----------------------------


def test_the_user_list_finds_a_name_an_email_or_a_role() -> None:
    admin = user("search-admin@example.com", role=User.Role.ADMINISTRATOR)
    User.objects.filter(pk=admin.pk).update(first_name="Renée", last_name="Okafor")
    client = auth_client("search-user-list@example.com")
    admin_client = APIClient()
    admin_client.force_authenticate(user=admin)

    def found(term: str) -> list[str]:
        rows = results(admin_client.get("/api/users/", {"search": term}))
        return [row["email"] for row in rows]

    assert "search-admin@example.com" in found("renee")
    assert "search-admin@example.com" in found("okafor renee")
    assert "search-admin@example.com" in found("search-admin")
    assert "search-admin@example.com" in found("administrator")
    assert "search-admin@example.com" not in found("instructor")
    assert client is not None


def test_the_audit_search_finds_a_students_events_by_their_current_name() -> None:
    actor = user("search-audit-actor@example.com")
    created = create_student(
        wksa_id="123-4-777",
        first_name="Zephyrine",
        last_name="Quillfeather",
        date_of_birth=date(2014, 6, 7),
        current_rank=student().current_rank,
        actor=actor,
    )
    admin = APIClient()
    admin.force_authenticate(
        user=user("search-audit-reader@example.com", role=User.Role.ADMINISTRATOR)
    )

    def actions(term: str) -> set[str]:
        rows = results(admin.get("/api/audit-events/", {"search": term}))
        return {row["action"] for row in rows}

    assert AuditAction.STUDENT_CREATED in actions("zephyrine quillfeather")
    assert AuditAction.STUDENT_CREATED in actions("zephyrin")  # a slip
    update_student(created, last_name="Thistlewood", actor=actor)
    assert actions("quillfeather") == set()
    assert AuditAction.STUDENT_CREATED in actions("thistlewood")
    # What the event itself says is exact: "student" is not "students".
    assert AuditAction.STUDENT_CREATED in actions("created")
    assert AuditAction.STUDENT_CREATED in actions("student created")


def test_the_candidates_of_a_grading_are_found_by_name_through_the_roster() -> None:
    built = candidate(student=student(first_name="Fiona", last_name="Gallagher"))
    candidate(
        session=built.session,
        student=student(first_name="Ethan", last_name="Hunt"),
    )
    other_session = candidate(
        student=student(first_name="Fiona", last_name="Gallagher")
    )
    client = auth_client("search-roster@example.com")

    def found(term: str) -> list[int]:
        rows = results(
            client.get(
                "/api/gradings/candidates/",
                {"session": str(built.session_id), "search": term},
            ),
        )
        return [row["id"] for row in rows]

    assert found("gallagher fiona") == [built.pk]
    assert found("fiona") == [built.pk]
    assert found("gallager") == [built.pk]
    assert found(built.student.wksa_id) == [built.pk]
    assert found("zzzz") == []
    assert other_session.pk not in found("fiona")
