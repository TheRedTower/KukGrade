"""Concurrency tests for the workflows that must not double-write.

Real threads, real Postgres connections, a `threading.Barrier` to force
genuine overlap - the point is that these guarantees hold under an actual
race, not merely by reading the locking code. `django_db(transaction=True)`
is required: the default `django_db` fixture wraps a test in one savepoint on
a single connection, which would make every thread see the same uncommitted
row rather than really contending for its lock.

Marked `concurrency` so the suite can deselect it (`-m "not concurrency"`) if
it ever proves flaky in a particular CI environment without losing the rest
of the tests. Nothing here is skipped by default.

Helpers are imported from `gradings.tests` rather than re-built here - a
grading session, a completed assessment and a finalised outcome are exactly
the same fixtures the rest of the suite already builds correctly.

Two different guarantees are under test here, and it matters which:

- Finalisation and session transitions have no unique-constraint backstop -
  a race can only be caught by the row lock. Verified by temporarily
  removing the `select_for_update` in each and watching both of these two
  tests fail (both threads finalise; both transitions apply).
- Assessment generation, outcome creation and promotion also sit behind a
  real database uniqueness constraint (a `OneToOneField`), so the loser gets
  an `IntegrityError` translated to a `ValidationError` even with the lock
  removed - confirmed the same way. Their `select_for_update` calls exist to
  avoid the wasted work of losing that race, not to prevent a duplicate row;
  the tests below hold either way, which is the point of layering both.
"""

from __future__ import annotations

import threading
from collections.abc import Callable

import pytest
from django.core.exceptions import ValidationError
from django.db import connection

from accounts.models import User
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    Promotion,
)
from gradings.services import (
    create_candidate_outcome,
    finalise_candidate_outcome,
    generate_candidate_assessment,
    promote_candidate,
    propose_candidate_outcome,
    transition_grading_session,
)
from gradings.tests import (
    candidate,
    finalised_outcome,
    locked_completed_candidate,
    master,
    override_master,
    promoter,
    user,
)

pytestmark = [
    # serialized_rollback: a transactional test flushes the database
    # afterwards, which would otherwise wipe the rank catalogue seeded by a
    # migration and never bring it back for the next test in this file.
    pytest.mark.django_db(transaction=True, serialized_rollback=True),
    pytest.mark.concurrency,
]


def run_concurrently(
    *targets: Callable[[], object],
) -> list[object | BaseException]:
    """Run every target on its own thread, released at the same instant.

    Each thread gets Django's normal thread-local connection, so this is a
    genuine multi-connection race rather than one connection pretending to
    be several. The connection is closed when the thread ends - Django does
    not do this automatically for a bare `threading.Thread`.
    """
    barrier = threading.Barrier(len(targets), timeout=10)
    results: list[object | BaseException] = [None] * len(targets)

    def runner(index: int, target: Callable[[], object]) -> None:
        try:
            barrier.wait()
            results[index] = target()
        except BaseException as exc:
            results[index] = exc
        finally:
            connection.close()

    threads = [
        threading.Thread(target=runner, args=(index, target))
        for index, target in enumerate(targets)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)
    return results


def outcomes(results: list[object | BaseException]) -> tuple[int, int]:
    """Return (successes, failures) for a validation-style race."""
    successes = sum(1 for result in results if not isinstance(result, BaseException))
    failures = sum(1 for result in results if isinstance(result, ValidationError))
    assert successes + failures == len(results), results
    return successes, failures


def test_concurrent_assessment_generation_produces_exactly_one_snapshot() -> None:
    built = candidate()
    actor_one = user("concurrent-generate-one@example.com")
    actor_two = user("concurrent-generate-two@example.com")

    results = run_concurrently(
        lambda: generate_candidate_assessment(
            GradingCandidate.objects.get(pk=built.pk),
            actor_one,
        ),
        lambda: generate_candidate_assessment(
            GradingCandidate.objects.get(pk=built.pk),
            actor_two,
        ),
    )

    successes, failures = outcomes(results)
    assert successes == 1
    assert failures == 1
    assert CandidateAssessment.objects.filter(candidate=built).count() == 1
    generated = CandidateAssessment.objects.get(candidate=built)
    assert (
        CandidateAssessmentItem.objects.filter(assessment=generated).count()
        == generated.items.count()
    )


