"""Pagination is uniform across every list endpoint.

Bounded reference collections such as ranks are paginated too. The frontend
then needs one unwrap helper rather than a table of which endpoints are
enveloped, and no endpoint can quietly grow into an unbounded response.
"""

from __future__ import annotations

from datetime import date

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from kukgrade.pagination import DefaultPagination
from ranks.models import Rank
from students.models import Student

pytestmark = pytest.mark.django_db

LIST_ENDPOINTS = [
    "/api/ranks/",
    "/api/syllabus/age-bands/",
    "/api/syllabus/requirements/effective/?rank_code=YELLOW&age_band=AGE_18_AND_OVER",
    "/api/gradings/sessions/",
    "/api/gradings/candidates/",
    "/api/gradings/assessments/",
    "/api/gradings/assessment-items/",
    "/api/gradings/outcomes/",
    "/api/gradings/promotions/",
    "/api/gradings/withdrawal-reasons/",
]


def client(email: str = "pagination@example.com") -> APIClient:
    api = APIClient()
    api.force_authenticate(user=User.objects.create_user(email=email))
    return api


@pytest.mark.parametrize("endpoint", LIST_ENDPOINTS)
def test_every_list_endpoint_returns_a_page_envelope(endpoint: str) -> None:
    slug = endpoint.split("?")[0].strip("/").replace("/", "-")
    response = client(f"envelope-{slug}@example.com").get(endpoint)

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"count", "next", "previous", "results"}
    assert isinstance(payload["results"], list)
    assert isinstance(payload["count"], int)


@pytest.fixture
def many_students() -> int:
    """More students than the maximum page size, so every paging rule shows."""
    rank = Rank.objects.order_by("order").first()
    assert rank is not None
    total = DefaultPagination.max_page_size + 10
    Student.objects.bulk_create(
        Student(
            wksa_id=f"123-4-{index:03d}",
            first_name="Page",
            last_name=f"Student {index:04d}",
            date_of_birth=date(2000, 1, 1),
            current_rank=rank,
        )
        for index in range(total)
    )
    return total


def test_count_reflects_the_whole_collection_not_the_page(many_students: int) -> None:
    payload = client().get("/api/students/").json()

    assert payload["count"] == many_students
    assert len(payload["results"]) == DefaultPagination.page_size
    assert payload["next"] is not None
    assert payload["previous"] is None


def test_pages_are_disjoint_and_cover_the_collection(many_students: int) -> None:
    api = client()
    first = api.get("/api/students/?page=1").json()
    second = api.get("/api/students/?page=2").json()

    first_ids = [row["id"] for row in first["results"]]
    second_ids = [row["id"] for row in second["results"]]

    assert not set(first_ids) & set(second_ids)
    assert second["previous"] is not None


def test_page_size_is_client_overridable() -> None:
    payload = client().get("/api/ranks/?page_size=5").json()

    assert len(payload["results"]) == 5
    assert payload["count"] == 16


def test_page_size_is_capped_at_the_maximum(many_students: int) -> None:
    payload = client().get("/api/students/?page_size=1000").json()

    assert len(payload["results"]) == DefaultPagination.max_page_size
    assert payload["count"] > DefaultPagination.max_page_size


def test_out_of_range_page_is_rejected_rather_than_returning_an_empty_page() -> None:
    response = client().get("/api/ranks/?page=99")

    assert response.status_code == 404


def test_an_undeclared_list_parameter_is_refused_not_ignored() -> None:
    # A misspelt filter used to return the unfiltered list, which reads as a
    # filter that worked.
    response = client("unknown-param@example.com").get(
        "/api/gradings/assessments/?sesion=1&page_size=5"
    )

    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["fields"] == {"sesion": ["This list cannot be filtered that way."]}


def test_declared_filters_and_paging_are_still_accepted() -> None:
    response = client("known-params@example.com").get(
        "/api/gradings/assessments/?session=1&status=NOT_STARTED&page=1&page_size=5"
    )

    assert response.status_code == 200


def test_actions_that_read_their_own_parameters_are_not_list_filtered() -> None:
    response = client("action-params@example.com").get(
        "/api/syllabus/requirements/effective/?rank_code=YELLOW&age_band=AGE_18_AND_OVER"
    )

    assert response.status_code == 200
