"""A session's roster: each candidate with their assessment, outcome and next action."""

from __future__ import annotations

import pytest
from pytest_django.fixtures import DjangoAssertNumQueries
from rest_framework.test import APIClient

from accounts.testing import grant_permission
from gradings.models import (
    CandidateAssessment,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    Promotion,
)
from gradings.outcome_services import promote_candidate, propose_for_candidate
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
    locked_session_with_undecided_candidate,
    master,
    override_master,
    promoter,
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
    propose_for_candidate(
        built,
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


def test_a_withdrawn_candidate_is_offered_nothing() -> None:
    """The server says what is offered; the page does not work it out."""
    built = candidate(
        session=grading_session(status=GradingSession.Status.OPEN),
        status=GradingCandidate.Status.WITHDRAWN,
    )

    assert (
        candidate_next_action(refreshed(built), can_make_final_decision=True)
        == CandidateNextAction.NONE
    )


def test_a_cancelled_session_offers_only_what_was_recorded() -> None:
    """Not preparing or proposing: a cancelled session's outcomes never move."""
    session, proposed = locked_session_with_undecided_candidate()
    propose_for_candidate(
        proposed, "PASS", "", user("roster-cancel-proposer@example.com")
    )
    transition_grading_session(
        session,
        GradingSession.Status.CANCELLED,
        actor=override_master("roster-cancel-master@example.com"),
        reason="Abandoned",
    )

    assert (
        candidate_next_action(refreshed(proposed), can_make_final_decision=True)
        == CandidateNextAction.VIEW_ASSESSMENT
    )
    # A registration with nothing prepared, as a session cancelled while open has.
    unprepared = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    GradingSession.objects.filter(pk=unprepared.session_id).update(
        status=GradingSession.Status.CANCELLED
    )
    assert (
        candidate_next_action(refreshed(unprepared), can_make_final_decision=True)
        == CandidateNextAction.NONE
    )


def test_the_roster_says_who_may_withdraw_a_candidate_after_lock() -> None:
    """Served, so the page does not work it out from statuses and flags."""
    built, _generated = locked_completed_candidate()
    row = f"/api/gradings/candidates/?session={built.session_id}"

    def offered(client: APIClient) -> bool:
        return bool(results(client.get(row))[0]["can_be_withdrawn_after_lock"])

    overrider = APIClient()
    overrider.force_authenticate(
        user=override_master("roster-withdraw-master@example.com")
    )
    assert offered(overrider) is True
    assert offered(auth_client("roster-withdraw-instructor@example.com")) is False

    finalised_outcome(built)
    assert offered(overrider) is False


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
    propose_for_candidate(
        built,
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


@pytest.mark.parametrize(
    "path",
    ["/api/gradings/candidates/", "/api/gradings/assessments/"],
)
def test_the_masters_view_of_a_locked_session_costs_no_query_per_row(
    path: str,
) -> None:
    """Whether marks are still open is read for every row only for the
    Master; it must use the outcome the list already joins (Codex, #192)."""
    from django.db import connection
    from django.test.utils import CaptureQueriesContext
    from rest_framework.test import APIClient

    def queries_for(size: int, name: str) -> int:
        session = grading_session(title=name, status=GradingSession.Status.OPEN)
        for _ in range(size):
            complete_assessment(assessment(candidate=candidate(session=session)))
        transition_grading_session(session, GradingSession.Status.LOCKED)
        client = APIClient()
        client.force_authenticate(user=master(f"{name}@example.com"))
        url = f"{path}?session={session.pk}"
        client.get(url)  # warm: permission and content-type lookups
        with CaptureQueriesContext(connection) as captured:
            assert client.get(url).status_code == 200
        return len(captured)

    assert queries_for(2, "small") == queries_for(5, "large")


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
        propose_for_candidate(
            built,
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
        propose_for_candidate(
            each,
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


def test_the_roster_carries_the_promotion_only_to_those_who_may_see_promotions() -> (
    None
):
    built, _generated = locked_completed_candidate()
    promoted_by = promoter("roster-promoter@example.com")
    promote_candidate(finalised_outcome(built), promoted_by)
    url = f"/api/gradings/candidates/?session={built.session_id}"
    seen_by_promoter = APIClient()
    seen_by_promoter.force_authenticate(user=promoted_by)
    seen_by_instructor = APIClient()
    # Can see candidates, but not promotions.
    limited = user("roster-no-promotions@example.com")
    limited.groups.clear()
    seen_by_instructor.force_authenticate(
        user=grant_permission(limited, "gradings.view_gradingcandidate"),
    )

    [with_access] = results(seen_by_promoter.get(url))
    [without_access] = results(seen_by_instructor.get(url))

    assert (
        with_access["promotion"]["id"]
        == Promotion.objects.get(grading_candidate_id=built.pk).pk
    )
    assert with_access["promotion"]["to_rank_name"]
    assert without_access["promotion"] is None


def test_a_candidate_not_yet_promoted_has_a_null_promotion() -> None:
    built, _generated = locked_completed_candidate()
    finalised_outcome(built)
    client = APIClient()
    client.force_authenticate(user=promoter("roster-promoter-2@example.com"))

    [row] = results(client.get(f"/api/gradings/candidates/?session={built.session_id}"))

    assert row["promotion"] is None


def test_the_roster_with_promotions_costs_the_same_queries_however_many_candidates(
    django_assert_max_num_queries: DjangoAssertNumQueries,
) -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    outcomes = []
    for _ in range(4):
        built = candidate(session=session)
        complete_assessment(assessment(candidate=built))
        outcomes.append(built)
    transition_grading_session(session, GradingSession.Status.LOCKED)
    actor = promoter("roster-promoter-3@example.com")
    for built in outcomes:
        promote_candidate(finalised_outcome(built), actor)
    client = APIClient()
    client.force_authenticate(user=actor)
    url = f"/api/gradings/candidates/?session={session.pk}"
    client.get(url)

    with django_assert_max_num_queries(14):
        response = client.get(url)

    assert all(row["promotion"] for row in results(response))
