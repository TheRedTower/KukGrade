"""Comments on assessed items: written, and kept as written."""

from __future__ import annotations

from typing import Any

import pytest
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from accounts.models import User
from accounts.services import delete_platform_user
from audit.models import AuditAction, AuditEvent
from gradings.assessment_services import (
    add_item_comment,
    update_candidate_assessment_item,
)
from gradings.models import (
    AssessmentItemComment,
    CandidateAssessment,
    GradingCandidate,
    GradingSession,
)
from gradings.services import delete_grading_session
from gradings.testing import (
    assessment,
    auth_client,
    candidate,
    complete_assessment,
    grading_session,
    start_assessment,
    user,
)
from kukgrade.testing import results

pytestmark = pytest.mark.django_db


def started_item(status: str = CandidateAssessment.Status.IN_PROGRESS):  # type: ignore[no-untyped-def]
    """An item of an assessment in an open session, at `status`."""
    generated = assessment(
        candidate=candidate(session=grading_session(status=GradingSession.Status.OPEN))
    )
    if status == CandidateAssessment.Status.IN_PROGRESS:
        start_assessment(generated)
    elif status == CandidateAssessment.Status.COMPLETED:
        complete_assessment(generated)
    item = generated.items.first()
    assert item is not None
    return item


def test_a_comment_keeps_its_author_and_time() -> None:
    item = started_item()
    author = user("comment-author@example.com")

    comment = add_item_comment(item, "  Crisp chamber.  ", author)

    assert comment.author == author
    assert comment.body == "Crisp chamber."
    assert comment.created_at is not None
    assert list(item.comments.all()) == [comment]


def test_comments_stay_open_after_the_assessment_is_completed() -> None:
    item = started_item(CandidateAssessment.Status.COMPLETED)

    comment = add_item_comment(
        item, "Second look: still good.", user("late@example.com")
    )

    assert comment.pk is not None


def test_comments_are_listed_in_the_order_they_were_written() -> None:
    item = started_item()
    first = add_item_comment(item, "First.", user("order-one@example.com"))
    second = add_item_comment(item, "Second.", user("order-two@example.com"))

    assert list(item.comments.all()) == [first, second]


@pytest.mark.parametrize("body", ["", "   ", "\n"])
def test_an_empty_comment_is_refused(body: str) -> None:
    item = started_item()

    with pytest.raises(ValidationError):
        add_item_comment(item, body, user("empty-comment@example.com"))

    assert not item.comments.exists()


def test_a_comment_needs_a_started_assessment() -> None:
    item = started_item(CandidateAssessment.Status.NOT_STARTED)

    with pytest.raises(ValidationError):
        add_item_comment(item, "Too early.", user("not-started-comment@example.com"))


@pytest.mark.parametrize(
    "session_status",
    [GradingSession.Status.LOCKED, GradingSession.Status.CANCELLED],
)
def test_a_comment_needs_an_open_session(session_status: str) -> None:
    item = started_item(CandidateAssessment.Status.COMPLETED)
    GradingSession.objects.filter(pk=item.assessment.candidate.session_id).update(
        status=session_status,
    )

    with pytest.raises(ValidationError):
        add_item_comment(
            item, "Out of time.", user(f"closed-{session_status}@example.com")
        )


def test_a_withdrawn_candidate_cannot_be_commented_on() -> None:
    item = started_item()
    GradingCandidate.objects.filter(pk=item.assessment.candidate_id).update(
        status=GradingCandidate.Status.WITHDRAWN,
        withdrawal_reason=GradingCandidate.WithdrawalReason.OTHER,
        withdrawal_note="Direct write for the test.",
        withdrawn_by=user("comment-withdrawer@example.com"),
        withdrawn_at=item.assessment.generated_at,
    )

    with pytest.raises(ValidationError):
        add_item_comment(item, "Gone.", user("withdrawn-comment@example.com"))


