"""Unified grading-history endpoint: native finalised
outcomes + linked, non-voided legacy records, source-labelled."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from data_imports.testing import legacy_record
from gradings.legacy_services import void_legacy_record
from gradings.models import CandidateOutcome
from gradings.testing import finalised_outcome, locked_completed_candidate, user

pytestmark = pytest.mark.django_db


def test_finalised_native_outcome_appears_as_kukgrade_source() -> None:
    built, _generated = locked_completed_candidate()
    finalised_outcome(built)

    client = APIClient()
    client.force_authenticate(user=user("grading-history-viewer-1@example.com"))
    response = client.get(f"/api/students/{built.student.pk}/grading-history/")

    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["source"] == "KUKGRADE"
    assert items[0]["outcome"] == CandidateOutcome.Outcome.PASS


def test_linked_non_voided_legacy_record_appears_as_legacy_source() -> None:
    built, _generated = locked_completed_candidate()
    legacy_record(student=built.student)

    client = APIClient()
    client.force_authenticate(user=user("grading-history-viewer-2@example.com"))
    response = client.get(f"/api/students/{built.student.pk}/grading-history/")

    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["source"] == "LEGACY"
    assert items[0]["date_precision"] == "MONTH"


def test_unlinked_legacy_record_does_not_appear_on_any_student() -> None:
    built, _generated = locked_completed_candidate()
    legacy_record()

    client = APIClient()
    client.force_authenticate(user=user("grading-history-viewer-3@example.com"))
    response = client.get(f"/api/students/{built.student.pk}/grading-history/")

    assert response.json()["items"] == []


def test_voided_legacy_record_is_excluded_even_if_linked() -> None:
    built, _generated = locked_completed_candidate()
    record = legacy_record(student=built.student)
    void_legacy_record(
        record,
        reason="Duplicate row",
        actor=user("grading-history-voider@example.com"),
    )

    client = APIClient()
    client.force_authenticate(user=user("grading-history-viewer-4@example.com"))
    response = client.get(f"/api/students/{built.student.pk}/grading-history/")

    assert response.json()["items"] == []


def test_history_is_sorted_newest_first_across_sources() -> None:
    built, _generated = locked_completed_candidate()
    finalised_outcome(built)  # dated "today" via the session's grading_date
    legacy_record(student=built.student, cycle_year=2020, cycle_month=1)

    client = APIClient()
    client.force_authenticate(user=user("grading-history-viewer-5@example.com"))
    response = client.get(f"/api/students/{built.student.pk}/grading-history/")

    items = response.json()["items"]
    assert len(items) == 2
    assert items[0]["source"] == "KUKGRADE"
    assert items[1]["source"] == "LEGACY"


def test_rank_history_endpoint_is_unaffected_stays_promotion_only() -> None:
    """Import Decision 6: /rank-history/ must not merge legacy Pass records."""
    built, _generated = locked_completed_candidate()
    legacy_record(student=built.student)

    client = APIClient()
    client.force_authenticate(user=user("grading-history-viewer-6@example.com"))
    response = client.get(f"/api/students/{built.student.pk}/rank-history/")

    assert response.status_code == 200
    assert response.json()["promotions"] == []


def test_instructor_can_view_grading_history_too() -> None:
    """Decision 15: historical visibility matches native grading visibility
    for both roles."""
    built, _generated = locked_completed_candidate()
    legacy_record(student=built.student)

    client = APIClient()
    client.force_authenticate(
        user=user("grading-history-instructor@example.com", role=User.Role.INSTRUCTOR),
    )
    response = client.get(f"/api/students/{built.student.pk}/grading-history/")

    assert response.status_code == 200
    assert len(response.json()["items"]) == 1
