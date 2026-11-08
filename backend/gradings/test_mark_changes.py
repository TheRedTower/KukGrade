"""Marks on assessment items: the first needs no reason, every change after does."""

from __future__ import annotations

from typing import Any

import pytest
from django.apps import apps
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor

from accounts.models import User
from accounts.services import delete_platform_user
from audit.models import AuditAction, AuditEvent
from gradings.assessment_services import update_candidate_assessment_item
from gradings.models import (
    AssessmentItemResultChange,
    CandidateAssessment,
    CandidateAssessmentItem,
    GradingCandidate,
    GradingSession,
)
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

MET = CandidateAssessmentItem.Result.MET
NOT_MET = CandidateAssessmentItem.Result.NOT_MET
NOT_ASSESSED = CandidateAssessmentItem.Result.NOT_ASSESSED


def open_item(*, completed: bool = False) -> CandidateAssessmentItem:
    """A required, unmarked item of a started assessment in an open session."""
    generated = start_assessment(
        assessment(
            candidate=candidate(
                session=grading_session(status=GradingSession.Status.OPEN)
            ),
        ),
    )
    if completed:
        complete_assessment(generated)
        item = generated.items.filter(required=True).first()
        assert item is not None
        return item
    item = generated.items.filter(required=True).first()
    assert item is not None
    return item


def mark(
    item: CandidateAssessmentItem, result: str, who: User, reason: str = ""
) -> Any:
    return update_candidate_assessment_item(
        item, result=result, reason=reason, assessor=who
    )


# --- the first mark ------------------------------------------------------------


def test_the_first_mark_needs_no_reason_and_is_the_first_entry_in_the_log() -> None:
    item = open_item()
    marker = user("first-marker@example.com")

    marked = mark(item, MET, marker)

    assert marked.result == MET
    assert marked.assessor == marker
    [change] = marked.changes.all()
    assert (change.sequence, change.from_result, change.to_result) == (
        1,
        NOT_ASSESSED,
        MET,
    )
    assert change.changed_by == marker
    assert change.reason == ""


def test_a_reason_given_with_the_first_mark_is_kept() -> None:
    item = open_item()

    marked = mark(
        item, NOT_MET, user("first-with-reason@example.com"), "Missed the pivot."
    )

    assert [c.reason for c in marked.changes.all()] == ["Missed the pivot."]


# --- changing a mark needs a reason --------------------------------------------


@pytest.mark.parametrize(
    ("first", "second"),
    [(MET, NOT_MET), (NOT_MET, MET), (MET, NOT_ASSESSED), (NOT_MET, NOT_ASSESSED)],
)
@pytest.mark.parametrize("reason", ["", "   ", "\n"])
def test_changing_a_mark_without_a_reason_is_refused_even_for_your_own(
    first: str,
    second: str,
    reason: str,
) -> None:
    item = open_item()
    marker = user(f"own-mark-{first}-{second}-{len(reason)}@example.com")
    mark(item, first, marker)

    with pytest.raises(ValidationError) as exc_info:
        mark(item, second, marker, reason)

    assert exc_info.value.message_dict["reason"] == ["Say why the mark is changing."]
    item.refresh_from_db()
    assert item.result == first
    assert item.changes.count() == 1


@pytest.mark.parametrize(
    ("first", "second"),
    [(MET, NOT_MET), (NOT_MET, MET), (MET, NOT_ASSESSED)],
)
def test_a_change_with_a_reason_is_recorded_with_who_when_and_why(
    first: str,
    second: str,
) -> None:
    item = open_item()
    mark(item, first, user("original@example.com"))
    reviser = user(f"reviser-{first}-{second}@example.com")

    changed = mark(item, second, reviser, "  Watched it again.  ")

    assert changed.result == second
    if second == NOT_ASSESSED:
        assert changed.assessor is None and changed.assessed_at is None
    else:
        assert changed.assessor == reviser and changed.assessed_at is not None
    first_entry, second_entry = changed.changes.all()
    assert first_entry.sequence == 1
    assert (
        second_entry.sequence,
        second_entry.from_result,
        second_entry.to_result,
    ) == (
        2,
        first,
        second,
    )
    assert second_entry.changed_by == reviser
    assert second_entry.reason == "Watched it again."
    assert second_entry.changed_at >= first_entry.changed_at


