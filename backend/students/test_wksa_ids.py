"""The WKSA ID scheme: two forms, nothing else (decision log 2026-10-20)."""

from __future__ import annotations

import importlib
from typing import Any

import pytest
from django.apps import apps as django_apps
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from ranks.models import Rank
from students.models import Student

pytestmark = pytest.mark.django_db

FORMAT_MESSAGE = (
    "Use a student ID such as 206-2-150 or a black belt ID such as A-20819."
)


def make(wksa_id: str) -> Student:
    return Student.objects.create(
        wksa_id=wksa_id,
        first_name="Alex",
        last_name="Kim",
        date_of_birth=timezone.localdate().replace(year=2012),
        current_rank=Rank.objects.get(code="WHITE"),
    )


@pytest.mark.parametrize(
    ("typed", "stored"),
    [
        ("206-2-150", "206-2-150"),
        ("206-2-007", "206-2-007"),
        # A transfer keeps their own school's prefix, in the same form.
        ("206-1-044", "206-1-044"),
        ("A-20819", "A-20819"),
        (" a-20819 ", "A-20819"),
    ],
)
def test_either_form_is_accepted(typed: str, stored: str) -> None:
    assert make(typed).wksa_id == stored


@pytest.mark.parametrize(
    "typed",
    [
        "206-2-15",
        "206-2-1500",
        "2062150",
        "206-22-150",
        "206 2 150",
        "A-2081",
        "A-208190",
        "B-20819",
        "A20819",
        "UK-5001",
    ],
)
def test_anything_else_is_refused(typed: str) -> None:
    with pytest.raises(ValidationError) as refused:
        make(typed)

    assert refused.value.message_dict["wksa_id"] == [FORMAT_MESSAGE]


def test_the_database_refuses_anything_else_whatever_wrote_it() -> None:
    rank = Rank.objects.get(code="WHITE")
    with pytest.raises(IntegrityError), transaction.atomic():
        Student.objects.bulk_create(
            [
                Student(
                    wksa_id="UK-5001",
                    first_name="Alex",
                    last_name="Kim",
                    date_of_birth=timezone.localdate().replace(year=2012),
                    current_rank=rank,
                ),
            ],
        )


def test_the_api_refuses_anything_else_with_the_rule_in_plain_words() -> None:
    client = APIClient()
    client.force_authenticate(user=User.objects.create_user(email="ids@example.com"))

    response = client.post(
        "/api/students/",
        {
            "wksa_id": "UK-5001",
            "first_name": "Alex",
            "last_name": "Kim",
            "date_of_birth": "2012-05-01",
            "current_rank": Rank.objects.get(code="WHITE").pk,
        },
        format="json",
    )

    assert response.status_code == 400
    assert response.json()["error"]["fields"]["wksa_id"] == [FORMAT_MESSAGE]


def test_site_settings_serve_the_forms_the_server_enforces(settings: Any) -> None:
    settings.SCHOOL_ID_PREFIX = "301-4"

    served = APIClient().get("/api/site/").json()["wksa_id"]

    assert served == {
        "school_prefix": "301-4",
        "forms": [
            {
                "code": "student",
                "label": "Student ID",
                "pattern": "[0-9]{3}-[0-9]-[0-9]{3}",
                "example": "301-4-150",
            },
            {
                "code": "black_belt",
                "label": "Black belt ID",
                "pattern": "A-[0-9]{5}",
                "example": "A-20819",
            },
        ],
    }


def test_the_migration_tidies_what_it_can_and_lists_the_rest() -> None:
    migration = importlib.import_module("students.migrations.0006_wksa_id_format")
    constraint = next(
        c for c in Student._meta.constraints if c.name == "student_wksa_id_format"
    )
    rank = Rank.objects.get(code="WHITE")
    with connection.schema_editor() as editor:
        editor.remove_constraint(Student, constraint)
    rows = [
        Student(
            wksa_id=wksa_id,
            first_name="Old",
            last_name=last_name,
            date_of_birth=timezone.localdate().replace(year=2012),
            current_rank=rank,
        )
        for wksa_id, last_name in (
            (" a-20819", "Tidied"),
            ("DEMO-001", "Wrong"),
        )
    ]
    Student.objects.bulk_create(rows)

    with pytest.raises(RuntimeError) as stopped:
        migration.tidy_and_check(django_apps, None)

    assert "'DEMO-001' (Old Wrong)" in str(stopped.value)
    assert "Tidied" not in str(stopped.value)
    assert Student.objects.filter(wksa_id="A-20819").exists()
