"""Read endpoints cost the same number of queries however much history there is.

Each test warms the endpoint, counts it with one record, adds more, and counts
again: a per-row query shows as growth (KG-A21).
"""

from __future__ import annotations

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import User
from gradings.models import GradingSession
from gradings.outcome_services import promote_candidate
from gradings.services import transition_grading_session
from gradings.testing import (
    assessment,
    candidate,
    complete_assessment,
    finalised_outcome,
    grading_session,
    promoter,
    rank,
    student,
    user,
)
from students.models import Student

pytestmark = pytest.mark.django_db

PROMOTION_CHAIN = ("YELLOW_STRIPE", "YELLOW", "BLUE_STRIPE", "BLUE", "RED_STRIPE")


def reader() -> APIClient:
    client = APIClient()
    client.force_authenticate(
        user=user("read-paths-admin@example.com", role=User.Role.ADMINISTRATOR),
    )
    return client


def promote_through(pupil: Student, rank_code: str) -> None:
    pupil.refresh_from_db()
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(
        session=session,
        student=pupil,
        testing_for_rank=rank(rank_code),
    )
    complete_assessment(assessment(candidate=built))
    transition_grading_session(session, GradingSession.Status.LOCKED)
    built.refresh_from_db()
    promote_candidate(
        finalised_outcome(built),
        promoter(f"read-paths-promoter-{built.pk}@example.com"),
    )


def queries_for(client: APIClient, url: str) -> int:
    client.get(url)
    with CaptureQueriesContext(connection) as captured:
        assert client.get(url).status_code == 200
    return len(captured.captured_queries)


def assert_constant_as_history_grows(endpoint: str) -> None:
    client = reader()
    pupil = student()
    promote_through(pupil, PROMOTION_CHAIN[0])
    url = f"/api/students/{pupil.pk}/{endpoint}/"
    one = queries_for(client, url)

    for rank_code in PROMOTION_CHAIN[1:]:
        promote_through(pupil, rank_code)

    assert queries_for(client, url) == one


def test_unified_grading_history_costs_the_same_however_long_it_is() -> None:
    assert_constant_as_history_grows("grading-history")


def test_rank_history_costs_the_same_however_long_it_is() -> None:
    assert_constant_as_history_grows("rank-history")


def test_promotion_and_outcome_lists_cost_the_same_however_long_they_are() -> None:
    client = reader()
    promote_through(student(), PROMOTION_CHAIN[0])
    endpoints = ("/api/gradings/promotions/", "/api/gradings/outcomes/")
    one = [queries_for(client, url) for url in endpoints]

    for _ in range(3):
        promote_through(student(), PROMOTION_CHAIN[0])

    assert [queries_for(client, url) for url in endpoints] == one
