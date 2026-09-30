"""Integrity the database guarantees, and the migrations that establish it."""

from __future__ import annotations

from typing import Any

import pytest
from django.apps import apps
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
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
from gradings.outcome_services import create_candidate_outcome
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


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_grading_migrations_apply_from_zero_and_constraints_exist() -> None:
    assert connection.vendor == "postgresql"
    executor = MigrationExecutor(connection)
    final_targets = executor.loader.graph.leaf_nodes()

    try:
        executor.migrate([("gradings", None)])
        executor = MigrationExecutor(connection)
        executor.migrate([("gradings", "0004_promotion")])
        state_apps = executor.loader.project_state(
            [("gradings", "0004_promotion")],
        ).apps
        HistoricalSession = state_apps.get_model("gradings", "GradingSession")
        HistoricalCandidate = state_apps.get_model("gradings", "GradingCandidate")
        HistoricalAssessment = state_apps.get_model("gradings", "CandidateAssessment")
        HistoricalItem = state_apps.get_model("gradings", "CandidateAssessmentItem")
        HistoricalOutcome = state_apps.get_model("gradings", "CandidateOutcome")
        HistoricalPromotion = state_apps.get_model("gradings", "Promotion")

        session_constraints = {
            constraint.name for constraint in HistoricalSession._meta.constraints
        }
        candidate_constraints = {
            constraint.name for constraint in HistoricalCandidate._meta.constraints
        }
        assessment_constraints = {
            constraint.name for constraint in HistoricalAssessment._meta.constraints
        }
        item_constraints = {
            constraint.name for constraint in HistoricalItem._meta.constraints
        }
        outcome_constraints = {
            constraint.name for constraint in HistoricalOutcome._meta.constraints
        }
        promotion_constraints = {
            constraint.name for constraint in HistoricalPromotion._meta.constraints
        }

        assert "grading_session_title_not_blank" in session_constraints
        assert "grading_session_status_valid" in session_constraints
        assert {index.name for index in HistoricalSession._meta.indexes} == {
            "grad_session_status_date_idx",
            "grad_session_date_idx",
        }
        assert "unique_grading_candidate_session_student" in candidate_constraints
        assert "grading_candidate_age_band_valid" in candidate_constraints
        assert "grading_candidate_status_valid" in candidate_constraints
        assert "candidate_assessment_status_valid" in assessment_constraints
        assert "candidate_assessment_timestamps_valid" in assessment_constraints
        assert "candidate_item_age_band_valid" in item_constraints
        assert "candidate_item_category_valid" in item_constraints
        assert "candidate_item_result_valid" in item_constraints
        assert "candidate_item_sequence_positive" in item_constraints
        assert "candidate_item_range_complete" in item_constraints
        assert "unique_assessment_source_requirement" in item_constraints
        assert "unique_assessment_item_snapshot" in item_constraints
        assert "candidate_outcome_status_valid" in outcome_constraints
        assert "candidate_outcome_proposed_valid" in outcome_constraints
        assert "candidate_outcome_final_valid" in outcome_constraints
        assert "candidate_outcome_status_fields_valid" in outcome_constraints
        assert "candidate_outcome_conditions_valid" in outcome_constraints
        assert {index.name for index in HistoricalOutcome._meta.indexes} == {
            "cand_outcome_status_idx",
            "cand_outcome_proposed_idx",
            "cand_outcome_final_idx",
            "cand_outcome_decided_idx",
        }
        assert "promotion_from_to_rank_distinct" in promotion_constraints
        assert {index.name for index in HistoricalPromotion._meta.indexes} == {
            "promotion_student_history_idx",
            "promotion_effective_idx",
            "promotion_promoted_idx",
        }
        assert (
            "can_make_final_grading_decision",
            "Can make final grading decision",
        ) in HistoricalOutcome._meta.permissions
        assert (
            "can_promote_student",
            "Can promote student",
        ) in HistoricalPromotion._meta.permissions
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_registered_in_error_withdrawals_become_other_and_roll_back() -> None:
    withdrawn = candidate(status=GradingCandidate.Status.WITHDRAWN)
    old_target = [("gradings", "0009_candidate_from_rank_and_delete_any_permission")]
    executor = MigrationExecutor(connection)
    final_targets = executor.loader.graph.leaf_nodes()

    def stored() -> tuple[str, str]:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT withdrawal_reason, withdrawal_note"
                " FROM gradings_gradingcandidate WHERE id = %s",
                [withdrawn.pk],
            )
            row = cursor.fetchone()
        assert row is not None
        return (row[0], row[1])

    try:
        executor.migrate(old_target)
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE gradings_gradingcandidate"
                " SET withdrawal_reason = 'ADMIN_ERROR',"
                " withdrawal_note = 'Wrong student'"
                " WHERE id = %s",
                [withdrawn.pk],
            )

        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)
        assert stored() == ("OTHER", "Registered in error. Wrong student")

        executor = MigrationExecutor(connection)
        executor.migrate(old_target)
        assert stored() == ("ADMIN_ERROR", "Registered in error. Wrong student")
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_existing_assessment_items_keep_the_order_they_were_listed_in() -> None:
    generated = assessment()
    old_target = [("gradings", "0010_withdrawal_reason_other")]
    executor = MigrationExecutor(connection)
    final_targets = executor.loader.graph.leaf_nodes()

    def query(columns: str, order_by: str) -> list[tuple[Any, ...]]:
        with connection.cursor() as cursor:
            cursor.execute(
                f"SELECT {columns} FROM gradings_candidateassessmentitem"
                f" WHERE assessment_id = %s ORDER BY {order_by}",
                [generated.pk],
            )
            return list(cursor.fetchall())

    untouched = "id, item_code, requirement_sequence, result, updated_at"

    try:
        executor.migrate(old_target)
        # Before positions existed, items were listed by copied sequence, then
        # name, then id. Equal sequences leave the name to decide.
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE gradings_candidateassessmentitem"
                " SET requirement_sequence = 1 WHERE assessment_id = %s",
                [generated.pk],
            )
        listed = query("id", "requirement_sequence, item_name, id")
        before = query(untouched, "id")

        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)

        assert query("id", "position") == listed
        assert [row[0] for row in query("position", "position")] == list(
            range(1, len(listed) + 1),
        )
        assert query(untouched, "id") == before
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)


def test_all_new_tests_use_postgresql_backend() -> None:
    assert connection.vendor == "postgresql"
    assert apps.is_installed("gradings")


def test_outcome_cannot_be_attached_to_another_candidates_assessment() -> None:
    built, _generated = locked_completed_candidate()
    outcome = create_candidate_outcome(
        built,
        user("outcome-reattach-creator@example.com"),
    )
    _other_built, other_generated = locked_completed_candidate()

    # QuerySet.update() bypasses model validation entirely; before the
    # composite foreign key this silently succeeded. Not finalised, so this
    # reaches the constraint rather than the separate immutable-outcome
    # guard on QuerySet.update() (KG-044).
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
