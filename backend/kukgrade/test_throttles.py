"""The heavy requests are rate limited per user, and nothing else is.

ScopedRateThrottle binds its rates when it is imported, so a test lowers one
by patching the class attribute (as the sign-in throttle's test does).
"""

from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import patch

import pytest
from django.core.cache import cache
from rest_framework.throttling import ScopedRateThrottle

from accounts.models import User
from gradings.testing import auth_client, grading_session
from kukgrade.exceptions import THROTTLED_MESSAGE

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _fresh_counts() -> Iterator[None]:
    cache.clear()
    yield
    cache.clear()


@pytest.mark.parametrize("export", ["records", "summary", "grading-sheets"])
def test_pdf_exports_are_limited_per_user(export: str) -> None:
    session = grading_session()
    url = f"/api/gradings/sessions/{session.pk}/exports/{export}/"
    client = auth_client("export-throttled@example.com")

    with patch.object(ScopedRateThrottle, "THROTTLE_RATES", {"pdf_export": "2/min"}):
        # Refused for what they ask (a draft session, no candidates), but
        # each one counts.
        asked = [client.post(url, {}, format="json") for _ in range(3)]
        other = auth_client("export-other@example.com").post(url, {}, format="json")
        # Reading the session is not an export.
        read = client.get(f"/api/gradings/sessions/{session.pk}/")

    assert [response.status_code for response in asked] == [400, 400, 429]
    assert asked[-1].json()["error"] == {
        "code": "throttled",
        "message": THROTTLED_MESSAGE,
    }
    assert other.status_code == 400
    assert read.status_code == 200


def test_import_uploads_are_limited_and_nothing_else_of_an_import() -> None:
    client = auth_client("upload-throttled@example.com", role=User.Role.ADMINISTRATOR)
    url = "/api/data-imports/batches/"

    with patch.object(ScopedRateThrottle, "THROTTLE_RATES", {"import_upload": "2/min"}):
        uploads = [
            client.post(url, {}, format="multipart").status_code for _ in range(3)
        ]
        listed = client.get(url)

    assert uploads == [400, 400, 429]
    assert listed.status_code == 200
