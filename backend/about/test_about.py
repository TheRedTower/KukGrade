"""What is running: the version, build, who to ask, and the one-version checks."""

from __future__ import annotations

import json
import tomllib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from rest_framework.test import APIClient

from about import project
from accounts.models import User
from kukgrade.version import VERSION

pytestmark = pytest.mark.django_db

BACKEND = Path(__file__).resolve().parent.parent


def signed_in(role: str = User.Role.INSTRUCTOR) -> APIClient:
    user = User.objects.create_user(email="about@example.com", password="x", role=role)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_there_is_one_version_everywhere() -> None:
    pyproject = tomllib.loads((BACKEND / "pyproject.toml").read_text())
    assert pyproject["project"]["version"] == VERSION
    package = BACKEND.parent / "frontend" / "package.json"
    if package.exists():  # not in the production image
        assert json.loads(package.read_text())["version"] == VERSION


def test_about_is_for_people_who_are_signed_in() -> None:
    assert APIClient().get("/api/about/").status_code in {401, 403}


def test_about_serves_the_version_the_build_and_the_clubs_zone(settings: Any) -> None:
    settings.BUILD_COMMIT = "5198f1b"
    settings.BUILD_TIME = "2026-10-21T09:30:00+00:00"
    settings.TIME_ZONE = "Europe/Dublin"

    served = signed_in().get("/api/about/").json()

    # The time is the same instant, written in the zone Django is running in.
    built_at = datetime.fromisoformat(served.pop("built_at"))
    assert built_at == datetime(2026, 10, 21, 9, 30, tzinfo=UTC)
    assert served["version"] == VERSION
    assert served["commit"] == "5198f1b"
    assert served["time_zone"] == "Europe/Dublin"
    assert served["database"] == "ok"


def test_a_release_candidate_is_named_with_its_number(settings: Any) -> None:
    settings.BUILD_PRE_RELEASE = "rc.4"

    served = signed_in().get("/api/about/").json()

    assert served["version"] == VERSION
    assert served["release"] == f"{VERSION}-rc.4"


def test_a_stable_build_or_a_checkout_is_named_by_its_version(settings: Any) -> None:
    settings.BUILD_PRE_RELEASE = ""

    assert signed_in().get("/api/about/").json()["release"] == VERSION


def test_a_build_time_without_a_zone_is_taken_as_utc(settings: Any) -> None:
    settings.BUILD_TIME = "2026-10-21T09:30:00"

    built_at = signed_in().get("/api/about/").json()["built_at"]

    assert datetime.fromisoformat(built_at) == datetime(2026, 10, 21, 9, 30, tzinfo=UTC)


def test_about_says_so_when_run_from_a_checkout(settings: Any) -> None:
    settings.BUILD_COMMIT = ""
    settings.BUILD_TIME = ""

    served = signed_in().get("/api/about/").json()

    assert served["commit"] == "" and served["built_at"] is None


def test_about_reports_an_unreachable_database(monkeypatch: pytest.MonkeyPatch) -> None:
    client = signed_in()

    monkeypatch.setattr("about.views.database_reachable", lambda: False)
    assert client.get("/api/about/").json()["database"] == "unavailable"


def test_about_says_where_the_project_lives_and_who_to_ask() -> None:
    served = signed_in().get("/api/about/").json()

    assert served["repository_url"] == project.REPOSITORY_URL
    assert served["issues_url"] == f"{project.REPOSITORY_URL}/issues"
    assert served["support_email"] == "support@kukgrade.co.uk"
    assert served["security_email"] == "security@kukgrade.co.uk"
    assert served["licence"] == project.LICENCE_ID
    assert served["copyright"] == project.COPYRIGHT_NOTICE


def test_an_administrator_also_sees_the_schools_settings(settings: Any) -> None:
    settings.CLUB_NAME = "Riverside Kuk Sool Won"
    settings.SCHOOL_ID_PREFIX = "456-7"

    served = signed_in(User.Role.ADMINISTRATOR).get("/api/about/").json()

    assert served["school"] == {
        "club_name": "Riverside Kuk Sool Won",
        "school_id_prefix": "456-7",
    }


def test_an_instructor_does_not_see_the_schools_settings() -> None:
    assert "school" not in signed_in(User.Role.INSTRUCTOR).get("/api/about/").json()
