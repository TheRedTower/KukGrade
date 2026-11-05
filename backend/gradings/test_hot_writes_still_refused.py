"""The hot writes skip the database re-checks, not the database's refusals.

`clean_without_database_checks` (kukgrade/modelchecks.py) leaves foreign keys and
CHECK and UNIQUE constraints to the database. These prove they still do their job:
a row that breaks one is never saved, and what Python judges is still judged.
"""

from __future__ import annotations

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from audit.models import AuditAction, AuditEntity, AuditEvent
from gradings.models import (
    AssessmentItemComment,
    AssessmentItemResultChange,
    CandidateAssessmentItem,
    GradingSession,
)
from gradings.testing import (
    assessment,
    candidate,
    grading_session,
    start_assessment,
    user,
)

pytestmark = pytest.mark.django_db


def one_item() -> CandidateAssessmentItem:
    session = grading_session(status=GradingSession.Status.OPEN)
    generated = assessment(candidate=candidate(session=session))
    start_assessment(generated)
    item = generated.items.order_by("pk").first()
    assert item is not None
    return item


def test_a_marked_item_with_no_assessor_is_refused_and_not_saved() -> None:
    item = one_item()
    item.result = CandidateAssessmentItem.Result.MET

    with pytest.raises((ValidationError, IntegrityError)), transaction.atomic():
        item.save()

    item.refresh_from_db()
    assert item.result == CandidateAssessmentItem.Result.NOT_ASSESSED


def test_an_item_with_a_result_that_is_not_one_is_still_refused_by_python() -> None:
    item = one_item()
    item.result = "MAYBE"

    with pytest.raises(ValidationError):
        item.save()


def test_an_item_position_must_stay_positive() -> None:
    item = one_item()
    item.position = 0

    with pytest.raises(ValidationError):
        item.save()


def test_a_second_change_with_the_same_sequence_is_refused_by_the_database() -> None:
    item = one_item()
    author = user("hot-write-author@example.com")
    AssessmentItemResultChange.objects.create(
        item=item,
        sequence=1,
        from_result="NOT_ASSESSED",
        to_result="MET",
        changed_by=author,
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        AssessmentItemResultChange.objects.create(
            item=item,
            sequence=1,
            from_result="MET",
            to_result="NOT_MET",
            changed_by=author,
            reason="Again.",
        )

    assert AssessmentItemResultChange.objects.filter(item=item).count() == 1


def test_a_later_change_without_a_reason_is_still_refused() -> None:
    item = one_item()

    with pytest.raises(ValidationError):
        AssessmentItemResultChange.objects.create(
            item=item,
            sequence=2,
            from_result="MET",
            to_result="NOT_MET",
            changed_by=user("hot-write-reasonless@example.com"),
        )


def test_an_empty_comment_is_still_refused() -> None:
    item = one_item()

    with pytest.raises(ValidationError):
        AssessmentItemComment.objects.create(
            item=item,
            author=user("hot-write-commenter@example.com"),
            body="   ",
        )


def test_an_audit_event_with_no_summary_is_refused_by_the_database() -> None:
    with pytest.raises((ValidationError, IntegrityError)), transaction.atomic():
        AuditEvent.objects.create(
            action=AuditAction.SESSION_CREATED,
            entity_type=AuditEntity.GRADING_SESSION,
            entity_id="1",
            summary="",
        )

    assert not AuditEvent.objects.exists()


def test_an_audit_event_with_an_unknown_action_is_still_refused_by_python() -> None:
    with pytest.raises(ValidationError):
        AuditEvent.objects.create(
            action="MADE_UP",
            entity_type=AuditEntity.GRADING_SESSION,
            entity_id="1",
            summary="Nothing.",
        )
