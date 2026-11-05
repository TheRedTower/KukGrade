"""Staged final decisions: chosen but unrecorded, kept on the server per Master."""

from __future__ import annotations

import pytest
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditEvent
from gradings.models import CandidateOutcome, GradingSession, StagedDecision
from gradings.outcome_services import (
    finalise_candidate_outcome,
    propose_for_candidate,
    stage_final_decision,
)
from gradings.services import transition_grading_session
from gradings.testing import (
    locked_completed_candidate,
    master,
    override_master,
    user,
)

pytestmark = pytest.mark.django_db


def proposed_outcome(tag: str) -> CandidateOutcome:
    built, _generated = locked_completed_candidate()
    return propose_for_candidate(
        built,
        CandidateOutcome.Outcome.PASS,
        "",
        user(f"{tag}-proposer@example.com"),
    )


def client_for(actor: User | None) -> APIClient:
    client = APIClient()
    if actor is not None:
        client.force_authenticate(user=actor)
    return client


def staged_url(outcome: CandidateOutcome) -> str:
    return f"/api/gradings/outcomes/{outcome.pk}/staged-decision/"


def listed_url(outcome: CandidateOutcome) -> str:
    return (
        "/api/gradings/outcomes/staged-decisions/"
        f"?session={outcome.candidate.session_id}"
    )


def test_a_master_stages_changes_and_reads_back_their_own_decision() -> None:
    outcome = proposed_outcome("stage-own")
    actor = master("stage-own-master@example.com")
    client = client_for(actor)
    events_before = AuditEvent.objects.count()

    first = client.put(
        staged_url(outcome),
        {"final_outcome": "PASS", "decision_notes": "Strong forms "},
        format="json",
    )
    second = client.put(
        staged_url(outcome),
        {
            "final_outcome": "CONDITIONAL",
            "decision_notes": "Strong forms, ",
            "conditional_requirements": "",
        },
        format="json",
    )
    listed = client.get(listed_url(outcome))

    assert first.status_code == 200
    assert second.status_code == 200
    assert StagedDecision.objects.count() == 1
    # Kept as typed, and a Conditional without requirements is allowed while staged.
    assert listed.json() == [
        {
            "outcome": outcome.pk,
            "final_outcome": "CONDITIONAL",
            "decision_notes": "Strong forms, ",
            "conditional_requirements": "",
            "updated_at": second.json()["updated_at"],
        },
    ]
    # Staging decides nothing, so it is not audited; recording it is.
    assert AuditEvent.objects.count() == events_before


def test_each_master_sees_only_their_own_staged_decisions() -> None:
    outcome = proposed_outcome("stage-private")
    first = master("stage-private-first@example.com")
    second = master("stage-private-second@example.com")
    stage_final_decision(outcome, "PASS", "First's note.", "", first)
    stage_final_decision(outcome, "FAIL", "Second's note.", "", second)

    seen_by_second = client_for(second).get(listed_url(outcome)).json()
    discarded = client_for(second).delete(staged_url(outcome))

    assert [row["decision_notes"] for row in seen_by_second] == ["Second's note."]
    assert discarded.status_code == 204
    assert list(StagedDecision.objects.values_list("author_id", flat=True)) == [
        first.pk
    ]


def test_recording_a_decision_removes_every_staged_copy_of_it() -> None:
    outcome = proposed_outcome("stage-record")
    first = master("stage-record-first@example.com")
    second = master("stage-record-second@example.com")
    stage_final_decision(outcome, "PASS", "", "", first)
    stage_final_decision(outcome, "FAIL", "", "", second)

    finalise_candidate_outcome(outcome, "PASS", "", "", first)

    assert not StagedDecision.objects.exists()
    assert client_for(first).get(listed_url(outcome)).json() == []


def test_leaving_the_locked_state_drops_what_was_staged() -> None:
    outcome = proposed_outcome("stage-cancel")
    actor = master("stage-cancel-master@example.com")
    stage_final_decision(outcome, "PASS", "", "", actor)

    transition_grading_session(
        outcome.candidate.session,
        GradingSession.Status.CANCELLED,
        reason="Hall unavailable.",
        actor=override_master("stage-cancel-override@example.com"),
    )

    assert not StagedDecision.objects.exists()


def test_only_a_proposed_outcome_in_a_locked_session_can_be_staged() -> None:
    outcome = proposed_outcome("stage-closed")
    actor = master("stage-closed-master@example.com")
    finalise_candidate_outcome(outcome, "PASS", "", "", actor)

    response = client_for(actor).put(
        staged_url(outcome),
        {"final_outcome": "FAIL"},
        format="json",
    )

    assert response.status_code == 400
    with pytest.raises(ValidationError):
        stage_final_decision(outcome, "FAIL", "", "", actor)
    assert not StagedDecision.objects.exists()


def test_a_staged_decision_must_be_one_of_the_three_outcomes() -> None:
    outcome = proposed_outcome("stage-invalid")
    actor = master("stage-invalid-master@example.com")

    response = client_for(actor).put(
        staged_url(outcome),
        {"final_outcome": "MAYBE"},
        format="json",
    )
    no_session = client_for(actor).get("/api/gradings/outcomes/staged-decisions/")

    assert response.status_code == 400
    assert "final_outcome" in response.json()["error"]["fields"]
    assert no_session.status_code == 400
    assert not StagedDecision.objects.exists()


@pytest.mark.parametrize("who", ["anonymous", "instructor"])
def test_only_final_decision_authority_may_stage_list_or_discard(who: str) -> None:
    outcome = proposed_outcome(f"stage-denied-{who}")
    stage_final_decision(
        outcome, "PASS", "", "", master(f"stage-denied-{who}-master@example.com")
    )
    actor = None if who == "anonymous" else user(f"stage-denied-{who}@example.com")
    client = client_for(actor)

    responses = [
        client.put(staged_url(outcome), {"final_outcome": "FAIL"}, format="json"),
        client.get(listed_url(outcome)),
        client.delete(staged_url(outcome)),
    ]

    assert [response.status_code for response in responses] == [403, 403, 403]
    assert StagedDecision.objects.get().final_outcome == "PASS"
    with pytest.raises(ValidationError):
        stage_final_decision(outcome, "FAIL", "", "", user(f"stage-svc-{who}@x.com"))