def test_adding_a_comment_is_audited_without_its_words() -> None:
    item = started_item()
    author = user("audited-comment@example.com")

    comment = add_item_comment(item, "Private words about a child.", author)

    event = AuditEvent.objects.get(action=AuditAction.ITEM_COMMENT_ADDED)
    assert event.actor == author
    assert event.entity_id == str(item.pk)
    candidate_row = item.assessment.candidate
    assert event.metadata == {
        "comment": str(comment.pk),
        "after_lock": False,
        "assessment": str(item.assessment_id),
        # Where it happened, by id, so a history of the session or the student
        # gathers it.
        "student_id": candidate_row.student_id,
        "candidate_id": candidate_row.pk,
        "session_id": candidate_row.session_id,
    }
    assert "Private words" not in event.summary
    assert f"for student {candidate_row.student.wksa_id}" in event.summary


def test_a_comment_cannot_be_changed_or_removed() -> None:
    item = started_item()
    comment = add_item_comment(item, "As written.", user("append-only@example.com"))

    comment.body = "Rewritten."
    with pytest.raises(ValidationError):
        comment.save()
    with pytest.raises(ValidationError):
        comment.delete()
    with pytest.raises(ValidationError):
        AssessmentItemComment.objects.filter(pk=comment.pk).update(body="Rewritten.")
    with pytest.raises(ValidationError):
        AssessmentItemComment.objects.filter(pk=comment.pk).delete()

    assert AssessmentItemComment.objects.get(pk=comment.pk).body == "As written."


def test_comments_go_with_their_session_when_an_administrator_deletes_it() -> None:
    item = started_item()
    add_item_comment(
        item, "Gone with the session.", user("cascade-comment@example.com")
    )
    administrator = user("cascade-admin@example.com", role=User.Role.ADMINISTRATOR)

    delete_grading_session(item.assessment.candidate.session, actor=administrator)

    assert not AssessmentItemComment.objects.exists()


def test_deleting_a_user_keeps_their_name_on_their_comments() -> None:
    item = started_item()
    author = user("leaving-commenter@example.com")
    comment = add_item_comment(item, "Still here after I go.", author)
    administrator = user("deleter@example.com", role=User.Role.ADMINISTRATOR)

    delete_platform_user(author, administrator)

    comment.refresh_from_db()
    assert comment.author == author
    assert comment.body == "Still here after I go."


# --- an item that already has a mark ----------------------------------------


@pytest.mark.parametrize("mark", ["MET", "NOT_MET"])
def test_several_people_can_each_comment_on_an_item_that_is_already_marked(
    mark: str,
) -> None:
    item = started_item()
    marker = user("marker@example.com")
    first_reviewer = user("first-reviewer@example.com")
    second_reviewer = user("second-reviewer@example.com")
    marked = update_candidate_assessment_item(item, result=mark, assessor=marker)
    marked_at = marked.assessed_at
    marking_events = AuditEvent.objects.filter(
        action=AuditAction.ITEM_RESULT_RECORDED,
    ).count()

    # Two people each saw different technical things; neither is turned away
    # because the item has a mark, and neither overwrites the other.
    first = add_item_comment(
        item, "Chamber too low on the second kick.", first_reviewer
    )
    second = add_item_comment(
        item, "Weight stayed on the back foot throughout.", second_reviewer
    )

    assert [c.author for c in item.comments.all()] == [first_reviewer, second_reviewer]
    assert [c.body for c in item.comments.all()] == [first.body, second.body]
    assert first.created_at <= second.created_at
    # Each is stamped in the audit trail by whoever wrote it ...
    comment_events = AuditEvent.objects.filter(action=AuditAction.ITEM_COMMENT_ADDED)
    assert {event.actor for event in comment_events} == {
        first_reviewer,
        second_reviewer,
    }
    # ... and the mark, its marker and its time are exactly as they were.
    item.refresh_from_db()
    assert item.result == mark
    assert item.assessor == marker
    assert item.assessed_at == marked_at
    assert (
        AuditEvent.objects.filter(action=AuditAction.ITEM_RESULT_RECORDED).count()
        == marking_events
    )


def test_the_same_person_can_add_a_second_comment_to_a_marked_item() -> None:
    item = started_item()
    author = user("adds-twice@example.com")
    update_candidate_assessment_item(item, result="MET", assessor=author)

    add_item_comment(item, "Good stance.", author)
    add_item_comment(item, "Also a clean finish.", author)

    assert item.comments.count() == 2


