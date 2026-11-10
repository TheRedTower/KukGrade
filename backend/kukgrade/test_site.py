"""The site settings the frontend shows."""

from __future__ import annotations

from typing import Any

from rest_framework.test import APIClient

from data_imports.mappings import STANDARD_TEMPLATE_HEADERS, suggest_column_mapping
from data_imports.models import COMMITTED_ROWS_KEPT_FOR
from data_imports.parsers import MAX_ROWS
from data_imports.services import ALLOWED_SUFFIXES
from gradings.serializers import BULK_LINK_LIMIT


def test_site_settings_serve_the_configured_club_name(settings: Any) -> None:
    settings.CLUB_NAME = "Kuk Sool Won Riverside"

    response = APIClient().get("/api/site/")

    assert response.status_code == 200
    assert response.json()["club_name"] == "Kuk Sool Won Riverside"


def test_site_settings_serve_the_club_time_zone(settings: Any) -> None:
    settings.TIME_ZONE = "Pacific/Auckland"

    assert APIClient().get("/api/site/").json()["time_zone"] == "Pacific/Auckland"


def test_site_settings_serve_the_effective_import_upload_limit(settings: Any) -> None:
    settings.IMPORT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024

    response = APIClient().get("/api/site/")

    assert response.json()["imports"]["max_bytes"] == 10 * 1024 * 1024


def test_site_settings_serve_the_import_limits_the_server_enforces() -> None:
    # The import screens word these; they are the constants the checks use.
    imports = APIClient().get("/api/site/").json()["imports"]

    assert imports["max_rows"] == MAX_ROWS
    assert imports["rows_kept_for_days"] == COMMITTED_ROWS_KEPT_FOR.days
    assert imports["bulk_link_limit"] == BULK_LINK_LIMIT
    assert imports["template_headers"] == list(STANDARD_TEMPLATE_HEADERS.values())
    assert {
        served["kind"]: [kind["value"] for kind in served["types"]]
        for served in imports["file_types"]
    } == {kind: list(suffixes) for kind, suffixes in ALLOWED_SUFFIXES.items()}


def test_the_template_headers_are_the_ones_the_import_recognises() -> None:
    assert suggest_column_mapping(list(STANDARD_TEMPLATE_HEADERS.values())) == {
        field: header for field, header in STANDARD_TEMPLATE_HEADERS.items()
    }


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
