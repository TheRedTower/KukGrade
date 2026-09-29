"""The site settings the frontend shows."""

from __future__ import annotations

from typing import Any

from rest_framework.test import APIClient


def test_site_settings_serve_the_configured_club_name(settings: Any) -> None:
    settings.CLUB_NAME = "Kuk Sool Won Colchester"

    response = APIClient().get("/api/site/")

    assert response.status_code == 200
    assert response.json() == {"club_name": "Kuk Sool Won Colchester"}


def test_site_settings_are_read_only() -> None:
    assert APIClient().post("/api/site/", {}, format="json").status_code == 405
