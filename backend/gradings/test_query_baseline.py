"""How many queries the hot paths cost, as ceilings, with the baseline recorded.

Measured 2026-11-05 on dev after the audit's section 8 work (audit P3-1). A
ceiling is the measured count plus a little room, so an unrelated change does not
break these but a path that quietly gets heavier does. When a change lowers a
path, lower its ceiling in the same change and update docs/development.md.

The item write is the heavy one: every tap on Met or Not met costs 76 statements,
about fifty of them the database re-checking constraints the save already
validated in Python (`Model.save()` runs `full_clean()`, which checks each CHECK
and UNIQUE constraint with its own query). That is audit hypothesis H-01, now
measured; P3-2 acts on it.
"""

from __future__ import annotations

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from pytest_django.fixtures import DjangoAssertNumQueries

from gradings.models import CandidateAssessment, GradingSession
from gradings.testing import (
    assessment,
    auth_client,
    candidate,
    grading_session,
    start_assessment,
    student,
)
from kukgrade.testing import results

pytestmark = pytest.mark.django_db


def started_assessment() -> tuple[CandidateAssessment, list[int]]:
    session = grading_session(status=GradingSession.Status.OPEN)
    generated = assessment(candidate=candidate(session=session))
    start_assessment(generated)
    return generated, list(generated.items.order_by("pk").values_list("pk", flat=True))


def test_marking_an_item_stays_within_its_baseline(
    django_assert_max_num_queries: DjangoAssertNumQueries,
) -> None:
    # Baseline 76 for a first mark and for a later change with a reason.
    _generated, items = started_assessment()
    client = auth_client("baseline-marker@example.com")
    url = f"/api/gradings/assessment-items/{items[0]}/"
    client.patch(f"/api/gradings/assessment-items/{items[1]}/", {"result": "MET"})

    with django_assert_max_num_queries(80):
        first = client.patch(url, {"result": "MET"}, format="json")
    with django_assert_max_num_queries(80):
        later = client.patch(
            url,
            {"result": "NOT_MET", "reason": "Seen again on review."},
            format="json",
        )

    assert (first.status_code, later.status_code) == (200, 200)


def test_commenting_stays_within_its_baseline(
    django_assert_max_num_queries: DjangoAssertNumQueries,
) -> None:
    # Baseline 26.
    _generated, items = started_assessment()
    client = auth_client("baseline-commenter@example.com")
    url = f"/api/gradings/assessment-items/{items[0]}/comments/"
    client.post(url, {"body": "Warm."}, format="json")

    with django_assert_max_num_queries(30):
        response = client.post(url, {"body": "Crisp footwork."}, format="json")

    assert response.status_code == 201


def test_the_assessment_summary_and_item_list_stay_within_their_baselines(
    django_assert_max_num_queries: DjangoAssertNumQueries,
) -> None:
    # Baselines 2 and 4.
    generated, _items = started_assessment()
    client = auth_client("baseline-reader@example.com")
    summary = f"/api/gradings/assessments/{generated.pk}/summary/"
    listing = f"/api/gradings/assessment-items/?assessment={generated.pk}&page_size=200"
    client.get(summary)
    client.get(listing)

    with django_assert_max_num_queries(4):
        client.get(summary)
    with django_assert_max_num_queries(6):
        response = client.get(listing)

    assert len(results(response)) > 5


def test_the_student_list_costs_the_same_however_many_students() -> None:
    # Baseline 2: the page and its count, whatever its length.
    client = auth_client("baseline-students@example.com")
    student()
    client.get("/api/students/")
    with CaptureQueriesContext(connection) as one:
        client.get("/api/students/")
    for _ in range(30):
        student()
    with CaptureQueriesContext(connection) as many:
        response = client.get("/api/students/")

    assert len(results(response)) == 31
    assert len(many.captured_queries) == len(one.captured_queries)
    assert len(many.captured_queries) <= 4
