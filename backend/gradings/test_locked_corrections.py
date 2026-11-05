"""After the lock only the authorised Master corrects a mark or comments, until that
candidate's final decision is recorded, and every such change says so."""

from __future__ import annotations

import pytest
from django.core.exceptions import ValidationError
from pytest_django.fixtures import DjangoAssertNumQueries

from audit.models import AuditAction, AuditEvent
from gradings.assessment_services import (
    add_item_comment,
    assessment_marks_open,
    update_candidate_assessment_item,
)
from gradings.models import (
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
)
from gradings.outcome_services import propose_for_candidate
from gradings.testing import (
    auth_client,
    finalised_outcome,
    locked_completed_candidate,
    master,
    user,
)
from kukgrade.testing import results

pytestmark = pytest.mark.django_db

MET = CandidateAssessmentItem.Result.MET
NOT_MET = CandidateAssessmentItem.Result.NOT_MET
NOT_ASSESSED = CandidateAssessmentItem.Result.NOT_ASSESSED


def locked_item() -> CandidateAssessmentItem:
    """A required, marked item of a completed assessment in a locked session."""
    built, generated = locked_completed_candidate()
    item = generated.items.filter(required=True).first()
    assert item is not None
    assert built.session.status == GradingSession.Status.LOCKED
    return item


# --- who may -----------------------------------------------------------------


def test_the_master_can_correct_a_mark_after_the_lock_with_a_reason() -> None:
    item = locked_item()
    decider = master("locked-master@example.com")

    changed = update_candidate_assessment_item(
        item,
        result=NOT_MET,
        reason="Reviewed the recording.",
        assessor=decider,
    )

    assert changed.result == NOT_MET
    assert changed.assessor == decider
    [entry] = changed.changes.all()
    assert (entry.from_result, entry.to_result, entry.reason) == (
        MET,
        NOT_MET,
        "Reviewed the recording.",
    )
    assert entry.after_lock is True
    event = AuditEvent.objects.filter(
        action=AuditAction.ITEM_RESULT_RECORDED,
        entity_id=str(item.pk),
    ).latest("occurred_at")
    assert event.metadata["after_lock"] is True
    assert "Reviewed the recording" not in str(event.metadata) + event.summary


def test_the_master_can_comment_after_the_lock_and_it_says_so() -> None:
    item = locked_item()
    decider = master("locked-commenter@example.com")

    comment = add_item_comment(item, "Looked again; the pivot was fine.", decider)

    assert comment.after_lock is True
    event = AuditEvent.objects.get(action=AuditAction.ITEM_COMMENT_ADDED)
    assert event.metadata["after_lock"] is True


def test_an_instructor_cannot_change_a_mark_or_comment_after_the_lock() -> None:
    item = locked_item()
    instructor = user("locked-instructor@example.com")

    with pytest.raises(ValidationError) as changing:
        update_candidate_assessment_item(
            item,
            result=NOT_MET,
            reason="Second thoughts.",
            assessor=instructor,
        )
    with pytest.raises(ValidationError) as commenting:
        add_item_comment(item, "A late thought.", instructor)

    assert "only the authorised Master" in str(changing.value)
    assert "only the authorised Master" in str(commenting.value)
    item.refresh_from_db()
    assert item.result == MET
    assert not item.changes.exists() and not item.comments.exists()


def test_a_correction_after_the_lock_always_needs_a_reason_even_a_first_mark() -> None:
    item = locked_item()
    CandidateAssessmentItem.objects.filter(pk=item.pk).update(
        required=False,
        result=NOT_ASSESSED,
        assessor=None,
        assessed_at=None,
    )
    item.refresh_from_db()
    decider = master("locked-first-mark@example.com")

    with pytest.raises(ValidationError) as exc_info:
        update_candidate_assessment_item(item, result=MET, assessor=decider)

    assert exc_info.value.message_dict["reason"] == ["Say why the mark is changing."]
    marked = update_candidate_assessment_item(
        item,
        result=MET,
        reason="Not examined on the day; seen on the recording.",
        assessor=decider,
    )
    assert marked.changes.get().after_lock is True


def test_a_required_item_still_cannot_be_cleared_after_the_lock() -> None:
    item = locked_item()

    with pytest.raises(ValidationError) as exc_info:
        update_candidate_assessment_item(
            item,
            result=NOT_ASSESSED,
            reason="Wrong item.",
            assessor=master("locked-clear@example.com"),
        )

    assert "required item marked" in str(exc_info.value)


# --- until the decision is recorded ------------------------------------------


