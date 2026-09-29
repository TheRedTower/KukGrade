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

The second half tests the lock protocol in `gradings/locking.py` across
*different* operations (KG-A03, KG-A04, KG-A12). A barrier cannot force those
schedules - which thread wins is left to the scheduler - so `interleave()`
holds the first operation just before it commits and runs the second against
it. Each asserts the result matches the one serial order the protocol allows.
Student and user edits are here too: they take the same locks and need the
same harness.
"""

from __future__ import annotations

import pkgutil
import threading
import time
from collections.abc import Callable
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.core.exceptions import ValidationError
from django.db import connection

from accounts.models import User
from accounts.permissions import FINAL_GRADING_DECISION_PERMISSION
from accounts.serializers import ChangePasswordSerializer
from accounts.services import set_user_authority, update_platform_user
from audit.models import AuditAction, AuditEvent
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    Promotion,
)
from gradings.serializers import GradingSessionSerializer
from gradings.services import (
    apply_candidate_update,
    bulk_promote_candidates,
    create_candidate_outcome,
    delete_candidate_assessment,
    delete_grading_session,
    finalise_candidate_outcome,
    generate_candidate_assessment,
    promote_candidate,
    propose_candidate_outcome,
    register_candidate,
    reopen_candidate_assessment,
    transition_grading_session,
    update_candidate_assessment,
    update_candidate_assessment_item,
    withdraw_locked_candidate,
)
from gradings.tests import (
    assessment,
    candidate,
    complete_assessment,
    finalised_outcome,
    grading_session,
    locked_completed_candidate,
    master,
    override_master,
    promoter,
    rank,
    start_assessment,
    student,
    user,
)
from students.models import Student
from students.services import delete_student, update_student

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


# ---------------------------------------------------------------------------
# Cross-operation races: the lock protocol (gradings/locking.py)
# ---------------------------------------------------------------------------


def _waiting_on_lock(backend_pid: int | None) -> bool:
    if backend_pid is None:
        return False
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT wait_event_type FROM pg_stat_activity WHERE pid = %s",
            [backend_pid],
        )
        row = cursor.fetchone()
    return row is not None and row[0] == "Lock"


def interleave(
    first: Callable[[], object],
    second: Callable[[], object],
    *,
    pause_first_at: str,
) -> tuple[object | BaseException, object | BaseException]:
    """Force the one schedule a cross-operation race needs.

    `first` runs until it calls `pause_first_at` - the audit `record()` its
    service calls after taking its locks, reading what it validates and
    writing its change, but before it commits - and is held there. `second`
    then starts. `first` is released once `second` has either finished or is
    seen waiting on a lock in pg_stat_activity.

    Under the lock protocol `second` has to wait, and then runs against what
    `first` committed. Without it, `second` runs straight through against
    the state `first` is about to change - the interleaving each test below
    asserts can no longer happen. The hold is an Event and the poll only
    observes whether `second` is blocked yet: no sleep decides the order.
    """
    real = pkgutil.resolve_name(pause_first_at)
    reached = threading.Event()
    release = threading.Event()
    results: list[object | BaseException] = [None, None]
    second_backend: list[int] = []
    threads: list[threading.Thread] = []

    def pausing(*args: object, **kwargs: object) -> object:
        if threading.current_thread() is threads[0] and not reached.is_set():
            reached.set()
            if not release.wait(timeout=15):
                raise TimeoutError(f"{pause_first_at} was never released")
        return real(*args, **kwargs)

    def run(index: int, target: Callable[[], object]) -> None:
        try:
            if index == 1:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    row = cursor.fetchone()
                    assert row is not None
                    second_backend.append(row[0])
            results[index] = target()
        except BaseException as exc:
            results[index] = exc
        finally:
            connection.close()

    threads.append(threading.Thread(target=run, args=(0, first)))
    threads.append(threading.Thread(target=run, args=(1, second)))
    with patch(pause_first_at, side_effect=pausing):
        threads[0].start()
        while not reached.wait(timeout=0.01):
            if not threads[0].is_alive():
                break
        assert reached.is_set(), f"never reached {pause_first_at}: {results[0]!r}"
        threads[1].start()
        deadline = time.monotonic() + 15
        while (
            threads[1].is_alive()
            and not _waiting_on_lock(second_backend[0] if second_backend else None)
            and time.monotonic() < deadline
        ):
            time.sleep(0.01)
        release.set()
        for thread in threads:
            thread.join(timeout=20)
    assert not any(thread.is_alive() for thread in threads), "a thread never finished"
    return results[0], results[1]


def completed_candidate(
    session: GradingSession,
    graded: Student,
    testing_for: str = "YELLOW_STRIPE",
) -> GradingCandidate:
    built = candidate(
        session=session, student=graded, testing_for_rank=rank(testing_for)
    )
    complete_assessment(assessment(candidate=built))
    built.refresh_from_db()
    return built


def promoted_then_passed_again(
    *graded: Student,
) -> tuple[GradingSession, list[CandidateOutcome]]:
    """Students promoted at one grading, then passed at a later one.

    Returns the earlier session - whose cleanup would roll those promotions
    back - and the later grading's finalised PASS outcomes, ready to promote
    them again.
    """
    earlier = grading_session(
        status=GradingSession.Status.OPEN,
        title="Earlier grading",
        grading_date=date(2027, 3, 20),
    )
    earlier_candidates = [completed_candidate(earlier, one) for one in graded]
    transition_grading_session(earlier, GradingSession.Status.LOCKED)
    for built in earlier_candidates:
        promote_candidate(finalised_outcome(built), promoter(f"first-{built.pk}@e.com"))

    later = grading_session(
        status=GradingSession.Status.OPEN,
        title="Later grading",
        grading_date=date(2027, 6, 20),
    )
    for one in graded:
        one.refresh_from_db()
    later_candidates = [completed_candidate(later, one, "YELLOW") for one in graded]
    transition_grading_session(later, GradingSession.Status.LOCKED)
    return earlier, [finalised_outcome(built) for built in later_candidates]


def refused(result: object, reason: str) -> None:
    """Assert `result` is a refusal, and for the reason given.

    The reason matters: a refusal for some other cause - "no longer exists",
    say - would otherwise pass for the serial outcome being tested.
    """
    assert isinstance(result, ValidationError), result
    assert any(reason in message for message in result.messages), result.messages


def events(action: str, entity: object) -> int:
    return AuditEvent.objects.filter(
        action=action,
        entity_id=str(getattr(entity, "pk", entity)),
    ).count()


def test_item_edit_and_completion_cannot_interleave() -> None:
    """KG-A03 schedule 1: completion must see an item being cleared.

    Without a shared lock, completion read the item as still assessed while
    the edit clearing it was uncommitted, and committed a completed
    assessment holding an unassessed required item.
    """
    session = grading_session(status=GradingSession.Status.OPEN)
    generated = assessment(candidate=candidate(session=session))
    start_assessment(generated)
    assessor = user("race-item-assessor@example.com")
    completer = user("race-item-completer@example.com")
    required = list(generated.items.filter(required=True))
    for item in required:
        update_candidate_assessment_item(
            item,
            result=CandidateAssessmentItem.Result.MET,
            assessor=assessor,
        )
    stale_item = CandidateAssessmentItem.objects.get(pk=required[0].pk)
    stale_assessment = CandidateAssessment.objects.get(pk=generated.pk)

    clearing, completing = interleave(
        lambda: update_candidate_assessment_item(
            stale_item,
            result=CandidateAssessmentItem.Result.NOT_ASSESSED,
            assessor=assessor,
        ),
        lambda: update_candidate_assessment(
            stale_assessment,
            status=CandidateAssessment.Status.COMPLETED,
            actor=completer,
        ),
        pause_first_at="gradings.services.record",
    )

    assert isinstance(clearing, CandidateAssessmentItem)
    refused(completing, "Every required assessment item must be assessed")
    generated.refresh_from_db()
    assert generated.status == CandidateAssessment.Status.IN_PROGRESS
    assert CandidateAssessmentItem.objects.get(pk=required[0].pk).result == (
        CandidateAssessmentItem.Result.NOT_ASSESSED
    )
    assert events(AuditAction.ASSESSMENT_COMPLETED, generated) == 0


def test_reopen_and_session_lock_cannot_interleave() -> None:
    """KG-A03 schedule 2: locking must see an assessment being reopened.

    Without a shared lock, the session locked on the strength of a completed
    assessment that an uncommitted reopen was returning to in-progress.
    """
    session = grading_session(status=GradingSession.Status.OPEN)
    generated = assessment(candidate=candidate(session=session))
    complete_assessment(generated)
    reopener = user("race-reopen@example.com")
    locker = user("race-reopen-locker@example.com")
    stale_assessment = CandidateAssessment.objects.get(pk=generated.pk)
    stale_session = GradingSession.objects.get(pk=session.pk)

    reopening, locking = interleave(
        lambda: reopen_candidate_assessment(stale_assessment, reopener),
        lambda: transition_grading_session(
            stale_session,
            GradingSession.Status.LOCKED,
            actor=locker,
        ),
        pause_first_at="gradings.services.record",
    )

    assert isinstance(reopening, CandidateAssessment)
    refused(locking, "must be completed before the session can be locked")
    session.refresh_from_db()
    assert session.status == GradingSession.Status.OPEN
    generated.refresh_from_db()
    assert generated.status == CandidateAssessment.Status.IN_PROGRESS
    assert events(AuditAction.SESSION_TRANSITIONED, session) == 0


def test_registration_and_session_lock_cannot_interleave() -> None:
    """KG-A03: registration must see the session it registers into lock.

    Without a shared lock, registration checked the session was open, then
    inserted once the lock committed, leaving a locked session holding a
    candidate with no assessment.
    """
    session = grading_session(status=GradingSession.Status.OPEN)
    completed_candidate(session, student())
    newcomer = student()
    locker = user("race-register-locker@example.com")
    registrar = user("race-register@example.com")
    locking_copy = GradingSession.objects.get(pk=session.pk)
    registering_copy = GradingSession.objects.get(pk=session.pk)

    locking, registering = interleave(
        lambda: transition_grading_session(
            locking_copy,
            GradingSession.Status.LOCKED,
            actor=locker,
        ),
        lambda: register_candidate(
            session=registering_copy,
            student=newcomer,
            testing_for_rank=rank("YELLOW_STRIPE"),
            actor=registrar,
        ),
        pause_first_at="gradings.services.record",
    )

    assert isinstance(locking, GradingSession)
    refused(registering, "Candidates can only be added to draft or open sessions")
    session.refresh_from_db()
    assert session.status == GradingSession.Status.LOCKED
    assert not GradingCandidate.objects.filter(
        session=session, student=newcomer
    ).exists()


def test_candidate_move_and_session_lock_cannot_interleave() -> None:
    """KG-A03: moving a candidate into a session must see that session lock."""
    source = grading_session(status=GradingSession.Status.OPEN, title="Source")
    target = grading_session(status=GradingSession.Status.OPEN, title="Target")
    completed_candidate(target, student())
    moving = candidate(session=source)
    locker = user("race-move-locker@example.com")
    mover = user("race-move@example.com")
    locking_copy = GradingSession.objects.get(pk=target.pk)
    stale_target = GradingSession.objects.get(pk=target.pk)
    stale_moving = GradingCandidate.objects.get(pk=moving.pk)

    locking, moved = interleave(
        lambda: transition_grading_session(
            locking_copy,
            GradingSession.Status.LOCKED,
            actor=locker,
        ),
        lambda: apply_candidate_update(stale_moving, session=stale_target, actor=mover),
        pause_first_at="gradings.services.record",
    )

    assert isinstance(locking, GradingSession)
    refused(moved, "Candidates can only be added to draft or open sessions")
    moving.refresh_from_db()
    assert moving.session_id == source.pk


def test_withdrawal_and_finalisation_cannot_interleave() -> None:
    """KG-A03: a withdrawal must not discard a decision finalised meanwhile.

    Without a shared lock, the withdrawal read the outcome as still proposed,
    waited on the finalisation's row lock, then deleted the outcome the
    moment it became a finalised decision.
    """
    built, _generated = locked_completed_candidate()
    outcome = create_candidate_outcome(built, user("race-withdraw-creator@example.com"))
    proposed = propose_candidate_outcome(
        outcome,
        CandidateOutcome.Outcome.PASS,
        "Ready.",
        user("race-withdraw-proposer@example.com"),
    )
    decider = master("race-withdraw-master@example.com")
    withdrawer = override_master("race-withdraw-override@example.com")
    stale_outcome = CandidateOutcome.objects.get(pk=proposed.pk)
    stale_candidate = GradingCandidate.objects.get(pk=built.pk)

    finalising, withdrawing = interleave(
        lambda: finalise_candidate_outcome(
            stale_outcome,
            CandidateOutcome.Outcome.PASS,
            "Confirmed.",
            "",
            decider,
        ),
        lambda: withdraw_locked_candidate(
            stale_candidate,
            GradingCandidate.WithdrawalReason.INJURY,
            "",
            withdrawer,
        ),
        pause_first_at="gradings.services.record",
    )

    assert isinstance(finalising, CandidateOutcome)
    refused(withdrawing, "A candidate with a finalised outcome cannot be withdrawn")
    decided = CandidateOutcome.objects.get(pk=proposed.pk)
    assert decided.status == CandidateOutcome.Status.FINALISED
    built.refresh_from_db()
    assert built.status == GradingCandidate.Status.COMPLETED
    assert events(AuditAction.CANDIDATE_WITHDRAWN, built) == 0


def test_cancellation_and_promotion_follow_arrival_order() -> None:
    """KG-A03: a promotion waits for a cancellation that got there first.

    Unlike the races above this pairing was already serialisable: cancelling
    reads nothing a promotion writes, so the old outcome - promotion first,
    then the cancellation - was a valid order too. The protocol makes the
    order the one the requests arrived in: the cancellation holds the
    session, so the promotion runs after it and is refused.
    """
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    canceller = override_master("race-cancel-override@example.com")
    promoting_actor = promoter("race-cancel-promoter@example.com")
    stale_session = GradingSession.objects.get(pk=built.session_id)
    stale_outcome = CandidateOutcome.objects.get(pk=outcome.pk)

    cancelling, promoting = interleave(
        lambda: transition_grading_session(
            stale_session,
            GradingSession.Status.CANCELLED,
            actor=canceller,
            reason="Abandoned.",
        ),
        lambda: promote_candidate(stale_outcome, promoting_actor),
        pause_first_at="gradings.services.record",
    )

    assert isinstance(cancelling, GradingSession)
    refused(promoting, "Promotions require a locked or completed grading session")
    assert not Promotion.objects.filter(outcome=outcome).exists()
    graded = Student.objects.get(pk=built.student_id)
    assert graded.current_rank_id == built.from_rank_id


def test_session_details_edit_keeps_a_concurrent_cancellation() -> None:
    """KG-A12: a details edit must not write back a stale status.

    The edit used to save the session as the request had loaded it - status
    and cancellation reason included - so a cancellation committed while it
    waited on the row lock was silently undone.
    """
    session = grading_session(status=GradingSession.Status.LOCKED)
    canceller = override_master("race-details-override@example.com")
    editor = user("race-details-editor@example.com")
    cancelling_copy = GradingSession.objects.get(pk=session.pk)
    editing_copy = GradingSession.objects.get(pk=session.pk)

    def rename() -> object:
        serializer = GradingSessionSerializer(
            editing_copy,
            data={"title": "Renamed grading"},
            partial=True,
            context={"request": SimpleNamespace(user=editor)},
        )
        serializer.is_valid(raise_exception=True)
        return serializer.save()

    cancelling, renaming = interleave(
        lambda: transition_grading_session(
            cancelling_copy,
            GradingSession.Status.CANCELLED,
            actor=canceller,
            reason="Abandoned.",
        ),
        rename,
        pause_first_at="gradings.services.record",
    )

    assert isinstance(cancelling, GradingSession)
    assert isinstance(renaming, GradingSession)
    session.refresh_from_db()
    assert session.status == GradingSession.Status.CANCELLED
    assert session.cancellation_reason == "Abandoned."
    assert session.title == "Renamed grading"


def test_assessment_cleanup_refuses_after_a_later_promotion() -> None:
    """KG-A04: cleanup must not roll a rank back over a newer promotion.

    Cleanup checked "this is the student's latest promotion" against a
    student read before a later grading's promotion committed, then wrote
    the old from_rank over the newer rank.
    """
    graded = student()
    earlier, (later_outcome,) = promoted_then_passed_again(graded)
    earlier_assessment = CandidateAssessment.objects.get(candidate__session=earlier)
    promoting_actor = promoter("race-cleanup-promoter@example.com")
    cleaner = user("race-cleanup-admin@example.com", role=User.Role.ADMINISTRATOR)
    stale_outcome = CandidateOutcome.objects.get(pk=later_outcome.pk)

    promoting, cleaning = interleave(
        lambda: promote_candidate(stale_outcome, promoting_actor),
        lambda: delete_candidate_assessment(earlier_assessment, cleaner),
        pause_first_at="gradings.services.record",
    )

    assert isinstance(promoting, Promotion)
    refused(cleaning, "no longer the student's most recent promotion")
    graded.refresh_from_db()
    assert graded.current_rank_id == promoting.to_rank_id
    assert CandidateAssessment.objects.filter(pk=earlier_assessment.pk).exists()
    assert Promotion.objects.filter(student=graded).count() == 2
    assert events(AuditAction.ASSESSMENT_DELETED, earlier_assessment) == 0


def test_session_cleanup_refuses_after_a_later_promotion() -> None:
    """KG-A04: the same guarantee for deleting the whole earlier session."""
    graded = student()
    earlier, (later_outcome,) = promoted_then_passed_again(graded)
    promoting_actor = promoter("race-session-cleanup-promoter@example.com")
    cleaner = user(
        "race-session-cleanup-admin@example.com", role=User.Role.ADMINISTRATOR
    )
    stale_outcome = CandidateOutcome.objects.get(pk=later_outcome.pk)
    stale_earlier = GradingSession.objects.get(pk=earlier.pk)

    promoting, cleaning = interleave(
        lambda: promote_candidate(stale_outcome, promoting_actor),
        lambda: delete_grading_session(stale_earlier, actor=cleaner),
        pause_first_at="gradings.services.record",
    )

    assert isinstance(promoting, Promotion)
    refused(cleaning, "no longer the student's most recent promotion")
    graded.refresh_from_db()
    assert graded.current_rank_id == promoting.to_rank_id
    assert GradingSession.objects.filter(pk=earlier.pk).exists()
    assert events(AuditAction.SESSION_DELETED, earlier) == 0


def test_student_deletion_and_promotion_serialise() -> None:
    """KG-A04: promoting a student being deleted is refused, not a crash.

    The promotion used to wait on a row the deletion had removed, then fail
    with an unhandled DoesNotExist - a 500 for what is a plain refusal.
    """
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    remover = user(
        "race-delete-student-admin@example.com", role=User.Role.ADMINISTRATOR
    )
    promoting_actor = promoter("race-delete-student-promoter@example.com")
    stale_student = Student.objects.get(pk=built.student_id)
    stale_outcome = CandidateOutcome.objects.get(pk=outcome.pk)

    deleting, promoting = interleave(
        lambda: delete_student(stale_student, remover),
        lambda: promote_candidate(stale_outcome, promoting_actor),
        pause_first_at="students.services.record",
    )

    assert not isinstance(deleting, BaseException), deleting
    refused(promoting, "no longer exists")
    assert not Student.objects.filter(pk=built.student_id).exists()
    assert not Promotion.objects.filter(student_id=built.student_id).exists()


def test_bulk_promotion_and_session_cleanup_do_not_deadlock() -> None:
    """KG-A04: two operations over the same students, in opposite orders.

    Bulk promotion used to lock each student as it reached its row - here
    the higher id first - while session cleanup rolled ranks back in its
    own order, so each ended up holding the student the other needed. Both
    now lock every student up front, lowest id first.
    """
    lower = student(last_name="Adams")
    higher = student(last_name="Brown")
    earlier, later_outcomes = promoted_then_passed_again(lower, higher)
    promoting_actor = promoter("race-bulk-promoter@example.com")
    cleaner = user("race-bulk-cleanup-admin@example.com", role=User.Role.ADMINISTRATOR)
    higher_first = [
        CandidateOutcome.objects.get(pk=outcome.pk)
        for outcome in reversed(later_outcomes)
    ]
    stale_earlier = GradingSession.objects.get(pk=earlier.pk)

    promoting, cleaning = interleave(
        lambda: bulk_promote_candidates(outcomes=higher_first, actor=promoting_actor),
        lambda: delete_grading_session(stale_earlier, actor=cleaner),
        pause_first_at="gradings.services.record",
    )

    assert not isinstance(promoting, BaseException), promoting
    assert isinstance(promoting, tuple)
    promoted, errors = promoting
    assert errors == {}
    assert len(promoted) == 2
    refused(cleaning, "no longer the student's most recent promotion")
    assert GradingSession.objects.filter(pk=earlier.pk).exists()
    for graded in (lower, higher):
        graded.refresh_from_db()
        assert graded.current_rank == rank("YELLOW")


def test_concurrent_student_edits_both_survive() -> None:
    """KG-A12: two edits to different fields of one student both land."""
    subject = student(first_name="Before")
    first_copy = Student.objects.get(pk=subject.pk)
    second_copy = Student.objects.get(pk=subject.pk)
    renamer = user("race-student-renamer@example.com")
    leaver = user("race-student-leaver@example.com")

    renaming, leaving = interleave(
        lambda: update_student(first_copy, first_name="After", actor=renamer),
        lambda: update_student(second_copy, status=Student.Status.LEFT, actor=leaver),
        pause_first_at="students.services.record",
    )

    assert isinstance(renaming, Student)
    assert isinstance(leaving, Student)
    subject.refresh_from_db()
    assert subject.first_name == "After"
    assert subject.status == Student.Status.LEFT
    status_event = AuditEvent.objects.get(
        action=AuditAction.STUDENT_STATUS_CHANGED,
        entity_id=str(subject.pk),
    )
    # The second edit's "before" is the first edit's result, as it must be
    # if the two ran one after the other.
    assert status_event.metadata["before"]["first_name"] == "After"


def test_admin_edit_does_not_revert_a_password_change() -> None:
    """KG-A12: an account edit must not write back a stale password hash."""
    account = User.objects.create_user(
        email="race-password@example.com",
        password="kg-Temporary-Pass-123!",
        must_change_password=True,
    )
    stale_account = User.objects.get(pk=account.pk)
    administrator = user(
        "race-password-admin@example.com", role=User.Role.ADMINISTRATOR
    )

    def change_own_password() -> object:
        owner = User.objects.get(pk=account.pk)
        serializer = ChangePasswordSerializer(
            owner,
            data={
                "current_password": "kg-Temporary-Pass-123!",
                "new_password": "kg-Chosen-By-The-Owner-456!",
            },
            context={"request": SimpleNamespace(user=owner)},
        )
        serializer.is_valid(raise_exception=True)
        return serializer.save()

    changing, editing = interleave(
        change_own_password,
        lambda: update_platform_user(
            stale_account, first_name="Renamed", actor=administrator
        ),
        pause_first_at="accounts.services.record",
    )

    assert isinstance(changing, User)
    assert isinstance(editing, User)
    account.refresh_from_db()
    assert account.check_password("kg-Chosen-By-The-Owner-456!")
    assert account.must_change_password is False
    assert account.first_name == "Renamed"


def test_role_change_and_master_grant_cannot_both_succeed() -> None:
    """KG-A12: an administrator is never a Master, even under a race.

    Each check read the other's field without a lock: the grant saw an
    instructor, the role change saw no Master authority, and both committed.
    """
    target = user("race-authority-target@example.com")
    granter = user("race-authority-granter@example.com", role=User.Role.ADMINISTRATOR)
    role_changer = user("race-authority-role@example.com", role=User.Role.ADMINISTRATOR)
    granting_copy = User.objects.get(pk=target.pk)
    role_copy = User.objects.get(pk=target.pk)

    granting, changing_role = interleave(
        lambda: set_user_authority(
            granting_copy,
            granter,
            can_make_final_grading_decision=True,
        ),
        lambda: update_platform_user(
            role_copy,
            role=User.Role.ADMINISTRATOR,
            actor=role_changer,
        ),
        pause_first_at="accounts.services.record",
    )

    assert isinstance(granting, User)
    refused(changing_role, "cannot become an administrator")
    fresh = User.objects.get(pk=target.pk)
    assert fresh.role == User.Role.INSTRUCTOR
    assert fresh.has_perm(FINAL_GRADING_DECISION_PERMISSION)


def test_concurrent_candidate_edits_both_survive() -> None:
    """KG-A12: a note and a withdrawal on one registration both land."""
    session = grading_session(status=GradingSession.Status.OPEN)
    registered = candidate(session=session)
    first_copy = GradingCandidate.objects.get(pk=registered.pk)
    second_copy = GradingCandidate.objects.get(pk=registered.pk)
    noter = user("race-candidate-noter@example.com")
    withdrawer = user("race-candidate-withdrawer@example.com")

    noting, withdrawing = interleave(
        lambda: apply_candidate_update(first_copy, notes="Arrived late.", actor=noter),
        lambda: apply_candidate_update(
            second_copy,
            status=GradingCandidate.Status.WITHDRAWN,
            withdrawal_reason=GradingCandidate.WithdrawalReason.ABSENT,
            actor=withdrawer,
        ),
        pause_first_at="gradings.services.record",
    )

    assert isinstance(noting, GradingCandidate)
    assert isinstance(withdrawing, GradingCandidate)
    registered.refresh_from_db()
    assert registered.notes == "Arrived late."
    assert registered.status == GradingCandidate.Status.WITHDRAWN


def test_promotions_of_one_student_from_two_gradings_serialise() -> None:
    """A promotion waiting on a student another promotion is moving.

    The student lock used to join the student's rank. A FOR UPDATE that
    waits re-checks its join against the row as the other transaction left
    it, and with the rank just moved PostgreSQL dropped the student from the
    result - a DoesNotExist, so a 500, instead of the refusal below.
    """
    graded = student()
    gradings = [
        grading_session(status=GradingSession.Status.OPEN, title=title)
        for title in ("First grading", "Second grading")
    ]
    both = [completed_candidate(session, graded) for session in gradings]
    for session in gradings:
        transition_grading_session(session, GradingSession.Status.LOCKED)
    first_outcome, second_outcome = (finalised_outcome(built) for built in both)
    first_promoter = promoter("race-double-promoter-one@example.com")
    second_promoter = promoter("race-double-promoter-two@example.com")

    promoting, promoting_again = interleave(
        lambda: promote_candidate(
            CandidateOutcome.objects.get(pk=first_outcome.pk),
            first_promoter,
        ),
        lambda: promote_candidate(
            CandidateOutcome.objects.get(pk=second_outcome.pk),
            second_promoter,
        ),
        pause_first_at="gradings.services.record",
    )

    assert isinstance(promoting, Promotion)
    refused(promoting_again, "Promotion target rank must differ from source rank")
    graded.refresh_from_db()
    assert graded.current_rank == rank("YELLOW_STRIPE")
    assert Promotion.objects.filter(student=graded).count() == 1
