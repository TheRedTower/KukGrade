"""The site settings the frontend shows."""

from __future__ import annotations

from typing import Any

from rest_framework.test import APIClient


def test_site_settings_serve_the_configured_club_name(settings: Any) -> None:
    settings.CLUB_NAME = "Kuk Sool Won Colchester"

    response = APIClient().get("/api/site/")

    assert response.status_code == 200
    assert response.json()["club_name"] == "Kuk Sool Won Colchester"


def test_site_settings_serve_the_club_time_zone(settings: Any) -> None:
    settings.TIME_ZONE = "Pacific/Auckland"

    assert APIClient().get("/api/site/").json()["time_zone"] == "Pacific/Auckland"


def test_site_settings_serve_the_password_policy_the_server_enforces() -> None:
    # The screens' checklist renders this; it must be the policy the
    # validators run, not a copy (2026-10-19, credential slice 2).
    response = APIClient().get("/api/site/")

    assert response.json()["password_policy"] == {
        "min_length": 16,
        "max_length": 64,
        "character_rules": [
            {"code": "uppercase", "label": "An uppercase letter", "pattern": "[A-Z]"},
            {"code": "lowercase", "label": "A lowercase letter", "pattern": "[a-z]"},
            {"code": "number", "label": "A number", "pattern": "[0-9]"},
            {
                "code": "special",
                "label": "A special character, such as ! or #",
                "pattern": "[^A-Za-z0-9]",
            },
        ],
        "checked_on_save": [
            "Not a commonly used password",
            "Not too similar to your name or email address",
        ],
    }


def test_site_settings_are_read_only() -> None:
    assert APIClient().post("/api/site/", {}, format="json").status_code == 405