def test_a_proposal_does_not_stop_the_master_correcting_a_mark() -> None:
    built, generated = locked_completed_candidate()
    item = generated.items.filter(required=True).first()
    assert item is not None
    propose_for_candidate(
        built, CandidateOutcome.Outcome.PASS, "Ready.", user("p@example.com")
    )

    changed = update_candidate_assessment_item(
        item,
        result=NOT_MET,
        reason="After the proposal, a second look.",
        assessor=master("after-proposal@example.com"),
    )

    assert changed.result == NOT_MET


def test_a_recorded_final_decision_fixes_the_record_even_for_the_master() -> None:
    built, generated = locked_completed_candidate()
    item = generated.items.filter(required=True).first()
    assert item is not None
    finalised_outcome(built)
    decider = master("after-decision@example.com")

    with pytest.raises(ValidationError) as changing:
        update_candidate_assessment_item(
            item,
            result=NOT_MET,
            reason="Too late.",
            assessor=decider,
        )
    with pytest.raises(ValidationError) as commenting:
        add_item_comment(item, "Too late.", decider)

    assert "final decision has been recorded" in str(changing.value)
    assert "final decision has been recorded" in str(commenting.value)
    item.refresh_from_db()
    assert item.result == MET


def test_another_candidate_is_unaffected_by_one_candidates_recorded_decision() -> None:
    decided, _ = locked_completed_candidate()
    finalised_outcome(decided)
    other_built, other_generated = locked_completed_candidate()
    item = other_generated.items.filter(required=True).first()
    assert item is not None
    # Same session? Make it so: the second candidate shares the first's session.
    GradingCandidate.objects.filter(pk=other_built.pk).update(session=decided.session)

    changed = update_candidate_assessment_item(
        item,
        result=NOT_MET,
        reason="Undecided candidate in a session that has decided another.",
        assessor=master("shared-session@example.com"),
    )

    assert changed.result == NOT_MET


@pytest.mark.parametrize(
    "status",
    [GradingSession.Status.COMPLETED, GradingSession.Status.CANCELLED],
)
def test_nobody_corrects_a_completed_or_cancelled_session(status: str) -> None:
    item = locked_item()
    GradingSession.objects.filter(pk=item.assessment.candidate.session_id).update(
        status=status
    )

    with pytest.raises(ValidationError):
        update_candidate_assessment_item(
            item,
            result=NOT_MET,
            reason="No.",
            assessor=master(f"closed-{status}@example.com"),
        )


# --- what the screen is told ---------------------------------------------------


def test_the_assessment_says_whether_the_viewer_may_change_marks_now() -> None:
    _built, generated = locked_completed_candidate()
    decider = master("flag-master@example.com")
    instructor = user("flag-instructor@example.com")

    assert assessment_marks_open(generated, decider) is True
    assert assessment_marks_open(generated, instructor) is False


def test_the_api_serves_marks_open_to_each_viewer() -> None:
    built, generated = locked_completed_candidate()
    decider = master("api-flag-master@example.com")
    instructor_client = auth_client("api-flag-instructor@example.com")
    master_client = auth_client("api-flag-other@example.com")
    master_client.force_authenticate(user=decider)
    url = f"/api/gradings/assessments/?session={built.session_id}"

    [for_instructor] = results(instructor_client.get(url))
    [for_master] = results(master_client.get(url))

    assert for_instructor["marks_open"] is False
    assert for_master["marks_open"] is True


def test_the_api_lets_the_master_correct_and_refuses_everyone_else_after_the_lock() -> (
    None
):
    item = locked_item()
    url = f"/api/gradings/assessment-items/{item.pk}/"
    decider_client = auth_client("api-decider@example.com")
    decider_client.force_authenticate(user=master("api-decider-master@example.com"))

    refused = auth_client("api-locked-instructor@example.com").patch(
        url, {"result": "NOT_MET", "reason": "Please."}, format="json"
    )
    no_reason = decider_client.patch(url, {"result": "NOT_MET"}, format="json")
    done = decider_client.patch(
        url, {"result": "NOT_MET", "reason": "Reviewed on video."}, format="json"
    )

    assert refused.status_code == 400
    assert "only the authorised Master" in refused.json()["error"]["message"]
    assert no_reason.status_code == 400
    assert done.status_code == 200
    [entry] = done.json()["changes"]
    assert entry["after_lock"] is True and entry["reason"] == "Reviewed on video."


def test_the_roster_query_count_holds_with_the_new_flag(
    django_assert_max_num_queries: DjangoAssertNumQueries,
) -> None:
    built, _ = locked_completed_candidate()
    client = auth_client("flag-queries@example.com")
    url = f"/api/gradings/candidates/?session={built.session_id}"
    client.get(url)

    with django_assert_max_num_queries(14):
        client.get(url)
