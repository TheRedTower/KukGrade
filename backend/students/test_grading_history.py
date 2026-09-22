"""Unified grading-history endpoint (spec section 25): native finalised
outcomes + linked, non-voided legacy records, source-labelled."""

from __future__ import annotations

import itertools

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from data_imports.test_legacy_import import legacy_batch
from gradings.legacy_services import (
    create_legacy_grading_record,
    link_legacy_record_to_student,
    void_legacy_record,
)
from gradings.models import CandidateOutcome, LegacyGradingRecord, LegacyRecordKind
from gradings.tests import finalised_outcome, locked_completed_candidate, user
from students.models import Student

pytestmark = pytest.mark.django_db

_locator_counter = itertools.count(1)


def _legacy_record(student: Student | None, **overrides: object) -> LegacyGradingRecord:
    uploader = user("grading-history-up@example.com")
    data: dict[str, object] = {
        "source_batch": legacy_batch(uploaded_by=uploader),
        "record_kind": LegacyRecordKind.GRADING_RESULT,
        "source_sheet": "06-2025",
        "source_locator": f"06-2025!R{next(_locator_counter)}",
        "cycle_year": 2025,
        "cycle_month": 6,
        "source_name": str(student) if student else "Unlinked",
    }
    data.update(overrides)
    record = create_legacy_grading_record(**data)  # type: ignore[arg-type]
    if student is not None:
        record = link_legacy_record_to_student(
            record,
            student,
            actor=user("grading-history-linker@example.com"),
        )
    return record


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
    _legacy_record(built.student)

    client = APIClient()
    client.force_authenticate(user=user("grading-history-viewer-2@example.com"))
    response = client.get(f"/api/students/{built.student.pk}/grading-history/")

    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["source"] == "LEGACY"
    assert items[0]["date_precision"] == "MONTH"


def test_unlinked_legacy_record_does_not_appear_on_any_student() -> None:
    built, _generated = locked_completed_candidate()
    _legacy_record(None)

    client = APIClient()
    client.force_authenticate(user=user("grading-history-viewer-3@example.com"))
    response = client.get(f"/api/students/{built.student.pk}/grading-history/")

    assert response.json()["items"] == []


def test_voided_legacy_record_is_excluded_even_if_linked() -> None:
    built, _generated = locked_completed_candidate()
    record = _legacy_record(built.student)
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
    _legacy_record(built.student, cycle_year=2020, cycle_month=1)

    client = APIClient()
    client.force_authenticate(user=user("grading-history-viewer-5@example.com"))
    response = client.get(f"/api/students/{built.student.pk}/grading-history/")

    items = response.json()["items"]
    assert len(items) == 2
    assert items[0]["source"] == "KUKGRADE"
    assert items[1]["source"] == "LEGACY"


def test_rank_history_endpoint_is_unaffected_stays_promotion_only() -> None:
    """Spec section 26: /rank-history/ must not merge legacy Pass records."""
    built, _generated = locked_completed_candidate()
    _legacy_record(built.student)

    client = APIClient()
    client.force_authenticate(user=user("grading-history-viewer-6@example.com"))
    response = client.get(f"/api/students/{built.student.pk}/rank-history/")

    assert response.status_code == 200
    assert response.json()["promotions"] == []


def test_instructor_can_view_grading_history_too() -> None:
    """Decision 15: historical visibility matches native grading visibility
    for both roles."""
    built, _generated = locked_completed_candidate()
    _legacy_record(built.student)

    client = APIClient()
    client.force_authenticate(
        user=user("grading-history-instructor@example.com", role=User.Role.INSTRUCTOR),
    )
    response = client.get(f"/api/students/{built.student.pk}/grading-history/")

    assert response.status_code == 200
    assert len(response.json()["items"]) == 1