def test_the_items_list_shows_every_persons_comment_on_a_marked_item() -> None:
    item = started_item()
    update_candidate_assessment_item(item, result="MET", assessor=user("m@example.com"))
    for email, last_name, body in (
        ("reviewer-one@example.com", "One", "Technical point one."),
        ("reviewer-two@example.com", "Two", "A different technical point."),
    ):
        response = auth_client(email, first_name="Rae", last_name=last_name).post(
            f"/api/gradings/assessment-items/{item.pk}/comments/",
            {"body": body},
            format="json",
        )
        assert response.status_code == 201

    listed = auth_client("reader@example.com").get(
        f"/api/gradings/assessment-items/?assessment={item.assessment_id}",
    )

    [row] = [r for r in results(listed) if r["id"] == item.pk]
    assert row["result"] == "MET"
    assert [(c["author_name"], c["body"]) for c in row["comments"]] == [
        ("Rae One", "Technical point one."),
        ("Rae Two", "A different technical point."),
    ]
    assert all(c["created_at"] for c in row["comments"])


# --- the API --------------------------------------------------------------


def test_the_api_adds_a_comment_and_the_items_list_carries_it() -> None:
    item = started_item()
    client = auth_client("api-commenter@example.com")

    created = client.post(
        f"/api/gradings/assessment-items/{item.pk}/comments/",
        {"body": "Needs a wider stance."},
        format="json",
    )
    listed = client.get(
        f"/api/gradings/assessment-items/?assessment={item.assessment_id}",
    )

    assert created.status_code == 201
    assert created.json()["body"] == "Needs a wider stance."
    # Never by email: an account made before names were required says so.
    assert created.json()["author_name"] == "Unnamed account"
    [row] = [r for r in results(listed) if r["id"] == item.pk]
    assert [c["body"] for c in row["comments"]] == ["Needs a wider stance."]
    assert "assessor_notes" not in row


def test_the_api_ignores_a_note_sent_to_the_item_update() -> None:
    item = started_item()
    client = auth_client("old-client@example.com")

    response = client.patch(
        f"/api/gradings/assessment-items/{item.pk}/",
        {"result": "MET", "assessor_notes": "Old way of saving a note."},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["comments"] == []
    assert not item.comments.exists()


@pytest.mark.parametrize(
    "body", [{}, {"body": ""}, {"body": "   "}, {"body": "x" * 2001}]
)
def test_the_api_refuses_a_missing_empty_or_overlong_comment(
    body: dict[str, Any],
) -> None:
    item = started_item()
    client = auth_client("api-bad-comment@example.com")

    response = client.post(
        f"/api/gradings/assessment-items/{item.pk}/comments/",
        body,
        format="json",
    )

    assert response.status_code == 400
    assert not item.comments.exists()


def test_the_api_says_in_plain_words_what_is_wrong_with_a_comment() -> None:
    item = started_item()
    client = auth_client("api-plain-words@example.com")
    url = f"/api/gradings/assessment-items/{item.pk}/comments/"

    empty = client.post(url, {"body": "  "}, format="json").json()["error"]["message"]
    long = client.post(url, {"body": "x" * 2001}, format="json").json()["error"][
        "message"
    ]

    assert empty == "Write a comment to add."
    assert long == (
        "A comment can be at most 2000 characters. "
        "Shorten it, or add the rest as a second comment."
    )


def test_the_api_needs_a_signed_in_person_who_may_mark() -> None:
    item = started_item()
    url = f"/api/gradings/assessment-items/{item.pk}/comments/"
    outsider = User.objects.create_user(email="no-group@example.com")
    outsider.groups.clear()
    signed_out = APIClient()
    no_authority = APIClient()
    no_authority.force_authenticate(user=outsider)

    assert signed_out.post(url, {"body": "Hi."}, format="json").status_code == 403
    assert no_authority.post(url, {"body": "Hi."}, format="json").status_code == 403
    assert not item.comments.exists()
