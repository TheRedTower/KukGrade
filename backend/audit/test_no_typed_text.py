"""The audit log records that typed text was written or changed, never the words.

Notes, reasons and conditions can name a child or say anything about one; the
records hold them, and the log keeps who changed what and when
(audit.recording.TYPED_TEXT).
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from audit.details import RankNames, event_details
from audit.models import AuditAction, AuditEvent
from audit.recording import record
from data_imports.testing import legacy_record
from gradings.assessment_services import update_candidate_assessment
from gradings.legacy_services import void_legacy_record
from gradings.models import CandidateOutcome, GradingCandidate, GradingSession
from gradings.outcome_services import propose_candidate_outcome, propose_for_candidate
from gradings.services import (
    apply_candidate_update,
    transition_grading_session,
    update_grading_session,
    withdraw_locked_candidate,
)
from gradings.testing import (
    assessment,
    candidate,
    complete_assessment,
    finalised_outcome,
    grading_session,
    locked_completed_candidate,
    override_master,
    start_assessment,
    user,
)

pytestmark = pytest.mark.django_db

# Typed into every note, reason and condition below; the log must hold none.
TYPED = "Zeta-wrote-this"


def _log_text() -> str:
    return " ".join(
        f"{event.summary} {json.dumps(event.metadata)}"
        for event in AuditEvent.objects.all()
    )


def _shown(event: AuditEvent) -> dict[str, str]:
    return {
        row["label"]: row["value"] for row in event_details(event, RankNames.read())
    }


@pytest.mark.parametrize(
    "metadata",
    [
        {"notes": "Kept out"},
        {"before": {"withdrawal_note": ""}, "after": {"withdrawal_note": "x"}},
        {"candidates": [{"proposal_notes": "x"}]},
    ],
)
def test_an_event_refuses_typed_text_wherever_it_is(metadata: dict[str, Any]) -> None:
    session = grading_session()

    with pytest.raises(ValueError, match="typed text"):
        record(AuditAction.SESSION_UPDATED, session, "Updated.", metadata=metadata)
    assert not AuditEvent.objects.filter(action=AuditAction.SESSION_UPDATED).exists()


def test_a_grading_leaves_none_of_its_typed_text_in_the_log() -> None:
    actor = user("typed-text-instructor@example.com")
    session = grading_session(status=GradingSession.Status.OPEN)
    update_grading_session(session, changes={"notes": f"{TYPED} session"}, actor=actor)
    built = candidate(session=session)
    apply_candidate_update(built, notes=f"{TYPED} registration", actor=actor)
    generated = start_assessment(assessment(candidate=built))
    update_candidate_assessment(generated, notes=f"{TYPED} overall", actor=actor)
    complete_assessment(generated)
    other = candidate(session=session)
    complete_assessment(assessment(candidate=other))
    transition_grading_session(session, GradingSession.Status.LOCKED)
    proposal = propose_for_candidate(
        built, CandidateOutcome.Outcome.PASS, f"{TYPED} first", actor
    )
    propose_candidate_outcome(
        proposal, CandidateOutcome.Outcome.FAIL, f"{TYPED} second", actor
    )
    withdraw_locked_candidate(
        built,
        reason=GradingCandidate.WithdrawalReason.OTHER,
        note=f"{TYPED} withdrawal",
        actor=override_master("typed-text-master@example.com"),
    )
    finalised_outcome(
        other,
        final=CandidateOutcome.Outcome.CONDITIONAL,
        conditional_requirements=f"{TYPED} conditions",
    )
    void_legacy_record(legacy_record(), reason=f"{TYPED} void", actor=actor)
    cancelled = grading_session(status=GradingSession.Status.LOCKED)
    transition_grading_session(
        cancelled,
        GradingSession.Status.CANCELLED,
        actor=override_master("typed-text-canceller@example.com"),
        reason=f"{TYPED} cancelled",
    )

    assert AuditEvent.objects.count() > 10  # the flow was recorded
    assert TYPED not in _log_text()


def test_the_audit_screen_says_typed_text_changed_without_its_words() -> None:
    actor = user("typed-text-screen@example.com")
    generated = start_assessment(
        assessment(
            candidate=candidate(
                session=grading_session(status=GradingSession.Status.OPEN),
            ),
        ),
    )

    update_candidate_assessment(generated, notes=f"{TYPED} overall", actor=actor)

    event = AuditEvent.objects.get(action=AuditAction.ASSESSMENT_UPDATED)
    assert _shown(event) == {"Notes": "Changed"}


def test_a_withdrawal_says_whether_a_note_and_a_proposal_went_with_it() -> None:
    built, _ = locked_completed_candidate()
    propose_for_candidate(
        built,
        CandidateOutcome.Outcome.PASS,
        f"{TYPED} proposal",
        user("typed-text-proposer@example.com"),
    )

    withdraw_locked_candidate(
        built,
        reason=GradingCandidate.WithdrawalReason.OTHER,
        note=f"{TYPED} withdrawal",
        actor=override_master("typed-text-withdrawer@example.com"),
    )

    event = AuditEvent.objects.filter(action=AuditAction.CANDIDATE_WITHDRAWN).latest(
        "occurred_at"
    )
    shown = _shown(event)
    assert shown["Note given"] == "Yes"
    assert shown["Proposal discarded"] == "Pass"
    assert TYPED not in str(shown)


def test_cancelling_a_locked_session_says_a_reason_was_given() -> None:
    session = grading_session(status=GradingSession.Status.LOCKED)

    transition_grading_session(
        session,
        GradingSession.Status.CANCELLED,
        actor=override_master("typed-text-cancel-reason@example.com"),
        reason=f"{TYPED} cancelled",
    )

    event = AuditEvent.objects.get(action=AuditAction.SESSION_TRANSITIONED)
    assert _shown(event) == {
        "Status": "Locked to Cancelled",
        "Reason for cancelling": "Changed",
    }
