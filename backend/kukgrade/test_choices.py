"""The served choice lists: every value a control offers, with its name."""

from __future__ import annotations

import pytest
from django.db import models
from rest_framework.test import APIClient

from accounts.models import User
from accounts.permissions import AUTHORITY_PERMISSIONS
from data_imports.models import ImportBatch, ImportRowOutcome
from gradings.models import (
    CandidateAssessmentStatus,
    GradingCandidateStatus,
    GradingSessionStatus,
    ItemResult,
)
from students.models import STUDENT_STATUS_MEANINGS, StudentStatus

pytestmark = pytest.mark.django_db


def _served() -> dict[str, list[dict[str, str]]]:
    client = APIClient()
    client.force_authenticate(
        user=User.objects.create_user(email="choices@example.com")
    )
    response = client.get("/api/choices/")
    assert response.status_code == 200
    body: dict[str, list[dict[str, str]]] = response.json()
    return body


def _pairs(choices: type[models.TextChoices]) -> list[tuple[str, str]]:
    return [(str(value), str(label)) for value, label in choices.choices]


def _as_pairs(served: list[dict[str, str]]) -> list[tuple[str, str]]:
    return [(choice["value"], choice["label"]) for choice in served]


def test_choices_need_a_signed_in_user() -> None:
    assert APIClient().get("/api/choices/").status_code in {401, 403}


def test_each_list_is_the_models_own_choices() -> None:
    served = _served()

    assert _as_pairs(served["session_statuses"]) == _pairs(GradingSessionStatus)
    assert _as_pairs(served["student_statuses"]) == _pairs(StudentStatus)
    assert _as_pairs(served["candidate_statuses"]) == _pairs(GradingCandidateStatus)
    assert _as_pairs(served["assessment_statuses"]) == _pairs(CandidateAssessmentStatus)
    assert _as_pairs(served["item_results"]) == _pairs(ItemResult)
    assert _as_pairs(served["import_kinds"]) == _pairs(ImportBatch.Kind)
    assert _as_pairs(served["import_row_outcomes"]) == _pairs(ImportRowOutcome)
    assert _as_pairs(served["roles"]) == _pairs(User.Role)


def test_the_outcomes_come_in_the_order_the_controls_offer_them() -> None:
    assert [choice["value"] for choice in _served()["outcomes"]] == [
        "PASS",
        "CONDITIONAL",
        "FAIL",
    ]


def test_the_finished_import_states_leave_out_the_open_one() -> None:
    values = [choice["value"] for choice in _served()["finished_import_statuses"]]

    assert values == ["COMMITTED", "CANCELLED", "EXPIRED"]


def test_the_withdrawal_reasons_say_which_needs_a_note() -> None:
    assert _served()["withdrawal_reasons"] == [
        {"value": "INJURY", "label": "Injured during grading", "note_required": False},
        {"value": "WITHDREW", "label": "Withdrew voluntarily", "note_required": False},
        {"value": "ABSENT", "label": "Did not attend", "note_required": False},
        {"value": "OTHER", "label": "Other", "note_required": True},
    ]


def test_every_authority_is_named_and_described_once() -> None:
    authorities = _served()["authorities"]

    assert [choice["value"] for choice in authorities] == list(AUTHORITY_PERMISSIONS)
    assert all(choice["label"] and choice["description"] for choice in authorities)


def test_each_student_status_says_what_it_means() -> None:
    served = _served()["student_statuses"]

    assert {choice["value"]: choice["description"] for choice in served} == {
        str(status): meaning for status, meaning in STUDENT_STATUS_MEANINGS.items()
    }