def test_sequence_numbers_keep_counting() -> None:
    item = open_item()
    who = user("counting@example.com")
    mark(item, MET, who)
    mark(item, NOT_MET, who, "One.")
    mark(item, MET, who, "Two.")

    assert [c.sequence for c in item.changes.all()] == [1, 2, 3]


def test_marking_an_item_again_after_it_was_cleared_needs_a_reason_too() -> None:
    # The item is unmarked again, but this is not its first change: the log
    # already holds the mark and the clear, so the next entry needs its reason.
    item = open_item()
    who = user("re-marker@example.com")
    mark(item, MET, who)
    mark(item, NOT_ASSESSED, who, "Wrong item.")

    with pytest.raises(ValidationError) as exc_info:
        mark(item, NOT_MET, who)

    assert exc_info.value.message_dict["reason"] == ["Say why the mark is changing."]
    item.refresh_from_db()
    assert item.result == NOT_ASSESSED
    assert item.changes.count() == 2

    again = mark(item, NOT_MET, who, "The right item, now seen.")

    assert again.result == NOT_MET
    assert [c.sequence for c in again.changes.all()] == [1, 2, 3]
    last_event = AuditEvent.objects.filter(
        action=AuditAction.ITEM_RESULT_RECORDED,
        entity_id=str(item.pk),
    ).latest("occurred_at")
    assert "changed from" in last_event.summary


def test_repeating_the_same_mark_changes_and_records_nothing() -> None:
    item = open_item()
    who = user("repeat-mark@example.com")
    mark(item, MET, who)
    events = AuditEvent.objects.filter(action=AuditAction.ITEM_RESULT_RECORDED).count()

    mark(item, MET, user("repeat-other@example.com"))
    mark(item, MET, who, "Same again.")

    assert item.changes.count() == 1
    assert (
        AuditEvent.objects.filter(action=AuditAction.ITEM_RESULT_RECORDED).count()
        == events
    )


def test_a_screen_that_still_shows_the_item_unmarked_cannot_overwrite_a_mark() -> None:
    # The audit's S-11: two people marking the same item. The second sees it as
    # unmarked, sends a "first" mark with no reason, and is refused rather than
    # silently replacing what the first recorded.
    item = open_item()
    stale = CandidateAssessmentItem.objects.get(pk=item.pk)
    mark(item, MET, user("quick-marker@example.com"))

    with pytest.raises(ValidationError) as exc_info:
        mark(stale, NOT_MET, user("slow-marker@example.com"))

    assert "reason" in exc_info.value.message_dict
    item.refresh_from_db()
    assert item.result == MET
    assert item.assessor is not None
    assert item.assessor.email == "quick-marker@example.com"


def test_the_audit_trail_records_the_change_but_not_the_reason() -> None:
    item = open_item()
    mark(item, MET, user("audit-first@example.com"))
    reviser = user("audit-reviser@example.com")

    mark(item, NOT_MET, reviser, "A private judgement about a child.")

    event = AuditEvent.objects.filter(
        action=AuditAction.ITEM_RESULT_RECORDED,
        entity_id=str(item.pk),
    ).latest("occurred_at")
    assert event.actor == reviser
    assert event.metadata["before"] == {"result": MET}
    assert event.metadata["after"] == {"result": NOT_MET}
    assert event.metadata["change"] == str(item.changes.latest("sequence").pk)
    assert "private judgement" not in event.summary
    assert "private judgement" not in str(event.metadata)


# --- a completed assessment is corrected, not reopened -------------------------


def test_a_completed_assessment_is_corrected_with_a_reason_and_stays_completed() -> (
    None
):
    item = open_item(completed=True)
    assessment_before = CandidateAssessment.objects.get(pk=item.assessment_id)
    completed_at = assessment_before.completed_at

    changed = mark(item, NOT_MET, user("corrector@example.com"), "Spotted on review.")

    assert changed.result == NOT_MET
    after = CandidateAssessment.objects.get(pk=item.assessment_id)
    assert after.status == CandidateAssessment.Status.COMPLETED
    assert after.completed_at == completed_at
    candidate_row = GradingCandidate.objects.get(pk=after.candidate_id)
    assert candidate_row.status == GradingCandidate.Status.COMPLETED


