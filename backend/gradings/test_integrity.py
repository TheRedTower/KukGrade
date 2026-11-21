"""Integrity the database guarantees, and the migrations that establish it."""

from __future__ import annotations

import pytest
from django.apps import apps
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.db.models.deletion import ProtectedError
from django.utils import timezone

from gradings.assessment_services import update_candidate_assessment_item
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
)
from gradings.outcome_services import propose_for_candidate
from gradings.testing import (
    assessment,
    candidate,
    grading_session,
    locked_completed_candidate,
    start_assessment,
    user,
)
from syllabus.models import AgeBand, SyllabusItem

pytestmark = pytest.mark.django_db


def test_assessment_database_constraints_are_enforced() -> None:
    generated = assessment()

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateAssessment.objects.bulk_create(
            [
                CandidateAssessment(
                    candidate=candidate(),
                    generated_by=user("invalid-assessment-status@example.com"),
                    status="INVALID",
                ),
            ],
        )

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateAssessmentItem.objects.bulk_create(
            [
                CandidateAssessmentItem(
                    assessment=generated,
                    source_age_band="INVALID",
                    item_code="BAD_AGE",
                    item_name="Bad Age",
                    category=SyllabusItem.Category.OTHER,
                    requirement_sequence=1,
                    position=1000,
                ),
            ],
        )

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateAssessmentItem.objects.bulk_create(
            [
                CandidateAssessmentItem(
                    assessment=generated,
                    source_age_band=AgeBand.AGE_9_TO_12,
                    item_code="BAD_RANGE",
                    item_name="Bad Range",
                    category=SyllabusItem.Category.OTHER,
                    requirement_sequence=1,
                    position=1000,
                    start_number=5,
                    end_number=1,
                ),
            ],
        )

    # An item's place is its own: never zero, never shared within one
    # assessment.
    first = generated.items.get(position=1)
    for position in (0, 2):
        with pytest.raises(IntegrityError), transaction.atomic():
            CandidateAssessmentItem.objects.filter(pk=first.pk).update(
                position=position,
            )
    first.position = 0
    with pytest.raises(ValidationError) as exc_info:
        first.full_clean()
    assert exc_info.value.message_dict["position"] == ["Position must be positive."]


def test_all_new_tests_use_postgresql_backend() -> None:
    assert connection.vendor == "postgresql"
    assert apps.is_installed("gradings")


def test_outcome_cannot_be_attached_to_another_candidates_assessment() -> None:
    built, _generated = locked_completed_candidate()
    outcome = propose_for_candidate(
        built,
        "PASS",
        "",
        user("outcome-reattach-creator@example.com"),
    )
    _other_built, other_generated = locked_completed_candidate()

    # QuerySet.update() bypasses model validation entirely; before the
    # composite foreign key this silently succeeded. Not finalised, so this
    # reaches the constraint rather than the separate immutable-outcome
    # guard on QuerySet.update().
    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.filter(pk=outcome.pk).update(
            assessment=other_generated,
        )


def test_assessed_item_cannot_lose_its_assessor() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    item = generated.items.first()
    assert item is not None
    update_candidate_assessment_item(
        item,
        result=CandidateAssessmentItem.Result.MET,
        assessor=user("keeps-attribution@example.com"),
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateAssessmentItem.objects.filter(pk=item.pk).update(
            assessor=None,
            assessed_at=None,
        )


def test_unassessed_item_cannot_claim_an_assessor() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    item = generated.items.first()
    assert item is not None

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateAssessmentItem.objects.filter(pk=item.pk).update(
            assessor=user("phantom-assessor@example.com"),
            assessed_at=timezone.now(),
        )


def test_deleting_an_assessor_is_blocked_rather_than_erasing_attribution() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    item = generated.items.first()
    assert item is not None
    judge = user("protected-assessor@example.com")
    update_candidate_assessment_item(
        item,
        result=CandidateAssessmentItem.Result.MET,
        assessor=judge,
    )

    # Previously SET_NULL, which would have erased who judged the item and
    # violated the attribution constraint. Now consistent with generated_by,
    # proposed_by, decided_by and promoted_by.
    with pytest.raises(ProtectedError):
        judge.delete()


def test_a_withdrawal_without_attribution_is_refused_by_the_database() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))

    with pytest.raises(IntegrityError), transaction.atomic():
        GradingCandidate.objects.filter(pk=built.pk).update(
            status=GradingCandidate.Status.WITHDRAWN,
        )
