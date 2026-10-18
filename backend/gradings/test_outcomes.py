"""Candidate outcomes: proposal, finalisation and the outcome API."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, cast

import pytest
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.forms import ModelForm
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from gradings.admin import (
    CandidateOutcomeAdmin,
)
from gradings.models import (
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
)
from gradings.outcome_services import (
    create_candidate_outcome,
    finalise_candidate_outcome,
    propose_candidate_outcome,
)
from gradings.read_models import candidate_assessment_summary
from gradings.services import (
    transition_grading_session,
    validate_candidate_can_be_deleted,
)
from gradings.testing import (
    admin_request,
    assessment,
    candidate,
    complete_assessment,
    finalised_outcome,
    grading_session,
    locked_completed_candidate,
    master,
    start_assessment,
    user,
)
from kukgrade.testing import results
from syllabus.models import SyllabusItem, SyllabusRequirement

pytestmark = pytest.mark.django_db


def test_valid_draft_candidate_outcome_can_be_created() -> None:
    built, generated = locked_completed_candidate()

    outcome = create_candidate_outcome(built, user("outcome-creator@example.com"))

    assert outcome.candidate == built
    assert outcome.assessment == generated
    assert outcome.status == CandidateOutcome.Status.DRAFT
    assert outcome.proposed_outcome is None
    assert outcome.final_outcome is None


def test_candidate_outcome_database_constraints_are_enforced() -> None:
    built, generated = locked_completed_candidate()
    creator = user("outcome-db-creator@example.com")
    outcome = create_candidate_outcome(built, creator)

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [CandidateOutcome(candidate=built, assessment=generated)],
        )

    other_built, other_generated = locked_completed_candidate()
    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [CandidateOutcome(candidate=other_built, assessment=generated)],
        )
    assert other_generated.pk is not None

    # One consistent pair, so this exercises the status check constraint
    # rather than tripping the composite foreign key on a mismatched pair.
    status_built, status_generated = locked_completed_candidate()
    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [
                CandidateOutcome(
                    candidate=status_built,
                    assessment=status_generated,
                    status="INVALID",
                ),
            ],
        )

    proposer = user("outcome-db-proposer@example.com")
    now = timezone.now()
    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [
                CandidateOutcome(
                    candidate=locked_completed_candidate()[0],
                    assessment=locked_completed_candidate()[1],
                    status=CandidateOutcome.Status.PROPOSED,
                    proposed_outcome="INVALID",
                    proposed_by=proposer,
                    proposed_at=now,
                ),
            ],
        )

    decision_maker = master("outcome-db-master@example.com")
    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [
                CandidateOutcome(
                    candidate=locked_completed_candidate()[0],
                    assessment=locked_completed_candidate()[1],
                    status=CandidateOutcome.Status.FINALISED,
                    proposed_outcome=CandidateOutcome.Outcome.PASS,
                    proposed_by=proposer,
                    proposed_at=now,
                    final_outcome="INVALID",
                    decided_by=decision_maker,
                    decided_at=now,
                ),
            ],
        )

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [
                CandidateOutcome(
                    candidate=locked_completed_candidate()[0],
                    assessment=locked_completed_candidate()[1],
                    status=CandidateOutcome.Status.FINALISED,
                    proposed_outcome=CandidateOutcome.Outcome.CONDITIONAL,
                    proposed_by=proposer,
                    proposed_at=now,
                    final_outcome=CandidateOutcome.Outcome.CONDITIONAL,
                    decided_by=decision_maker,
                    decided_at=now,
                    conditional_requirements="",
                ),
            ],
        )

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [
                CandidateOutcome(
                    candidate=locked_completed_candidate()[0],
                    assessment=locked_completed_candidate()[1],
                    status=CandidateOutcome.Status.FINALISED,
                    proposed_outcome=CandidateOutcome.Outcome.PASS,
                    proposed_by=proposer,
                    proposed_at=now,
                    final_outcome=CandidateOutcome.Outcome.PASS,
                    decided_by=decision_maker,
                    decided_at=now,
                    conditional_requirements="stale text",
                ),
            ],
        )

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [
                CandidateOutcome(
                    candidate=locked_completed_candidate()[0],
                    assessment=locked_completed_candidate()[1],
                    status=CandidateOutcome.Status.PROPOSED,
                    proposed_outcome=CandidateOutcome.Outcome.PASS,
                    proposed_by=proposer,
                    proposed_at=None,
                ),
            ],
        )

    assert CandidateOutcome.objects.filter(pk=outcome.pk).exists()


def test_candidate_assessment_mismatch_rejected_by_model_validation() -> None:
    built, _generated = locked_completed_candidate()
    _other_built, other_generated = locked_completed_candidate()
    outcome = CandidateOutcome(candidate=built, assessment=other_generated)

    with pytest.raises(ValidationError) as exc_info:
        outcome.full_clean()

    assert "assessment" in exc_info.value.message_dict


def test_outcome_creation_rules_and_duplicate_protection() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    with pytest.raises(ValidationError):
        create_candidate_outcome(built, user("outcome-no-assessment@example.com"))

    generated = assessment(candidate=built)
    start_assessment(generated)
    with pytest.raises(ValidationError):
        create_candidate_outcome(built, user("outcome-incomplete@example.com"))

    complete_assessment(generated)
    with pytest.raises(ValidationError):
        create_candidate_outcome(built, user("outcome-open@example.com"))

    transition_grading_session(built.session, GradingSession.Status.LOCKED)
    outcome = create_candidate_outcome(built, user("outcome-valid@example.com"))
    assert outcome.pk is not None
    with pytest.raises(ValidationError):
        create_candidate_outcome(built, user("outcome-duplicate@example.com"))

    completed_built, _completed_assessment = locked_completed_candidate()
    GradingSession.objects.filter(pk=completed_built.session_id).update(
        status=GradingSession.Status.COMPLETED,
    )
    with pytest.raises(ValidationError):
        create_candidate_outcome(
            completed_built,
            user("outcome-completed-session@example.com"),
        )

    cancelled_built, _cancelled_assessment = locked_completed_candidate()
    GradingSession.objects.filter(pk=cancelled_built.session_id).update(
        status=GradingSession.Status.CANCELLED,
    )
    with pytest.raises(ValidationError):
        create_candidate_outcome(
            cancelled_built,
            user("outcome-cancelled-session@example.com"),
        )


def test_proposal_workflow_allows_revision_and_blocks_finalised_reproposal() -> None:
    built, _generated = locked_completed_candidate()
    outcome = create_candidate_outcome(built, user("proposal-creator@example.com"))
    proposer = user("proposal-actor@example.com")

    proposed = propose_candidate_outcome(
        outcome,
        CandidateOutcome.Outcome.PASS,
        "Initial proposal",
        proposer,
    )
    first_timestamp = proposed.proposed_at
    revised = propose_candidate_outcome(
        proposed,
        CandidateOutcome.Outcome.FAIL,
        "Revised proposal",
        user("proposal-reviser@example.com"),
    )

    assert revised.status == CandidateOutcome.Status.PROPOSED
    assert revised.proposed_outcome == CandidateOutcome.Outcome.FAIL
    assert revised.proposal_notes == "Revised proposal"
    assert revised.proposed_at is not None
    assert first_timestamp is not None and revised.proposed_at >= first_timestamp
    assert revised.final_outcome is None

    with pytest.raises(ValidationError):
        propose_candidate_outcome(
            revised,
            "INVALID",
            "",
            user("proposal-invalid@example.com"),
        )

    finalised = finalise_candidate_outcome(
        revised,
        CandidateOutcome.Outcome.PASS,
        "Override accepted.",
        "",
        master("proposal-master@example.com"),
    )
    with pytest.raises(ValidationError):
        propose_candidate_outcome(
            finalised,
            CandidateOutcome.Outcome.PASS,
            "Too late",
            user("proposal-too-late@example.com"),
        )


def test_finalisation_rules_permissions_and_conditional_policy() -> None:
    built, _generated = locked_completed_candidate()
    draft = create_candidate_outcome(built, user("finalise-draft-creator@example.com"))
    with pytest.raises(ValidationError):
        finalise_candidate_outcome(
            draft,
            CandidateOutcome.Outcome.PASS,
            "",
            "",
            master("finalise-draft-master@example.com"),
        )

    proposed = propose_candidate_outcome(
        draft,
        CandidateOutcome.Outcome.PASS,
        "",
        user("finalise-proposer@example.com"),
    )
    with pytest.raises(ValidationError):
        finalise_candidate_outcome(
            proposed,
            CandidateOutcome.Outcome.PASS,
            "",
            "",
            user("finalise-not-master@example.com"),
        )
    with pytest.raises(ValidationError):
        finalise_candidate_outcome(
            proposed,
            CandidateOutcome.Outcome.PASS,
            "",
            "",
            user(
                "finalise-legacy-boolean@example.com",
            ),
        )
    with pytest.raises(ValidationError):
        finalise_candidate_outcome(
            proposed,
            CandidateOutcome.Outcome.CONDITIONAL,
            "",
            "   ",
            master("finalise-blank-conditional@example.com"),
        )
    with pytest.raises(ValidationError):
        finalise_candidate_outcome(
            proposed,
            CandidateOutcome.Outcome.PASS,
            "",
            "stale condition",
            master("finalise-stale-pass@example.com"),
        )

    finalised = finalise_candidate_outcome(
        proposed,
        CandidateOutcome.Outcome.CONDITIONAL,
        "",
        "Attend one focused basics review.",
        master("finalise-conditional-master@example.com"),
    )

    assert finalised.status == CandidateOutcome.Status.FINALISED
    assert finalised.final_outcome == CandidateOutcome.Outcome.CONDITIONAL
    assert finalised.decided_by is not None
    assert finalised.decided_at is not None
    assert finalised.conditional_requirements == "Attend one focused basics review."

    with pytest.raises(ValidationError):
        finalise_candidate_outcome(
            finalised,
            CandidateOutcome.Outcome.PASS,
            "",
            "",
            master("finalise-repeat-master@example.com"),
        )


def test_superuser_can_finalise_through_django_permission_conventions() -> None:
    built, _generated = locked_completed_candidate()
    outcome = create_candidate_outcome(
        built,
        user("finalise-superuser-creator@example.com"),
    )
    proposed = propose_candidate_outcome(
        outcome,
        CandidateOutcome.Outcome.PASS,
        "",
        user("finalise-superuser-proposer@example.com"),
    )
    decision_maker = User.objects.create_superuser(
        email="finalise-superuser@example.com",
    )

    finalised = finalise_candidate_outcome(
        proposed,
        CandidateOutcome.Outcome.PASS,
        "",
        "",
        decision_maker,
    )

    assert finalised.decided_by == decision_maker
    assert finalised.status == CandidateOutcome.Status.FINALISED


def test_finalisation_only_allowed_while_session_locked() -> None:
    built, _generated = locked_completed_candidate()
    outcome = create_candidate_outcome(
        built,
        user("finalise-session-creator@example.com"),
    )
    proposed = propose_candidate_outcome(
        outcome,
        CandidateOutcome.Outcome.PASS,
        "",
        user("finalise-session-proposer@example.com"),
    )
    GradingSession.objects.filter(pk=built.session_id).update(
        status=GradingSession.Status.COMPLETED,
    )

    with pytest.raises(ValidationError):
        finalise_candidate_outcome(
            proposed,
            CandidateOutcome.Outcome.PASS,
            "",
            "",
            master("finalise-session-master@example.com"),
        )


def test_finalised_outcome_is_immutable_and_protects_deletion() -> None:
    built, generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    original_rank = built.student.current_rank

    outcome.decision_notes = "Changed after finalisation"
    with pytest.raises(ValidationError):
        outcome.save()
    with pytest.raises(ValidationError):
        outcome.delete()
    with pytest.raises(ValidationError):
        CandidateOutcome.objects.filter(pk=outcome.pk).update(
            decision_notes="Bulk-changed",
        )
    outcome.refresh_from_db()
    assert outcome.decision_notes != "Bulk-changed"
    with pytest.raises(ProtectedError):
        generated.delete()
    with pytest.raises(ValidationError):
        validate_candidate_can_be_deleted(built)
    built.status = GradingCandidate.Status.WITHDRAWN
    with pytest.raises(ValidationError):
        built.save()

    built.student.refresh_from_db()
    assert built.student.current_rank == original_rank


@pytest.mark.parametrize("final", ["FAIL", "CONDITIONAL"])
def test_a_bulk_delete_cannot_erase_a_finalised_decision(final: str) -> None:
    # A Fail or Conditional has no promotion to protect it, so the queryset
    # guard is all that stops `objects.filter(...).delete()` from the shell.
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(
        built,
        proposed=final,
        final=final,
        conditional_requirements="Re-test forms." if final == "CONDITIONAL" else "",
    )

    with pytest.raises(ValidationError):
        CandidateOutcome.objects.filter(pk=outcome.pk).delete()

    assert CandidateOutcome.objects.filter(pk=outcome.pk).exists()


def test_a_bulk_delete_still_removes_undecided_outcomes() -> None:
    built, _generated = locked_completed_candidate()
    draft = create_candidate_outcome(built, user("bulk-draft@example.com"))

    deleted, _ = CandidateOutcome.objects.filter(pk=draft.pk).delete()

    assert deleted == 1


def test_direct_outcome_status_spoofing_rejected() -> None:
    built, _generated = locked_completed_candidate()
    outcome = create_candidate_outcome(built, user("status-spoof-creator@example.com"))
    outcome.status = CandidateOutcome.Status.FINALISED
    outcome.proposed_outcome = CandidateOutcome.Outcome.PASS
    outcome.proposed_by = user("status-spoof-proposer@example.com")
    outcome.proposed_at = timezone.now()
    outcome.final_outcome = CandidateOutcome.Outcome.PASS
    outcome.decided_by = master("status-spoof-master@example.com")
    outcome.decided_at = timezone.now()

    with pytest.raises(ValidationError) as exc_info:
        outcome.save()

    assert "workflow services" in str(exc_info.value)


def test_candidate_assessment_summary_uses_snapshot_categories_and_counts() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    optional_item = SyllabusItem.objects.create(
        code="SUMMARY_OPTIONAL",
        name="Summary Optional",
        category=SyllabusItem.Category.WEAPONS,
    )
    optional_requirement = SyllabusRequirement.objects.create(
        rank=built.testing_for_rank,
        item=optional_item,
        age_band=built.age_band,
        required=False,
        sequence=999,
    )
    generated = assessment(candidate=built)
    start_assessment(generated)
    required_items = list(generated.items.filter(required=True).order_by("pk"))
    required_items[0].result = CandidateAssessmentItem.Result.NOT_MET
    required_items[0].assessor = user(f"not-met-assessor-{generated.pk}@example.com")
    required_items[0].assessed_at = timezone.now()
    required_items[0].save()
    generated.items.filter(required=True).exclude(pk=required_items[0].pk).update(
        result=CandidateAssessmentItem.Result.MET,
        assessor=user(f"summary-assessor-{generated.pk}@example.com"),
        assessed_at=timezone.now(),
    )
    optional_snapshot = generated.items.get(source_requirement=optional_requirement)
    source_item = optional_snapshot.source_item
    assert source_item is not None
    original_category = optional_snapshot.category
    source_item.category = SyllabusItem.Category.OTHER
    source_item.save()

    summary = candidate_assessment_summary(generated)

    assert "final_outcome" not in summary
    assert summary["overall"]["total"] == generated.items.count()
    assert (
        summary["overall"]["required"]
        == generated.items.filter(
            required=True,
        ).count()
    )
    assert summary["overall"]["not_met"] == 1
    assert summary["overall"]["not_assessed"] == 1
    assert summary["overall"]["required_not_assessed"] == 0
    # Regression coverage for the missing overall["required_met"] bug: it
    # was tracked per-category but never rolled up to the overall summary,
    # which the Cohort Adjudication Board reads directly to show "X of Y
    # met" - silently NaN before this fix.
    assert (
        summary["overall"]["required_met"]
        == generated.items.filter(
            required=True,
            result=CandidateAssessmentItem.Result.MET,
        ).count()
    )
    assert summary["overall"]["all_required_assessed"] is True
    categories = summary["categories"]
    assert [category["category"] for category in categories] == sorted(
        [category["category"] for category in categories],
        key=lambda value: {
            choice: index
            for index, (choice, _label) in enumerate(SyllabusItem.Category.choices)
        }[value],
    )
    weapons_summary = next(
        category for category in categories if category["category"] == original_category
    )
    assert weapons_summary["total"] == 1
    assert weapons_summary["required"] == 0
    assert weapons_summary["not_assessed"] == 1


def test_session_completion_requires_finalised_outcomes_for_active_candidates() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    first = candidate(session=session)
    second = candidate(session=session)
    withdrawn = candidate(session=session, status=GradingCandidate.Status.WITHDRAWN)
    first_assessment = assessment(candidate=first)
    second_assessment = assessment(candidate=second)
    start_assessment(first_assessment)
    start_assessment(second_assessment)
    complete_assessment(first_assessment)
    complete_assessment(second_assessment)
    transition_grading_session(session, GradingSession.Status.LOCKED)
    first_outcome = create_candidate_outcome(
        first,
        user("session-outcome-first@example.com"),
    )

    with pytest.raises(ValidationError):
        transition_grading_session(session, GradingSession.Status.COMPLETED)

    proposed_first = propose_candidate_outcome(
        first_outcome,
        CandidateOutcome.Outcome.PASS,
        "",
        user("session-outcome-first-proposer@example.com"),
    )
    with pytest.raises(ValidationError):
        transition_grading_session(session, GradingSession.Status.COMPLETED)

    finalise_candidate_outcome(
        proposed_first,
        CandidateOutcome.Outcome.PASS,
        "",
        "",
        master("session-outcome-first-master@example.com"),
    )
    finalised_outcome(
        second,
        proposed=CandidateOutcome.Outcome.FAIL,
        final=CandidateOutcome.Outcome.CONDITIONAL,
        conditional_requirements="Retest forms before promotion is considered.",
    )
    completed = transition_grading_session(session, GradingSession.Status.COMPLETED)

    assert completed.status == GradingSession.Status.COMPLETED
    assert not hasattr(withdrawn, "outcome")


def test_candidate_outcome_api_workflow_and_filters() -> None:
    built, _generated = locked_completed_candidate()
    actor = user("outcome-api-actor@example.com")
    master_user = master("outcome-api-master@example.com")
    client = APIClient()
    client.force_authenticate(user=actor)

    unauthenticated = APIClient().post(
        f"/api/gradings/candidates/{built.id}/create-outcome/",
    )
    create_response = client.post(
        f"/api/gradings/candidates/{built.id}/create-outcome/",
    )
    arbitrary_post = client.post("/api/gradings/outcomes/", {}, format="json")

    assert unauthenticated.status_code == 403
    assert create_response.status_code == 201
    assert arbitrary_post.status_code == 405
    payload = create_response.json()
    outcome_id = payload["id"]
    assert payload["candidate"] == built.id

    direct_patch = client.patch(
        f"/api/gradings/outcomes/{outcome_id}/",
        {"status": CandidateOutcome.Status.FINALISED},
        format="json",
    )
    propose_response = client.patch(
        f"/api/gradings/outcomes/{outcome_id}/propose/",
        {
            "proposed_outcome": CandidateOutcome.Outcome.FAIL,
            "proposal_notes": "Evidence indicates a fail.",
            "proposed_by": master_user.id,
            "proposed_at": "2030-01-01T00:00:00Z",
        },
        format="json",
    )
    forbidden_finalise = client.patch(
        f"/api/gradings/outcomes/{outcome_id}/finalise/",
        {"final_outcome": CandidateOutcome.Outcome.PASS},
        format="json",
    )
    client.force_authenticate(user=master_user)
    finalise_response = client.patch(
        f"/api/gradings/outcomes/{outcome_id}/finalise/",
        {
            "final_outcome": CandidateOutcome.Outcome.PASS,
            "decision_notes": "Master override.",
            "decided_by": actor.id,
            "decided_at": "2030-01-01T00:00:00Z",
            "conditional_requirements": "",
        },
        format="json",
    )
    list_response = client.get(
        f"/api/gradings/outcomes/?session={built.session_id}",
    )
    by_candidate = client.get(f"/api/gradings/outcomes/?candidate={built.id}")
    by_other_candidate = client.get(
        f"/api/gradings/outcomes/?candidate={built.id + 1000}"
    )
    delete_response = client.delete(f"/api/gradings/outcomes/{outcome_id}/")
    finalised_patch = client.patch(
        f"/api/gradings/outcomes/{outcome_id}/",
        {"decision_notes": "Changed"},
        format="json",
    )

    # No detail route: an outcome is written only through propose/finalise.
    assert direct_patch.status_code == 404
    assert propose_response.status_code == 200
    assert propose_response.json()["proposed_by_name"] == actor.get_full_name()
    assert forbidden_finalise.status_code == 403
    assert finalise_response.status_code == 200
    assert finalise_response.json()["decided_by_name"] == master_user.get_full_name()
    assert finalise_response.json()["final_outcome"] == CandidateOutcome.Outcome.PASS
    assert [item["id"] for item in results(list_response)] == [outcome_id]
    assert [item["id"] for item in results(by_candidate)] == [outcome_id]
    assert results(by_other_candidate) == []
    assert delete_response.status_code == 404
    assert finalised_patch.status_code == 404


def test_candidate_outcome_admin_is_read_only_and_has_no_bulk_finalisation() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    model_admin = CandidateOutcomeAdmin(CandidateOutcome, admin.site)
    request = admin_request("outcome-admin@example.com")
    outcome.decision_notes = "Unsafe admin edit"
    form = cast("ModelForm[Any]", SimpleNamespace(changed_data=["decision_notes"]))

    assert model_admin.has_add_permission(request) is False
    assert model_admin.has_delete_permission(request, outcome) is False
    assert model_admin.actions == ()
    with pytest.raises(ValidationError):
        model_admin.save_model(request, outcome, form, True)
