"""Pagination is uniform across every list endpoint.

Bounded reference collections such as ranks are paginated too. The frontend
then needs one unwrap helper rather than a table of which endpoints are
enveloped, and no endpoint can quietly grow into an unbounded response.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from kukgrade.pagination import DefaultPagination
from syllabus.models import SyllabusRequirement

pytestmark = pytest.mark.django_db

LIST_ENDPOINTS = [
    "/api/ranks/",
    "/api/syllabus/items/",
    "/api/syllabus/requirements/",
    "/api/gradings/sessions/",
    "/api/gradings/candidates/",
    "/api/gradings/assessments/",
    "/api/gradings/assessment-items/",
    "/api/gradings/outcomes/",
    "/api/gradings/promotions/",
]


def client(email: str = "pagination@example.com") -> APIClient:
    api = APIClient()
    api.force_authenticate(user=User.objects.create_user(email=email))
    return api


@pytest.mark.parametrize("endpoint", LIST_ENDPOINTS)
def test_every_list_endpoint_returns_a_page_envelope(endpoint: str) -> None:
    slug = endpoint.strip("/").replace("/", "-")
    response = client(f"envelope-{slug}@example.com").get(endpoint)

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"count", "next", "previous", "results"}
    assert isinstance(payload["results"], list)
    assert isinstance(payload["count"], int)


def test_count_reflects_the_whole_collection_not_the_page() -> None:
    total = SyllabusRequirement.objects.filter(active=True, item__active=True).count()
    assert total > DefaultPagination.page_size, "fixture too small to prove paging"

    payload = client().get("/api/syllabus/requirements/").json()

    assert payload["count"] == total
    assert len(payload["results"]) == DefaultPagination.page_size
    assert payload["next"] is not None
    assert payload["previous"] is None


def test_pages_are_disjoint_and_cover_the_collection() -> None:
    api = client()
    first = api.get("/api/syllabus/requirements/?page=1").json()
    second = api.get("/api/syllabus/requirements/?page=2").json()

    first_ids = [row["id"] for row in first["results"]]
    second_ids = [row["id"] for row in second["results"]]

    assert not set(first_ids) & set(second_ids)
    assert second["previous"] is not None


def test_page_size_is_client_overridable() -> None:
    payload = client().get("/api/ranks/?page_size=5").json()

    assert len(payload["results"]) == 5
    assert payload["count"] == 16


def test_page_size_is_capped_at_the_maximum() -> None:
    # 373 seeded requirements, so an uncapped request would return them all.
    payload = client().get("/api/syllabus/requirements/?page_size=1000").json()

    assert len(payload["results"]) == DefaultPagination.max_page_size
    assert payload["count"] > DefaultPagination.max_page_size


def test_out_of_range_page_is_rejected_rather_than_returning_an_empty_page() -> None:
    response = client().get("/api/ranks/?page=99")

    assert response.status_code == 404
