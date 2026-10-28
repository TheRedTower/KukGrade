"""The licence, the code of conduct, the security policy and the pledge."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from rest_framework.test import APIClient

from about.documents import DOCUMENTS
from accounts.models import User

pytestmark = pytest.mark.django_db


def signed_in() -> APIClient:
    user = User.objects.create_user(email="reader@example.com", password="x")
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.parametrize("slug", [*DOCUMENTS, "pledge"])
def test_the_documents_are_for_people_who_are_signed_in(slug: str) -> None:
    url = "/api/about/pledge/" if slug == "pledge" else f"/api/about/documents/{slug}/"

    assert APIClient().get(url).status_code in {401, 403}


def test_a_document_is_served_exactly_as_the_file_holds_it(
    settings: Any, tmp_path: Path
) -> None:
    (tmp_path / "SECURITY.md").write_text("# Security Policy\n\nReport it privately.\n")
    settings.ABOUT_DOCUMENTS_DIR = tmp_path

    served = signed_in().get("/api/about/documents/security/").json()

    assert served == {
        "slug": "security",
        "title": "Security",
        "format": "markdown",
        "content": "# Security Policy\n\nReport it privately.",
        "source_url": "https://github.com/TheRedTower/KukGrade/blob/HEAD/SECURITY.md",
    }


def test_the_licence_is_plain_text() -> None:
    served = signed_in().get("/api/about/documents/licence/").json()

    assert served["format"] == "text"
    assert "GNU AFFERO GENERAL PUBLIC LICENSE" in served["content"]


def test_the_repositorys_own_files_are_what_a_checkout_serves() -> None:
    client = signed_in()
    conduct = client.get("/api/about/documents/code-of-conduct/").json()
    security = client.get("/api/about/documents/security/").json()

    assert "Contributor Covenant" in conduct["content"]
    assert "## Reporting a vulnerability" in security["content"]


def test_an_unknown_document_is_not_found() -> None:
    assert signed_in().get("/api/about/documents/secrets/").status_code == 404


def test_a_document_the_image_lacks_is_not_found(settings: Any, tmp_path: Path) -> None:
    settings.ABOUT_DOCUMENTS_DIR = tmp_path

    assert signed_in().get("/api/about/documents/licence/").status_code == 404


def test_the_pledge_has_four_points_each_in_english_and_korean() -> None:
    served = signed_in().get("/api/about/pledge/").json()

    assert served["title"] == "The Kuk Sool Won Pledge"
    assert len(served["points"]) == 4
    assert all(point["english"] and point["korean"] for point in served["points"])
    assert served["points"][3]["english"].startswith(
        "I pledge to promote international goodwill"
    )
