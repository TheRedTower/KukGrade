"""Comments on assessed items: written, kept as written, carried over from old notes."""

from __future__ import annotations

from typing import Any

import pytest
from django.apps import apps
from django.core.exceptions import ValidationError
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from rest_framework.test import APIClient

from accounts.models import DELETED_USER_PLACEHOLDER_EMAIL, User
from accounts.services import delete_platform_user
from audit.models import AuditAction, AuditEvent
from audit.recording import record
from gradings.assessment_services import add_item_comment
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
    assert event.metadata == {
        "comment": str(comment.pk),
        "assessment": str(item.assessment_id),
    }
    assert "Private words" not in event.summary


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


def test_deleting_a_user_keeps_their_comments_under_the_deleted_user_account() -> None:
    item = started_item()
    author = user("leaving-commenter@example.com")
    comment = add_item_comment(item, "Still here after I go.", author)
    administrator = user("deleter@example.com", role=User.Role.ADMINISTRATOR)

    delete_platform_user(author, administrator)

    comment.refresh_from_db()
    assert comment.author.email == DELETED_USER_PLACEHOLDER_EMAIL
    assert comment.body == "Still here after I go."


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
    # A person with no name set is shown by their email, as elsewhere.
    assert created.json()["author_name"] == "api-commenter@example.com"
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


# --- carrying old notes across ---------------------------------------------


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_old_notes_become_comments_credited_to_the_best_known_author() -> None:
    generated = start_assessment(
        assessment(
            candidate=candidate(
                session=grading_session(status=GradingSession.Status.OPEN)
            ),
        ),
    )
    first, second, third, untouched = list(generated.items.all()[:4])
    wrote_it = user("wrote-the-note@example.com")
    changed_result_only = user("changed-the-result@example.com")
    marked_it = user("marked-the-item@example.com")
    old_target = [("gradings", "0017_remove_draft_outcome_status")]
    executor = MigrationExecutor(connection)
    final_targets = executor.loader.graph.leaf_nodes()

    try:
        executor.migrate(old_target)
        with connection.cursor() as cursor:
            for item, note in (
                (first, "Note A"),
                (second, "Note B"),
                (third, "Note C"),
            ):
                cursor.execute(
                    "UPDATE gradings_candidateassessmentitem SET assessor_notes = %s"
                    " WHERE id = %s",
                    [note, item.pk],
                )
            cursor.execute(
                "UPDATE gradings_candidateassessmentitem SET assessor_id = %s,"
                " result = 'MET', assessed_at = now() WHERE id = %s",
                [marked_it.pk, second.pk],
            )
        # The audit trail says who changed the note to Note A; someone else
        # later changed only the result, and that event carried the note too.
        # Note B has only a marker; Note C has neither.
        event = record(
            AuditAction.ITEM_RESULT_RECORDED,
            first,
            "Notes updated.",
            actor=wrote_it,
            metadata={
                "before": {"result": "NOT_ASSESSED", "assessor_notes": ""},
                "after": {"result": "NOT_ASSESSED", "assessor_notes": "Note A"},
            },
        )
        record(
            AuditAction.ITEM_RESULT_RECORDED,
            first,
            "Recorded as MET.",
            actor=changed_result_only,
            metadata={
                "before": {"result": "NOT_ASSESSED", "assessor_notes": "Note A"},
                "after": {"result": "MET", "assessor_notes": "Note A"},
            },
        )

        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)

        Comment = apps.get_model("gradings", "AssessmentItemComment")
        by_item = {c.item_id: c for c in Comment.objects.all()}
        assert set(by_item) == {first.pk, second.pk, third.pk}
        assert by_item[first.pk].author_id == wrote_it.pk
        assert by_item[first.pk].created_at == event.occurred_at
        assert by_item[first.pk].body == "Note A"
        assert by_item[second.pk].author_id == marked_it.pk
        assert by_item[third.pk].author.email == DELETED_USER_PLACEHOLDER_EMAIL
        assert untouched.pk not in by_item
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)