def test_a_completed_assessment_still_needs_a_reason_for_every_change() -> None:
    item = open_item(completed=True)

    with pytest.raises(ValidationError):
        mark(item, NOT_MET, user("no-reason-completed@example.com"))

    item.refresh_from_db()
    assert item.result == MET


def test_a_completed_assessment_cannot_have_a_required_item_cleared() -> None:
    item = open_item(completed=True)

    with pytest.raises(ValidationError) as exc_info:
        mark(item, NOT_ASSESSED, user("clear-required@example.com"), "Wrong item.")

    assert "required item marked" in str(exc_info.value)
    item.refresh_from_db()
    assert item.result == MET


def test_an_optional_item_of_a_completed_assessment_can_be_cleared_with_a_reason() -> (
    None
):
    item = open_item(completed=True)
    CandidateAssessmentItem.objects.filter(pk=item.pk).update(required=False)
    item.refresh_from_db()

    cleared = mark(
        item, NOT_ASSESSED, user("clear-optional@example.com"), "Not examined."
    )

    assert cleared.result == NOT_ASSESSED


def test_nothing_changes_once_the_session_is_locked_or_for_a_withdrawn_candidate() -> (
    None
):
    locked = open_item(completed=True)
    GradingSession.objects.filter(pk=locked.assessment.candidate.session_id).update(
        status=GradingSession.Status.LOCKED,
    )
    withdrawn = open_item()
    GradingCandidate.objects.filter(pk=withdrawn.assessment.candidate_id).update(
        status=GradingCandidate.Status.WITHDRAWN,
        withdrawal_reason=GradingCandidate.WithdrawalReason.OTHER,
        withdrawal_note="Direct write for the test.",
        withdrawn_by=user("mark-withdrawer@example.com"),
        withdrawn_at=withdrawn.assessment.generated_at,
    )

    with pytest.raises(ValidationError):
        mark(locked, NOT_MET, user("locked-changer@example.com"), "Too late.")
    with pytest.raises(ValidationError):
        mark(withdrawn, MET, user("withdrawn-marker@example.com"))

    assert not locked.changes.exists()
    assert not withdrawn.changes.exists()


# --- the log itself -----------------------------------------------------------


def test_the_change_log_cannot_be_edited_or_deleted() -> None:
    item = open_item()
    mark(item, MET, user("log-first@example.com"))
    mark(item, NOT_MET, user("log-second@example.com"), "Because.")
    entry = item.changes.get(sequence=2)

    entry.reason = "Rewritten."
    with pytest.raises(ValidationError):
        entry.save()
    with pytest.raises(ValidationError):
        entry.delete()
    with pytest.raises(ValidationError):
        AssessmentItemResultChange.objects.filter(pk=entry.pk).update(reason="X")
    with pytest.raises(ValidationError):
        AssessmentItemResultChange.objects.filter(pk=entry.pk).delete()

    assert AssessmentItemResultChange.objects.get(pk=entry.pk).reason == "Because."


def test_the_database_itself_requires_a_reason_after_the_first_entry() -> None:
    item = open_item()
    who = user("db-rules@example.com")

    def entry(sequence: int, reason: str, from_result: str, to_result: str) -> Any:
        return AssessmentItemResultChange(
            item=item,
            sequence=sequence,
            from_result=from_result,
            to_result=to_result,
            changed_by=who,
            reason=reason,
        )

    # No reason is allowed only for the first entry; no move is not a change;
    # an item's sequence numbers cannot repeat.
    AssessmentItemResultChange.objects.bulk_create([entry(1, "", NOT_ASSESSED, MET)])
    for bad in (
        entry(2, "", MET, NOT_MET),
        entry(3, "Reason.", MET, MET),
        entry(1, "Reason.", MET, NOT_MET),
        entry(0, "Reason.", MET, NOT_MET),
    ):
        with pytest.raises(IntegrityError), transaction.atomic():
            AssessmentItemResultChange.objects.bulk_create([bad])


