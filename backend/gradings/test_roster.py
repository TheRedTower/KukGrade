"""A session's roster: each candidate with their assessment, outcome and next action."""

from __future__ import annotations

import pytest
from pytest_django.fixtures import DjangoAssertNumQueries
from rest_framework.test import APIClient

from gradings.models import (
    CandidateAssessment,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
)
from gradings.outcome_services import (
    create_candidate_outcome,
    propose_candidate_outcome,
)
from gradings.read_models import CandidateNextAction, candidate_next_action
from gradings.services import transition_grading_session
from gradings.testing import (
    assessment,
    auth_client,
    candidate,
    complete_assessment,
    finalised_outcome,
    grading_session,
    locked_completed_candidate,
    master,
    start_assessment,
    user,
)
from kukgrade.testing import results

pytestmark = pytest.mark.django_db


def refreshed(built: GradingCandidate) -> GradingCandidate:
    return GradingCandidate.objects.get(pk=built.pk)


def test_a_candidate_with_no_assessment_is_offered_preparing_one() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))

    assert (
        candidate_next_action(refreshed(built), can_make_final_decision=False)
        == CandidateNextAction.PREPARE_ASSESSMENT
    )


def test_the_next_action_follows_the_assessment_through_marking() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    prepared = assessment(candidate=built)

    assert (
        candidate_next_action(refreshed(built), can_make_final_decision=False)
        == CandidateNextAction.START_ASSESSMENT
    )

    start_assessment(prepared)
    assert (
        candidate_next_action(refreshed(built), can_make_final_decision=False)
        == CandidateNextAction.CONTINUE_ASSESSMENT
    )

    complete_assessment(prepared)
    # Completed in a session that is still open: the record can be looked at.
    assert (
        candidate_next_action(refreshed(built), can_make_final_decision=False)
        == CandidateNextAction.VIEW_ASSESSMENT
    )


def test_a_completed_candidate_in_a_locked_session_is_offered_proposing() -> None:
    built, _generated = locked_completed_candidate()

    assert (
        candidate_next_action(refreshed(built), can_make_final_decision=False)
        == CandidateNextAction.PROPOSE_OUTCOME
    )


def test_a_proposal_is_reviewed_by_the_master_and_looked_at_by_others() -> None:
    built, _generated = locked_completed_candidate()
    outcome = create_candidate_outcome(built, user("roster-open@example.com"))
    propose_candidate_outcome(
        outcome,
        CandidateOutcome.Outcome.PASS,
        "Ready.",
        user("roster-proposer@example.com"),
    )

    assert (
        candidate_next_action(refreshed(built), can_make_final_decision=True)
        == CandidateNextAction.REVIEW_DECISION
    )
    assert (
        candidate_next_action(refreshed(built), can_make_final_decision=False)
        == CandidateNextAction.REVIEW_PROPOSAL
    )


@pytest.mark.parametrize(
    ("final", "expected"),
    [
        (CandidateOutcome.Outcome.PASS, CandidateNextAction.PROMOTION_LEDGER),
        (CandidateOutcome.Outcome.FAIL, CandidateNextAction.VIEW_DECISION),
        (CandidateOutcome.Outcome.CONDITIONAL, CandidateNextAction.VIEW_DECISION),
    ],
)
def test_a_final_decision_leads_to_the_ledger_or_the_record(
    final: str,
    expected: str,
) -> None:
    built, _generated = locked_completed_candidate()
    finalised_outcome(
        built,
        proposed=final,
        final=final,
        conditional_requirements=(
            "Repeat the forms." if final == CandidateOutcome.Outcome.CONDITIONAL else ""
        ),
    )

    assert (
        candidate_next_action(refreshed(built), can_make_final_decision=True)
        == expected
    )


def test_the_session_list_carries_assessment_outcome_and_next_action() -> None:
    built, _generated = locked_completed_candidate()
    finalised_outcome(built)
    client = auth_client("roster-viewer@example.com")

    response = client.get(f"/api/gradings/candidates/?session={built.session_id}")

    assert response.status_code == 200
    [row] = results(response)
    assert row["assessment"]["status"] == CandidateAssessment.Status.COMPLETED
    assert row["assessment"]["overall"]["total"] > 0
    assert row["outcome"]["status"] == CandidateOutcome.Status.FINALISED
    assert row["outcome"]["final_outcome"] == CandidateOutcome.Outcome.PASS
    assert row["next_action"] == CandidateNextAction.PROMOTION_LEDGER


