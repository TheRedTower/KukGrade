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
        {"final_outcome": "PASS", "decision_notes": "Strong forms ", "revision": 1},
        format="json",
    )
    second = client.put(
        staged_url(outcome),
        {
            "final_outcome": "CONDITIONAL",
            "decision_notes": "Strong forms, ",
            "conditional_requirements": "",
            "revision": 2,
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
            "revision": 2,
            "updated_at": second.json()["updated_at"],
        },
    ]
    # Staging decides nothing, so it is not audited; recording it is.
    assert AuditEvent.objects.count() == events_before


def test_each_master_sees_only_their_own_staged_decisions() -> None:
    outcome = proposed_outcome("stage-private")
    first = master("stage-private-first@example.com")
    second = master("stage-private-second@example.com")
    stage_final_decision(outcome, "PASS", "First's note.", "", first, revision=1)
    stage_final_decision(outcome, "FAIL", "Second's note.", "", second, revision=1)

    seen_by_second = client_for(second).get(listed_url(outcome)).json()
    discarded = client_for(second).delete(f"{staged_url(outcome)}?revision=2")

    assert [row["decision_notes"] for row in seen_by_second] == ["Second's note."]
    assert discarded.status_code == 204
    # The second Master's is taken off; the first's is untouched.
    assert client_for(second).get(listed_url(outcome)).json() == []
    assert [
        row["decision_notes"]
        for row in client_for(first).get(listed_url(outcome)).json()
    ] == ["First's note."]


def test_recording_a_decision_removes_every_staged_copy_of_it() -> None:
    outcome = proposed_outcome("stage-record")
    first = master("stage-record-first@example.com")
    second = master("stage-record-second@example.com")
    stage_final_decision(outcome, "PASS", "", "", first, revision=1)
    stage_final_decision(outcome, "FAIL", "", "", second, revision=1)

    finalise_candidate_outcome(outcome, "PASS", "", "", first)

    assert not StagedDecision.objects.exists()
    assert client_for(first).get(listed_url(outcome)).json() == []


def test_leaving_the_locked_state_drops_what_was_staged() -> None:
    outcome = proposed_outcome("stage-cancel")
    actor = master("stage-cancel-master@example.com")
    stage_final_decision(outcome, "PASS", "", "", actor, revision=1)

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
        {"final_outcome": "FAIL", "revision": 1},
        format="json",
    )

    assert response.status_code == 400
    with pytest.raises(ValidationError):
        stage_final_decision(outcome, "FAIL", "", "", actor, revision=1)
    assert not StagedDecision.objects.exists()


def test_a_staged_decision_must_be_one_of_the_three_outcomes() -> None:
    outcome = proposed_outcome("stage-invalid")
    actor = master("stage-invalid-master@example.com")

    response = client_for(actor).put(
        staged_url(outcome),
        {"final_outcome": "MAYBE", "revision": 1},
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
        outcome,
        "PASS",
        "",
        "",
        master(f"stage-denied-{who}-master@example.com"),
        revision=1,
    )
    actor = None if who == "anonymous" else user(f"stage-denied-{who}@example.com")
    client = client_for(actor)

    responses = [
        client.put(
            staged_url(outcome),
            {"final_outcome": "FAIL", "revision": 2},
            format="json",
        ),
        client.get(listed_url(outcome)),
        client.delete(f"{staged_url(outcome)}?revision=2"),
    ]

    assert [response.status_code for response in responses] == [403, 403, 403]
    assert StagedDecision.objects.get().final_outcome == "PASS"
    with pytest.raises(ValidationError):
        stage_final_decision(
            outcome, "FAIL", "", "", user(f"stage-svc-{who}@x.com"), revision=2
        )


# --- a change that arrives late cannot undo a newer one -------------------------


def test_a_save_that_arrives_after_the_decision_was_taken_off_is_refused() -> None:
    # The page took Pass off and closed while the save of Pass was on its way;
    # the take-off reached the server first.
    outcome = proposed_outcome("stage-late-save")
    client = client_for(master("stage-late-save-master@example.com"))

    taken_off = client.delete(f"{staged_url(outcome)}?revision=2")
    late = client.put(
        staged_url(outcome),
        {"final_outcome": "PASS", "revision": 1},
        format="json",
    )

    assert taken_off.status_code == 204
    assert late.status_code == 400
    assert late.json()["error"]["fields"]["revision"] == [
        "A newer change to this decision has already been saved."
    ]
    assert client.get(listed_url(outcome)).json() == []


def test_a_take_off_that_arrives_after_a_newer_save_is_refused() -> None:
    outcome = proposed_outcome("stage-late-discard")
    client = client_for(master("stage-late-discard-master@example.com"))

    client.put(
        staged_url(outcome), {"final_outcome": "FAIL", "revision": 5}, format="json"
    )
    late = client.delete(f"{staged_url(outcome)}?revision=4")
    again = client.put(
        staged_url(outcome), {"final_outcome": "PASS", "revision": 5}, format="json"
    )

    assert late.status_code == 400
    # The same revision is not newer either.
    assert again.status_code == 400
    assert [row["final_outcome"] for row in client.get(listed_url(outcome)).json()] == [
        "FAIL"
    ]


def test_a_decision_taken_off_can_be_staged_again_by_a_newer_change() -> None:
    outcome = proposed_outcome("stage-again")
    client = client_for(master("stage-again-master@example.com"))

    client.put(
        staged_url(outcome), {"final_outcome": "PASS", "revision": 1}, format="json"
    )
    client.delete(f"{staged_url(outcome)}?revision=2")
    restaged = client.put(
        staged_url(outcome),
        {"final_outcome": "CONDITIONAL", "decision_notes": "Again.", "revision": 3},
        format="json",
    )

    assert restaged.status_code == 200
    assert client.get(listed_url(outcome)).json() == [restaged.json()]
    assert StagedDecision.objects.count() == 1


def test_every_change_says_which_change_it_is() -> None:
    outcome = proposed_outcome("stage-no-revision")
    client = client_for(master("stage-no-revision-master@example.com"))

    responses = [
        client.put(staged_url(outcome), {"final_outcome": "PASS"}, format="json"),
        client.put(
            staged_url(outcome), {"final_outcome": "PASS", "revision": 0}, format="json"
        ),
        client.delete(staged_url(outcome)),
        client.delete(f"{staged_url(outcome)}?revision=soon"),
    ]

    assert [response.status_code for response in responses] == [400, 400, 400, 400]
    assert all(
        response.json()["error"]["fields"]["revision"] == ["Send which change this is."]
        for response in responses
    )
    assert not StagedDecision.objects.exists()


def test_taking_off_a_decision_that_can_no_longer_be_staged_just_removes_it() -> None:
    outcome = proposed_outcome("stage-off-closed")
    actor = master("stage-off-closed-master@example.com")
    other = master("stage-off-closed-other@example.com")
    stage_final_decision(outcome, "PASS", "", "", other, revision=1)
    finalise_candidate_outcome(outcome, "PASS", "", "", actor)

    response = client_for(actor).delete(f"{staged_url(outcome)}?revision=9")

    assert response.status_code == 204
    assert not StagedDecision.objects.exists()
