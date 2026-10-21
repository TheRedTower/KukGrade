"""What is running: the version, its build, and the checks that keep one version."""

from __future__ import annotations

import json
import tomllib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from kukgrade.version import VERSION

pytestmark = pytest.mark.django_db

BACKEND = Path(__file__).resolve().parent.parent


def signed_in() -> APIClient:
    user = User.objects.create_user(email="about@example.com", password="x")
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
    assert served == {
        "version": VERSION,
        "commit": "5198f1b",
        "time_zone": "Europe/Dublin",
        "database": "ok",
    }


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

    monkeypatch.setattr("kukgrade.views.database_reachable", lambda: False)
    assert client.get("/api/about/").json()["database"] == "unavailable"