def test_a_registration_with_nothing_yet_has_null_assessment_and_outcome() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    client = auth_client("roster-empty@example.com")

    [row] = results(client.get(f"/api/gradings/candidates/?session={built.session_id}"))

    assert row["assessment"] is None
    assert row["outcome"] is None
    assert row["next_action"] == CandidateNextAction.PREPARE_ASSESSMENT


def test_the_viewers_authority_shapes_the_next_action() -> None:
    built, _generated = locked_completed_candidate()
    outcome = create_candidate_outcome(built, user("roster-open-2@example.com"))
    propose_candidate_outcome(
        outcome,
        CandidateOutcome.Outcome.PASS,
        "Ready.",
        user("roster-proposer-2@example.com"),
    )
    url = f"/api/gradings/candidates/?session={built.session_id}"
    instructor = auth_client("roster-instructor@example.com")
    decider = APIClient()
    decider.force_authenticate(user=master("roster-master@example.com"))

    [seen_by_instructor] = results(instructor.get(url))
    [seen_by_master] = results(decider.get(url))

    assert seen_by_instructor["next_action"] == CandidateNextAction.REVIEW_PROPOSAL
    assert seen_by_master["next_action"] == CandidateNextAction.REVIEW_DECISION


def test_the_roster_costs_the_same_queries_however_many_candidates(
    django_assert_max_num_queries: DjangoAssertNumQueries,
) -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    for _ in range(6):
        complete_assessment(assessment(candidate=candidate(session=session)))
    transition_grading_session(session, GradingSession.Status.LOCKED)
    client = auth_client("roster-queries@example.com")
    url = f"/api/gradings/candidates/?session={session.pk}"
    client.get(url)  # warm: permission and content-type lookups

    with django_assert_max_num_queries(12):
        response = client.get(url)

    assert len(results(response)) == 6


def test_a_write_returns_the_registration_without_the_roster_extras() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    other = grading_session(title="Other", status=GradingSession.Status.OPEN)
    client = auth_client("roster-write@example.com")

    response = client.patch(
        f"/api/gradings/candidates/{built.pk}/",
        {"session": other.pk},
        format="json",
    )

    assert response.status_code == 200
    assert "assessment" not in response.json()
    assert "next_action" not in response.json()


@pytest.mark.parametrize(("proposed", "expected"), [(False, False), (True, True)])
def test_the_roster_says_when_a_final_decision_can_be_recorded(
    proposed: bool,
    expected: bool,
) -> None:
    built, _generated = locked_completed_candidate()
    if proposed:
        outcome = create_candidate_outcome(
            built, user("roster-finalise-open@example.com")
        )
        propose_candidate_outcome(
            outcome,
            CandidateOutcome.Outcome.PASS,
            "Ready.",
            user("roster-finalise-proposer@example.com"),
        )
    client = auth_client("roster-finalise-viewer@example.com")

    [row] = results(client.get(f"/api/gradings/candidates/?session={built.session_id}"))

    # The viewer's own authority is separate: this instructor cannot decide.
    assert row["can_be_finalised"] is expected


def test_a_recorded_decision_can_no_longer_be_finalised() -> None:
    built, _generated = locked_completed_candidate()
    finalised_outcome(built)
    client = auth_client("roster-finalised-viewer@example.com")

    [row] = results(client.get(f"/api/gradings/candidates/?session={built.session_id}"))

    assert row["can_be_finalised"] is False


def test_the_roster_query_count_holds_with_proposals_on_every_row(
    django_assert_max_num_queries: DjangoAssertNumQueries,
) -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = [candidate(session=session) for _ in range(5)]
    for each in built:
        complete_assessment(assessment(candidate=each))
    transition_grading_session(session, GradingSession.Status.LOCKED)
    for each in built:
        propose_candidate_outcome(
            create_candidate_outcome(
                each, user(f"roster-q-open-{each.pk}@example.com")
            ),
            CandidateOutcome.Outcome.PASS,
            "Ready.",
            user(f"roster-q-prop-{each.pk}@example.com"),
        )
    client = auth_client("roster-queries-2@example.com")
    url = f"/api/gradings/candidates/?session={session.pk}"
    client.get(url)

    with django_assert_max_num_queries(12):
        response = client.get(url)

    assert len(results(response)) == 5