def test_deleting_a_user_keeps_their_name_on_their_mark_changes() -> None:
    item = open_item()
    leaving = user("leaving-marker@example.com")
    mark(item, MET, leaving)
    administrator = user("mark-deleter@example.com", role=User.Role.ADMINISTRATOR)

    delete_platform_user(leaving, administrator)

    [entry] = item.changes.all()
    assert entry.changed_by == leaving
    assert entry.changed_by.get_full_name() == leaving.get_full_name()


# --- the API ------------------------------------------------------------------


def test_the_api_takes_a_reason_and_serves_the_history() -> None:
    item = open_item()
    client = auth_client("api-marker@example.com")
    url = f"/api/gradings/assessment-items/{item.pk}/"

    first = client.patch(url, {"result": "MET"}, format="json")
    refused = client.patch(url, {"result": "NOT_MET"}, format="json")
    changed = client.patch(
        url, {"result": "NOT_MET", "reason": "Second look."}, format="json"
    )
    listed = client.get(
        f"/api/gradings/assessment-items/?assessment={item.assessment_id}"
    )

    assert first.status_code == 200
    assert refused.status_code == 400
    assert refused.json()["error"]["message"] == "Say why the mark is changing."
    assert changed.status_code == 200
    [row] = [r for r in results(listed) if r["id"] == item.pk]
    assert row["result"] == "NOT_MET"
    assert [
        (c["sequence"], c["from_result"], c["to_result"], c["reason"])
        for c in row["changes"]
    ] == [
        (1, "NOT_ASSESSED", "MET", ""),
        (2, "MET", "NOT_MET", "Second look."),
    ]
    assert all(c["changed_by_name"] and c["changed_at"] for c in row["changes"])
    assert "reason" not in row


def test_the_api_refuses_an_over_long_reason_in_plain_words() -> None:
    item = open_item()
    client = auth_client("api-long-reason@example.com")
    url = f"/api/gradings/assessment-items/{item.pk}/"
    client.patch(url, {"result": "MET"}, format="json")

    response = client.patch(
        url, {"result": "NOT_MET", "reason": "x" * 2001}, format="json"
    )

    assert response.status_code == 400
    assert (
        response.json()["error"]["message"]
        == "A reason can be at most 2000 characters."
    )


def test_the_reopen_action_is_gone() -> None:
    item = open_item(completed=True)

    response = auth_client("no-reopen@example.com").post(
        f"/api/gradings/assessments/{item.assessment_id}/reopen/",
    )

    assert response.status_code == 404


# --- marks that existed before the log ----------------------------------------


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_marks_made_before_the_log_become_its_first_entry() -> None:
    generated = start_assessment(
        assessment(
            candidate=candidate(
                session=grading_session(status=GradingSession.Status.OPEN)
            ),
        ),
    )
    marked, unmarked = list(generated.items.all()[:2])
    marker = user("old-marker@example.com")
    old_target = [("gradings", "0019_carry_notes_into_comments")]
    executor = MigrationExecutor(connection)
    final_targets = executor.loader.graph.leaf_nodes()

    try:
        executor.migrate(old_target)
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE gradings_candidateassessmentitem SET result = 'NOT_MET',"
                " assessor_id = %s, assessed_at = '2026-10-01 10:30:00+00'"
                " WHERE id = %s",
                [marker.pk, marked.pk],
            )

        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)

        Change = apps.get_model("gradings", "AssessmentItemResultChange")
        entries = list(Change.objects.all())
        [entry] = [e for e in entries if e.item_id == marked.pk]
        assert (entry.sequence, entry.from_result, entry.to_result) == (
            1,
            "NOT_ASSESSED",
            "NOT_MET",
        )
        assert entry.changed_by_id == marker.pk
        assert entry.reason == ""
        assert entry.changed_at.isoformat().startswith("2026-10-01T10:30:00")
        assert not [e for e in entries if e.item_id == unmarked.pk]
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)
