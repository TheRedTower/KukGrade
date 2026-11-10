from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from django.core.management.base import CommandError
from django.db import connection
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import User
from demo import seed
from demo.personas import PERSONA_EMAILS
from demo.reset import club_tables, reset
from demo.schedule import next_reset_at
from demo.testing import session_named, sign_in
from gradings.models import (
    GradingSession,
    Promotion,
)
from ranks.models import Rank
from students.models import Student
from syllabus.models import SyllabusRequirement

Status = GradingSession.Status

demo_mode = override_settings(DEMO_MODE=True)


@pytest.mark.django_db
def test_nothing_is_built_unless_demo_mode_is_on() -> None:
    with pytest.raises(CommandError, match="KUKGRADE_DEMO_MODE"):
        seed.build()
    assert not Student.objects.exists()


@pytest.mark.django_db
@demo_mode
def test_a_database_with_real_accounts_is_never_touched() -> None:
    User.objects.create_user("real.instructor@example.com", "A-Real-Password-1!")

    with pytest.raises(CommandError, match="not the demo's own"):
        seed.build()
    with pytest.raises(CommandError, match="not the demo's own"):
        reset()

    assert not Student.objects.exists()


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@demo_mode
def test_reset_leaves_the_club_alone_once_a_real_account_exists() -> None:
    seed.build()
    User.objects.create_user("real.instructor@example.com", "A-Real-Password-1!")
    students = Student.objects.count()

    with pytest.raises(CommandError):
        reset()

    assert Student.objects.count() == students


# Resetting


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@demo_mode
def test_a_reset_rebuilds_the_same_club_and_keeps_the_accounts_and_catalogue() -> None:
    seed.build()
    personas = User.objects.filter(email__in=PERSONA_EMAILS)
    ids = {u.email: u.pk for u in personas}
    hashes = {u.email: u.password for u in personas}
    ranks, syllabus = Rank.objects.count(), SyllabusRequirement.objects.count()
    students = Student.objects.count()
    # A visitor's mess.
    Student.objects.filter(first_name="Leo").update(first_name="Rude word")

    reset()

    assert Student.objects.count() == students
    assert not Student.objects.filter(first_name="Rude word").exists()
    assert {u.email: u.pk for u in personas} == ids
    assert {u.email: u.password for u in personas} == hashes
    assert (Rank.objects.count(), SyllabusRequirement.objects.count()) == (
        ranks,
        syllabus,
    )
    assert Promotion.objects.count() == 14
    # Numbering carries on: a sequence cannot be set back safely in a transaction.
    assert session_named("Autumn Grading").pk > 5


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@demo_mode
def test_a_signed_in_visitor_stays_signed_in_through_a_reset() -> None:
    seed.build()
    visitor = sign_in("instructor@demo.example.com")

    reset()

    assert visitor.get("/api/auth/me/").status_code == 200
    assert visitor.get("/api/students/").status_code == 200


@pytest.mark.django_db
def test_every_table_a_reset_empties_exists() -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = current_schema()",
        )
        existing = {name for (name,) in cursor.fetchall()}
    assert set(club_tables()) <= existing
    assert {"gradings_gradingsession", "audit_auditevent", "students_student"} <= set(
        club_tables(),
    )


@pytest.mark.parametrize(
    ("now", "expected_day", "expected_hour"),
    [
        ((2027, 3, 1, 0, 0), 1, 6),
        ((2027, 3, 1, 5, 59), 1, 6),
        ((2027, 3, 1, 6, 0), 1, 12),
        ((2027, 3, 1, 23, 30), 2, 0),
    ],
)
@override_settings(DEMO_RESET_HOURS=6, TIME_ZONE="UTC")
def test_resets_fall_on_whole_multiples_of_the_interval(
    now: tuple[int, int, int, int, int],
    expected_day: int,
    expected_hour: int,
) -> None:
    following = next_reset_at(datetime(*now, tzinfo=UTC))

    assert (following.day, following.hour, following.minute) == (
        expected_day,
        expected_hour,
        0,
    )


# What visitors may and may not do


@pytest.mark.django_db
@demo_mode
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/auth/change-password/"),
        ("patch", "/api/auth/me/"),
        ("post", "/api/users/"),
        ("patch", "/api/users/00000000-0000-0000-0000-000000000000/"),
        ("patch", "/api/users/00000000-0000-0000-0000-000000000000/authority/"),
        ("post", "/api/users/00000000-0000-0000-0000-000000000000/set-password/"),
        ("post", "/api/data-imports/batches/"),
    ],
)
def test_changes_that_would_affect_other_visitors_are_closed(
    method: str,
    path: str,
) -> None:
    client = APIClient()
    client.force_authenticate(User.objects.create_user("a@example.com", "x"))

    response = getattr(client, method)(path, {}, format="json")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "demo_mode"


@pytest.mark.django_db
def test_nothing_is_closed_outside_the_demo() -> None:
    client = APIClient()
    client.force_authenticate(User.objects.create_user("a@example.com", "x"))

    response = client.post("/api/users/", {}, format="json")

    body: Any = response.json()
    assert body.get("error", {}).get("code") != "demo_mode"


@pytest.mark.django_db
def test_the_site_settings_say_nothing_of_a_demo_outside_demo_mode() -> None:
    assert "demo" not in APIClient().get("/api/site/").json()


@pytest.mark.django_db
@demo_mode
def test_the_demo_is_never_offered_first_time_setup() -> None:
    from accounts.setup import issue_setup_code

    client = APIClient()

    assert client.get("/api/setup/").json() == {"setup_needed": False}
    assert issue_setup_code() is None
    token = client.get("/api/auth/me/").cookies["csrftoken"].value
    response = client.post(
        "/api/setup/",
        {
            "code": "AAAA-AAAA-AAAA",
            "email": "x@example.com",
            "password": "Aa1!aaaaaaaaaaaa",
        },
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 400
    assert not User.objects.filter(is_superuser=True).exists()


@pytest.mark.django_db
def test_tables_are_emptied_after_everything_that_refers_to_them() -> None:
    from demo.reset import deletion_order

    order = deletion_order()

    assert sorted(order) == sorted(club_tables())
    for child, parent in [
        ("gradings_candidateoutcome", "gradings_candidateassessment"),
        ("gradings_candidateassessment", "gradings_gradingcandidate"),
        ("gradings_gradingcandidate", "gradings_gradingsession"),
        ("gradings_gradingcandidate", "students_student"),
        ("gradings_promotion", "gradings_candidateoutcome"),
    ]:
        assert order.index(child) < order.index(parent)