def test_concurrent_outcome_creation_produces_exactly_one_outcome() -> None:
    built, _generated = locked_completed_candidate()
    actor_one = user("concurrent-outcome-one@example.com")
    actor_two = user("concurrent-outcome-two@example.com")

    results = run_concurrently(
        lambda: create_candidate_outcome(
            GradingCandidate.objects.get(pk=built.pk),
            actor_one,
        ),
        lambda: create_candidate_outcome(
            GradingCandidate.objects.get(pk=built.pk),
            actor_two,
        ),
    )

    successes, failures = outcomes(results)
    assert successes == 1
    assert failures == 1
    assert CandidateOutcome.objects.filter(candidate=built).count() == 1


def test_concurrent_finalisation_one_wins_and_one_is_refused() -> None:
    built, _generated = locked_completed_candidate()
    outcome = create_candidate_outcome(
        built,
        user("concurrent-finalise-creator@example.com"),
    )
    proposed = propose_candidate_outcome(
        outcome,
        CandidateOutcome.Outcome.PASS,
        "Ready for a final decision.",
        user("concurrent-finalise-proposer@example.com"),
    )
    master_one = master("concurrent-finalise-master-one@example.com")
    master_two = master("concurrent-finalise-master-two@example.com")

    def finalise(actor: User) -> CandidateOutcome:
        return finalise_candidate_outcome(
            CandidateOutcome.objects.get(pk=proposed.pk),
            CandidateOutcome.Outcome.PASS,
            "Confirmed under race.",
            "",
            actor,
        )

    results = run_concurrently(
        lambda: finalise(master_one),
        lambda: finalise(master_two),
    )

    successes, failures = outcomes(results)
    assert successes == 1
    assert failures == 1
    proposed.refresh_from_db()
    assert proposed.status == CandidateOutcome.Status.FINALISED
    assert proposed.decided_by_id in {master_one.id, master_two.id}


def test_concurrent_promotion_produces_exactly_one_promotion_and_rank_change() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    promoter_one = promoter("concurrent-promote-one@example.com")
    promoter_two = promoter("concurrent-promote-two@example.com")

    results = run_concurrently(
        lambda: promote_candidate(
            CandidateOutcome.objects.get(pk=outcome.pk),
            promoter_one,
        ),
        lambda: promote_candidate(
            CandidateOutcome.objects.get(pk=outcome.pk),
            promoter_two,
        ),
    )

    successes, failures = outcomes(results)
    assert successes == 1
    assert failures == 1
    assert Promotion.objects.filter(outcome=outcome).count() == 1
    built.student.refresh_from_db()
    winning_promotion = Promotion.objects.get(outcome=outcome)
    assert built.student.current_rank_id == winning_promotion.to_rank_id


def test_concurrent_session_transitions_end_in_one_consistent_status() -> None:
    built, _generated = locked_completed_candidate()
    finalised_outcome(built)
    session_id = built.session_id
    # Both actors are independently authorised for their own transition, so
    # the only thing that can make one of them fail is the race itself, not
    # a missing permission - completing needs no special authority, but
    # abandoning a locked session does.
    completing_actor = user("concurrent-transition-complete@example.com")
    cancelling_actor = override_master("concurrent-transition-cancel@example.com")

    results = run_concurrently(
        lambda: transition_grading_session(
            GradingSession.objects.get(pk=session_id),
            GradingSession.Status.COMPLETED,
            actor=completing_actor,
        ),
        lambda: transition_grading_session(
            GradingSession.objects.get(pk=session_id),
            GradingSession.Status.CANCELLED,
            actor=cancelling_actor,
            reason="Abandoned under race.",
        ),
    )

    successes, failures = outcomes(results)
    assert successes == 1
    assert failures == 1
    session = GradingSession.objects.get(pk=session_id)
    assert session.status in {
        GradingSession.Status.COMPLETED,
        GradingSession.Status.CANCELLED,
    }
    winning_result = next(
        result for result in results if not isinstance(result, BaseException)
    )
    assert isinstance(winning_result, GradingSession)
    assert session.status == winning_result.status
