"""An event's details read as words: labels and values, no codes or ids."""

from __future__ import annotations

import ast
import re
from datetime import date
from pathlib import Path

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from audit.details import HIDDEN, LABELS, RankNames, event_details
from audit.models import AuditAction, AuditEvent
from gradings.assessment_services import update_candidate_assessment_item
from gradings.models import CandidateAssessmentItem, GradingCandidate, GradingSession
from gradings.outcome_services import promote_candidate
from gradings.services import apply_candidate_update, transition_grading_session
from gradings.testing import (
    assessment,
    candidate,
    complete_assessment,
    finalised_outcome,
    grading_session,
    promoter,
    rank,
    start_assessment,
    user,
)
from kukgrade.testing import results
from students.services import create_student, update_student

pytestmark = pytest.mark.django_db

BACKEND = Path(__file__).resolve().parent.parent


def details(action: str) -> list[dict[str, str]]:
    event = AuditEvent.objects.filter(action=action).latest("occurred_at")
    return event_details(event, RankNames.read())


def as_dict(rows: list[dict[str, str]]) -> dict[str, str]:
    return {row["label"]: row["value"] for row in rows}


def test_a_status_change_reads_was_to_now() -> None:
    session = grading_session()
    transition_grading_session(session, GradingSession.Status.OPEN)

    assert details(AuditAction.SESSION_TRANSITIONED) == [
        {"label": "Status", "value": "Draft to Open"},
    ]


def test_a_mark_names_the_result_and_hides_the_ids() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = start_assessment(assessment(candidate=candidate(session=session)))
    item = built.items.first()
    assert item is not None
    update_candidate_assessment_item(
        item,
        result=CandidateAssessmentItem.Result.MET,
        assessor=user("details-marker@example.com"),
    )

    assert details(AuditAction.ITEM_RESULT_RECORDED) == [
        {"label": "Mark", "value": "Not assessed to Met"},
        {"label": "After the session locked", "value": "No"},
    ]


def test_a_decision_and_a_promotion_name_outcomes_ranks_and_dates() -> None:
    session = grading_session(
        status=GradingSession.Status.OPEN,
        grading_date=date(2027, 9, 4),
    )
    built = candidate(session=session)
    complete_assessment(assessment(candidate=built))
    transition_grading_session(session, GradingSession.Status.LOCKED)
    outcome = finalised_outcome(built)
    promote_candidate(outcome, promoter("details-promoter@example.com"))

    assert as_dict(details(AuditAction.OUTCOME_FINALISED)) == {
        "Proposed outcome": "Pass",
        "Final decision": "Pass",
        "Overrode the proposal": "No",
    }
    assert as_dict(details(AuditAction.PROMOTION_RECORDED)) == {
        "From": "White",
        "To": "Yellow Stripe",
        "Effective date": "4 Sep 2027",
    }


def test_a_withdrawal_names_its_reason() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    apply_candidate_update(
        built,
        status=GradingCandidate.Status.WITHDRAWN,
        withdrawal_reason=GradingCandidate.WithdrawalReason.ABSENT,
        actor=user("details-withdraw@example.com"),
    )

    shown = as_dict(details(AuditAction.CANDIDATE_WITHDRAWN))
    assert shown["Reason for withdrawing"] == "Did not attend"
    assert shown["Status"] == "Registered to Withdrawn"


def test_a_students_personal_details_show_only_that_they_changed() -> None:
    actor = user("details-student@example.com")
    graded = create_student(
        wksa_id="123-4-951",
        first_name="Orrin",
        last_name="Vale",
        date_of_birth=date(2014, 6, 7),
        current_rank=rank("WHITE"),
        actor=actor,
    )
    update_student(
        graded,
        first_name="Orla",
        date_of_birth=date(2014, 6, 8),
        status="INACTIVE",
        actor=actor,
    )

    shown = details(AuditAction.STUDENT_STATUS_CHANGED)
    assert {"label": "Status", "value": "Active to Inactive"} in shown
    assert {"label": "First name", "value": "Changed"} in shown
    assert {"label": "Date of birth", "value": "Changed"} in shown
    assert "Orla" not in str(shown) and "2014" not in str(shown)


def test_the_audit_list_serves_details_not_the_stored_metadata() -> None:
    transition_grading_session(grading_session(), GradingSession.Status.OPEN)
    client = APIClient()
    client.force_authenticate(
        user=user("details-reader@example.com", role=User.Role.ADMINISTRATOR),
    )

    [row] = [
        row
        for row in results(client.get("/api/audit-events/"))
        if row["action"] == AuditAction.SESSION_TRANSITIONED
    ]

    assert "metadata" not in row
    assert row["details"] == [{"label": "Status", "value": "Draft to Open"}]


def _metadata_keys() -> set[str]:
    """Every key the code writes into an event's metadata, read from the
    source: the dicts passed as `metadata=` and the snapshots `before` and
    `after` are built from."""
    keys: set[str] = set()
    for path in BACKEND.glob("*/*.py"):
        if path.name.startswith("test") or path.parent.name in {"audit", "kukgrade"}:
            continue
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            dicts: list[ast.AST] = []
            if isinstance(node, ast.keyword) and node.arg == "metadata":
                dicts.append(node.value)
            if isinstance(node, ast.FunctionDef) and "snapshot" in node.name:
                dicts.append(node)
            for found in dicts:
                for inner in ast.walk(found):
                    if isinstance(inner, ast.Dict):
                        keys |= {
                            key.value
                            for key in inner.keys
                            if isinstance(key, ast.Constant)
                            and isinstance(key.value, str)
                        }
    return keys


def test_every_key_the_code_records_has_a_name_or_is_hidden_on_purpose() -> None:
    keys = _metadata_keys()
    assert {"before", "after", "status", "final_outcome"} <= keys  # the scan works

    # Keys inside a list's entries, which the list's own wording covers.
    nested = {"before", "after", "from", "to", "student_wksa_id"}
    unnamed = keys - set(LABELS) - HIDDEN - nested
    assert unnamed == set()


def test_no_detail_shows_a_stored_code() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    complete_assessment(assessment(candidate=built))
    transition_grading_session(session, GradingSession.Status.LOCKED)
    promote_candidate(finalised_outcome(built), promoter("details-codes@example.com"))
    ranks = RankNames.read()

    shown = " ".join(
        f"{row['label']} {row['value']}"
        for event in AuditEvent.objects.all()
        for row in event_details(event, ranks)
    )

    assert shown
    assert not re.search(r"\b[A-Z]+_[A-Z_]+\b|\b[a-z]+_[a-z_]+\b", shown)
