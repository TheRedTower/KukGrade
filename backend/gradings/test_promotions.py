"""Promotions and rank history: rules, immutability, API and bulk promotion."""

from __future__ import annotations

import importlib
from datetime import date
from types import SimpleNamespace
from typing import Any, cast

import pytest
from django.apps import apps
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.forms import ModelForm
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from gradings.admin import (
    PromotionAdmin,
)
from gradings.models import (
    CandidateAssessment,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    Promotion,
)
from gradings.outcome_services import (
    create_candidate_outcome,
    finalise_candidate_outcome,
    promote_candidate,
    promotion_eligibility_for_session,
    propose_candidate_outcome,
)
from gradings.read_models import student_rank_timeline
from gradings.services import transition_grading_session
from gradings.testing import (
    admin_request,
    assessment,
    auth_client,
    candidate,
    complete_assessment,
    finalised_outcome,
    grading_session,
    locked_completed_candidate,
    master,
    promoter,
    rank,
    start_assessment,
    student,
    user,
)
from kukgrade.testing import results
from ranks.models import Rank
from students.models import Student

pytestmark = pytest.mark.django_db


def test_valid_promotion_updates_student_rank_and_records_history() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    actor = promoter("promotion-valid@example.com")
    student_before = Student.objects.values().get(pk=built.student_id)

    promotion = promote_candidate(outcome, actor, notes="Promoted at grading.")

    built.student.refresh_from_db()
    student_after = Student.objects.values().get(pk=built.student_id)

    assert promotion.student == built.student
    assert promotion.outcome == outcome
    assert promotion.grading_candidate == built
    assert promotion.from_rank.code == "WHITE"
    assert promotion.to_rank.code == "YELLOW_STRIPE"
    assert promotion.promoted_by == actor
    assert promotion.promoted_at is not None
    assert promotion.effective_date == built.session.grading_date
    assert promotion.notes == "Promoted at grading."
    assert built.student.current_rank == promotion.to_rank
    assert student_after["current_rank_id"] != student_before["current_rank_id"]
    assert student_after["wksa_id"] == student_before["wksa_id"]
    assert student_after["first_name"] == student_before["first_name"]
    assert student_after["last_name"] == student_before["last_name"]
    assert student_after["date_of_birth"] == student_before["date_of_birth"]
    assert student_after["status"] == student_before["status"]
    assert student_after["created_at"] == student_before["created_at"]
    assert student_after["updated_at"] == student_before["updated_at"]
    assert str(promotion) == (
        f"{built.student} promoted from {promotion.from_rank} to {promotion.to_rank}"
    )


def test_ledger_eligibility_uses_promotion_policy_and_updates_with_student_id() -> None:
    built, _assessment = locked_completed_candidate()
    Student.objects.filter(pk=built.student_id).update(current_rank=rank("DAHN_BO"))
    GradingCandidate.objects.filter(pk=built.pk).update(testing_for_rank=rank("JKN"))
    finalised_outcome(built)
    client = auth_client("eligibility-reader@example.com")
    url = f"/api/gradings/outcomes/promotion-eligibility/?session={built.session_id}"

    blocked = client.get(url)
    assert blocked.status_code == 200
    assert blocked.json()[0]["eligible"] is False
    assert "black belt ID" in blocked.json()[0]["reason"]

    Student.objects.filter(pk=built.student_id).update(wksa_id="A-20819")
    ready = client.get(url)
    assert ready.json()[0]["eligible"] is True
    assert ready.json()[0]["reason"] == ""

    GradingCandidate.objects.filter(pk=built.pk).update(testing_for_rank=rank("BROWN"))
    wrong_rank = client.get(url)
    assert wrong_rank.json()[0]["eligible"] is False
    assert "no longer the next active rank" in wrong_rank.json()[0]["reason"]


def test_ledger_eligibility_reflects_a_recorded_promotion() -> None:
    built, _assessment = locked_completed_candidate()
    outcome = finalised_outcome(built)
    client = auth_client("eligibility-promoted-reader@example.com")
    url = f"/api/gradings/outcomes/promotion-eligibility/?session={built.session_id}"

    assert client.get(url).json()[0]["eligible"] is True
    promote_candidate(outcome, promoter("eligibility-promoter@example.com"))
    after = client.get(url).json()[0]
    assert after["eligible"] is False
    assert after["reason"] == "Outcome already has a promotion."


def test_ledger_eligibility_scales_without_queries_per_candidate() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = [candidate(session=session) for _ in range(6)]
    for item in built:
        generated = assessment(candidate=item)
        start_assessment(generated)
        complete_assessment(generated)
    transition_grading_session(session, GradingSession.Status.LOCKED)
    for item in built:
        item.refresh_from_db()
        finalised_outcome(item)

    with CaptureQueriesContext(connection) as queries:
        answer = promotion_eligibility_for_session(session.pk)

    assert len(answer) == 6
    assert all(row["eligible"] is True for row in answer)
    assert len(queries) == 3


def test_candidate_records_the_rank_held_at_registration() -> None:
    built = candidate(
        student=student(current_rank=rank("YELLOW_STRIPE")),
        testing_for_rank=rank("YELLOW"),
    )

    assert built.from_rank.code == "YELLOW_STRIPE"


def test_candidate_from_rank_does_not_move_when_the_student_is_promoted() -> None:
    built, _generated = locked_completed_candidate()
    promote_candidate(finalised_outcome(built), promoter("from-rank@example.com"))

    built.refresh_from_db()
    built.student.refresh_from_db()
    response = auth_client("from-rank-api@example.com").get(
        f"/api/gradings/candidates/{built.pk}/",
    )

    assert built.student.current_rank.code == "YELLOW_STRIPE"
    assert built.from_rank.code == "WHITE"
    assert response.status_code == 200
    assert response.data["from_rank_name"] == "White"


def test_from_rank_backfill_reconstructs_the_rank_at_registration() -> None:
    backfill = importlib.import_module(
        "gradings.migrations.0009_candidate_from_rank_and_delete_any_permission",
    ).backfill_from_rank
    promoted, _generated = locked_completed_candidate()
    promote_candidate(finalised_outcome(promoted), promoter("backfill@example.com"))
    # A later registration for the same, now promoted, student that was never
    # itself promoted: its rank is the one the earlier promotion reached.
    later = candidate(
        session=grading_session(grading_date=date(2028, 3, 20)),
        student=promoted.student,
        testing_for_rank=rank("YELLOW"),
    )
    never_promoted = candidate()
    GradingCandidate.objects.update(from_rank=rank("BROWN"))

    backfill(apps, None)

    assert GradingCandidate.objects.get(pk=promoted.pk).from_rank.code == "WHITE"
    assert GradingCandidate.objects.get(pk=later.pk).from_rank.code == ("YELLOW_STRIPE")
    assert GradingCandidate.objects.get(pk=never_promoted.pk).from_rank.code == (
        "WHITE"
    )


def test_promotion_database_constraints_and_model_validation() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    actor = promoter("promotion-db@example.com")
    promotion = promote_candidate(outcome, actor)

    with pytest.raises(ValidationError):
        promote_candidate(outcome, actor)

    with pytest.raises(IntegrityError), transaction.atomic():
        Promotion.objects.bulk_create(
            [
                Promotion(
                    student=promotion.student,
                    outcome=promotion.outcome,
                    grading_candidate=promotion.grading_candidate,
                    from_rank=promotion.from_rank,
                    to_rank=promotion.to_rank,
                    promoted_by=actor,
                    effective_date=promotion.effective_date,
                ),
            ],
        )

    other_built, _other_generated = locked_completed_candidate()
    other_outcome = finalised_outcome(other_built)
    with pytest.raises(IntegrityError), transaction.atomic():
        Promotion.objects.bulk_create(
            [
                Promotion(
                    student=other_built.student,
                    outcome=other_outcome,
                    grading_candidate=other_built,
                    from_rank=rank("WHITE"),
                    to_rank=rank("WHITE"),
                    promoted_by=actor,
                    effective_date=other_built.session.grading_date,
                ),
            ],
        )

    mismatch = Promotion(
        student=other_built.student,
        outcome=outcome,
        grading_candidate=other_built,
        from_rank=rank("WHITE"),
        to_rank=rank("YELLOW_STRIPE"),
        promoted_by=actor,
        effective_date=other_built.session.grading_date,
    )
    with pytest.raises(ValidationError) as exc_info:
        mismatch.full_clean()
    assert "outcome" in exc_info.value.message_dict

    # Attaching an outcome to another candidate's assessment used to be
    # possible through QuerySet.update(), which bypasses model validation.
    # The composite foreign key now refuses the write itself, so the
    # mismatched state this once set up can no longer exist. Not
    # finalised: that would hit the separate immutable-outcome guard first
    # and never reach the constraint this is testing.
    assessment_mismatch_built, _assessment_mismatch_generated = (
        locked_completed_candidate()
    )
    assessment_mismatch_outcome = create_candidate_outcome(
        assessment_mismatch_built,
        user("assessment-mismatch-creator@example.com"),
    )
    _foreign_built, foreign_generated = locked_completed_candidate()
    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.filter(pk=assessment_mismatch_outcome.pk).update(
            assessment=foreign_generated,
        )

    wrong_student = student(wksa_id="206-2-500")
    mismatch_student = Promotion(
        student=wrong_student,
        outcome=other_outcome,
        grading_candidate=other_built,
        from_rank=rank("WHITE"),
        to_rank=rank("YELLOW_STRIPE"),
        promoted_by=actor,
        effective_date=other_built.session.grading_date,
    )
    with pytest.raises(ValidationError) as student_exc:
        mismatch_student.full_clean()
    assert "student" in student_exc.value.message_dict

    missing_effective_date = Promotion(
        student=other_built.student,
        outcome=other_outcome,
        grading_candidate=other_built,
        from_rank=rank("WHITE"),
        to_rank=rank("YELLOW_STRIPE"),
        promoted_by=actor,
    )
    with pytest.raises(ValidationError) as date_exc:
        missing_effective_date.full_clean()
    assert "effective_date" in date_exc.value.message_dict


def test_promotion_permission_is_separate_from_final_decision_authority() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)

    with pytest.raises(ValidationError):
        promote_candidate(outcome, user("promotion-ordinary@example.com"))
    with pytest.raises(ValidationError):
        promote_candidate(
            outcome,
            user(
                "promotion-legacy-boolean@example.com",
            ),
        )
    with pytest.raises(ValidationError):
        promote_candidate(outcome, master("promotion-final-only@example.com"))

    actor = promoter("promotion-authorised@example.com")
    promotion = promote_candidate(outcome, actor)
    assert promotion.promoted_by == actor

    second_built, _second_generated = locked_completed_candidate()
    second_outcome = finalised_outcome(second_built)
    superuser = User.objects.create_superuser(email="promotion-superuser@example.com")
    second_promotion = promote_candidate(second_outcome, superuser)
    assert second_promotion.promoted_by == superuser


@pytest.mark.parametrize(
    ("status", "final_outcome"),
    [
        (CandidateOutcome.Status.DRAFT, None),
        (CandidateOutcome.Status.PROPOSED, None),
        (CandidateOutcome.Status.FINALISED, CandidateOutcome.Outcome.FAIL),
        (CandidateOutcome.Status.FINALISED, CandidateOutcome.Outcome.CONDITIONAL),
    ],
)
def test_promotion_rejects_ineligible_outcome_states(
    status: str,
    final_outcome: str | None,
) -> None:
    built, _generated = locked_completed_candidate()
    outcome = create_candidate_outcome(built, user(f"promotion-state-{status}@x.com"))
    if status == CandidateOutcome.Status.PROPOSED:
        outcome = propose_candidate_outcome(
            outcome,
            CandidateOutcome.Outcome.PASS,
            "",
            user("promotion-state-proposer@example.com"),
        )
    elif status == CandidateOutcome.Status.FINALISED:
        proposed = propose_candidate_outcome(
            outcome,
            CandidateOutcome.Outcome.PASS,
            "",
            user(f"promotion-state-proposer-{final_outcome}@example.com"),
        )
        outcome = finalise_candidate_outcome(
            proposed,
            cast(str, final_outcome),
            "",
            (
                "Additional review required."
                if final_outcome == CandidateOutcome.Outcome.CONDITIONAL
                else ""
            ),
            master(f"promotion-state-master-{final_outcome}@example.com"),
        )

    with pytest.raises(ValidationError):
        promote_candidate(outcome, promoter(f"promotion-state-{status}-actor@x.com"))


def test_promotion_rejects_invalid_candidate_assessment_and_session_states() -> None:
    open_candidate = candidate(
        session=grading_session(status=GradingSession.Status.OPEN)
    )
    open_assessment = assessment(candidate=open_candidate)
    start_assessment(open_assessment)
    complete_assessment(open_assessment)
    transition_grading_session(open_candidate.session, GradingSession.Status.LOCKED)
    outcome = finalised_outcome(open_candidate)
    GradingSession.objects.filter(pk=open_candidate.session_id).update(
        status=GradingSession.Status.CANCELLED,
    )
    with pytest.raises(ValidationError):
        promote_candidate(outcome, promoter("promotion-cancelled@example.com"))

    built, generated = locked_completed_candidate()
    second_outcome = finalised_outcome(built)
    CandidateAssessment.objects.filter(pk=generated.pk).update(
        status=CandidateAssessment.Status.IN_PROGRESS,
        completed_at=None,
    )
    with pytest.raises(ValidationError):
        promote_candidate(second_outcome, promoter("promotion-assessment@example.com"))

    # The service still validates this, but the state is now unreachable:
    # the database refuses to create it. Not finalised, so the
    # write reaches the constraint rather than the immutable-outcome guard.
    mismatch_built, _mismatch_generated = locked_completed_candidate()
    mismatch_outcome = create_candidate_outcome(
        mismatch_built,
        user("promotion-mismatch-creator@example.com"),
    )
    _foreign_built, foreign_generated = locked_completed_candidate()
    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.filter(pk=mismatch_outcome.pk).update(
            assessment=foreign_generated,
        )

    withdrawn, _withdrawn_assessment = locked_completed_candidate()
    withdrawn_outcome = finalised_outcome(withdrawn)
    # Unreachable through the services (a finalised outcome blocks withdrawal),
    # so written directly - with the attribution the database requires.
    GradingCandidate.objects.filter(pk=withdrawn.pk).update(
        status=GradingCandidate.Status.WITHDRAWN,
        withdrawal_reason=GradingCandidate.WithdrawalReason.OTHER,
        withdrawal_note="Written directly for the test.",
        withdrawn_by=user("promotion-withdrawer@example.com"),
        withdrawn_at=timezone.now(),
    )
    with pytest.raises(ValidationError):
        promote_candidate(
            withdrawn_outcome, promoter("promotion-withdrawn@example.com")
        )


def test_promotion_rejects_rank_progression_drift() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    Student.objects.filter(pk=built.student_id).update(current_rank=rank("YELLOW"))

    with pytest.raises(ValidationError):
        promote_candidate(outcome, promoter("promotion-rank-changed@example.com"))

    skipped_built, _skipped_generated = locked_completed_candidate()
    skipped_outcome = finalised_outcome(skipped_built)
    GradingCandidate.objects.filter(pk=skipped_built.pk).update(
        testing_for_rank=rank("YELLOW"),
    )
    with pytest.raises(ValidationError):
        promote_candidate(skipped_outcome, promoter("promotion-skipped@example.com"))

    inactive_built, _inactive_generated = locked_completed_candidate()
    inactive_outcome = finalised_outcome(inactive_built)
    Rank.objects.filter(code="YELLOW_STRIPE").update(active=False)
    with pytest.raises(ValidationError):
        promote_candidate(inactive_outcome, promoter("promotion-inactive@example.com"))


def test_promotion_is_always_dated_the_grading_it_came_from() -> None:
    # There is no effective_date parameter: a promotion belongs to its
    # grading, and the caller has no say in the date.
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)

    promotion = promote_candidate(outcome, promoter("promotion-date@example.com"))

    assert promotion.effective_date == built.session.grading_date


def test_promotion_records_are_immutable_and_protected() -> None:
    built, _generated = locked_completed_candidate()
    promotion = promote_candidate(
        finalised_outcome(built),
        promoter("promotion-immutable@example.com"),
    )

    promotion.notes = "Changed"
    with pytest.raises(ValidationError):
        promotion.save()
    with pytest.raises(ValidationError):
        promotion.delete()
    with pytest.raises(ValidationError):
        Promotion.objects.filter(pk=promotion.pk).delete()
    with pytest.raises(ValidationError):
        Promotion.objects.filter(pk=promotion.pk).update(notes="Bulk-changed")
    promotion.refresh_from_db()
    assert promotion.notes != "Bulk-changed"

    built.student.current_rank = rank("YELLOW")
    with pytest.raises(ValidationError):
        built.student.save()


def test_promotion_api_workflow_filters_and_rank_history() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    actor = promoter("promotion-api@example.com")
    client = APIClient()

    unauthenticated = client.post(f"/api/gradings/outcomes/{outcome.id}/promote/")
    client.force_authenticate(user=user("promotion-api-ordinary@example.com"))
    forbidden = client.post(f"/api/gradings/outcomes/{outcome.id}/promote/")
    client.force_authenticate(user=actor)
    spoofed = client.post(
        f"/api/gradings/outcomes/{outcome.id}/promote/",
        {
            "effective_date": "2030-01-01",
            "promoted_by": str(user("promotion-spoof@example.com").id),
        },
        format="json",
    )
    promote_response = client.post(
        f"/api/gradings/outcomes/{outcome.id}/promote/",
        {"notes": "API promotion."},
        format="json",
    )
    duplicate = client.post(f"/api/gradings/outcomes/{outcome.id}/promote/")
    arbitrary_post = client.post("/api/gradings/promotions/", {}, format="json")

    promotion_id = promote_response.json()["id"]
    list_response = client.get(
        f"/api/gradings/promotions/?session={built.session_id}",
    )
    rank_history_response = client.get(
        f"/api/students/{built.student_id}/rank-history/",
    )
    patch_response = client.patch(
        f"/api/gradings/promotions/{promotion_id}/",
        {"notes": "Changed"},
        format="json",
    )
    delete_response = client.delete(f"/api/gradings/promotions/{promotion_id}/")

    assert unauthenticated.status_code == 403
    assert forbidden.status_code == 403
    assert spoofed.status_code == 400
    assert promote_response.status_code == 201
    assert promote_response.json()["effective_date"] == str(built.session.grading_date)
    stored_promotion = Promotion.objects.get(pk=promotion_id)
    assert stored_promotion.promoted_by == actor
    assert stored_promotion.student == built.student
    built.student.refresh_from_db()
    assert built.student.current_rank.code == "YELLOW_STRIPE"
    assert duplicate.status_code == 400
    assert arbitrary_post.status_code == 405
    assert [item["id"] for item in results(list_response)] == [promotion_id]
    assert rank_history_response.status_code == 200
    assert [item["id"] for item in rank_history_response.json()["promotions"]] == [
        promotion_id,
    ]
    # No detail route: a promotion is immutable and undeletable.
    assert patch_response.status_code == 404
    assert delete_response.status_code == 404


def test_bulk_promote_promotes_every_eligible_outcome_in_one_request() -> None:
    first_candidate, _first_assessment = locked_completed_candidate()
    second_candidate, _second_assessment = locked_completed_candidate()
    first_outcome = finalised_outcome(first_candidate)
    second_outcome = finalised_outcome(second_candidate)
    actor = promoter("bulk-promote@example.com")
    client = APIClient()
    client.force_authenticate(user=actor)

    response = client.post(
        "/api/gradings/outcomes/bulk-promote/",
        {"outcomes": [first_outcome.id, second_outcome.id]},
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["errors"] == {}
    assert {item["grading_candidate"] for item in payload["promoted"]} == {
        first_candidate.id,
        second_candidate.id,
    }
    first_candidate.student.refresh_from_db()
    second_candidate.student.refresh_from_db()
    assert first_candidate.student.current_rank.code == "YELLOW_STRIPE"
    assert second_candidate.student.current_rank.code == "YELLOW_STRIPE"
    assert (
        Promotion.objects.filter(
            outcome_id__in=[first_outcome.id, second_outcome.id],
        ).count()
        == 2
    )


def test_bulk_promote_is_independent_per_row() -> None:
    eligible_candidate, _eligible_assessment = locked_completed_candidate()
    ineligible_candidate, _ineligible_assessment = locked_completed_candidate()
    eligible_outcome = finalised_outcome(eligible_candidate)
    # A finalised FAIL is not promotable - this row must fail independently
    # of the eligible one.
    ineligible_outcome = finalised_outcome(
        ineligible_candidate,
        proposed=CandidateOutcome.Outcome.FAIL,
        final=CandidateOutcome.Outcome.FAIL,
    )
    actor = promoter("bulk-promote-partial@example.com")
    client = APIClient()
    client.force_authenticate(user=actor)

    response = client.post(
        "/api/gradings/outcomes/bulk-promote/",
        {"outcomes": [eligible_outcome.id, ineligible_outcome.id]},
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["grading_candidate"] for item in payload["promoted"]] == [
        eligible_outcome.candidate_id,
    ]
    assert list(payload["errors"].keys()) == ["1"]
    assert Promotion.objects.filter(outcome=eligible_outcome).exists()
    assert not Promotion.objects.filter(outcome=ineligible_outcome).exists()


def test_bulk_promote_requires_promotion_authority() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    client = APIClient()

    unauthenticated = client.post(
        "/api/gradings/outcomes/bulk-promote/",
        {"outcomes": [outcome.id]},
        format="json",
    )
    client.force_authenticate(user=user("bulk-promote-ordinary@example.com"))
    forbidden = client.post(
        "/api/gradings/outcomes/bulk-promote/",
        {"outcomes": [outcome.id]},
        format="json",
    )

    assert unauthenticated.status_code == 403
    assert forbidden.status_code == 403
    assert not Promotion.objects.filter(outcome=outcome).exists()


def test_student_rank_timeline_ordering_is_deterministic() -> None:
    first_built, _first_generated = locked_completed_candidate()
    timeline_student = first_built.student
    first = promote_candidate(
        finalised_outcome(first_built),
        promoter("promotion-timeline-first@example.com"),
    )
    timeline_student.refresh_from_db()
    second_session = grading_session(status=GradingSession.Status.OPEN)
    second_built = candidate(
        session=second_session,
        student=timeline_student,
        testing_for_rank=rank("YELLOW"),
    )
    second_generated = assessment(candidate=second_built)
    start_assessment(second_generated)
    complete_assessment(second_generated)
    transition_grading_session(second_session, GradingSession.Status.LOCKED)
    second = promote_candidate(
        finalised_outcome(second_built),
        promoter("promotion-timeline-second@example.com"),
    )

    timeline = student_rank_timeline(timeline_student)

    assert [promotion.pk for promotion in timeline["promotions"]] == [
        second.pk,
        first.pk,
    ]


def test_promotion_admin_is_read_only_and_has_no_bulk_actions() -> None:
    built, _generated = locked_completed_candidate()
    promotion = promote_candidate(
        finalised_outcome(built),
        promoter("promotion-admin@example.com"),
    )
    model_admin = PromotionAdmin(Promotion, admin.site)
    request = admin_request("promotion-admin-request@example.com")
    promotion.notes = "Unsafe admin edit"
    form = cast(
        "ModelForm[Any]", SimpleNamespace(changed_data=["notes"], cleaned_data={})
    )

    assert model_admin.has_add_permission(request) is False
    assert model_admin.has_delete_permission(request, promotion) is False
    assert model_admin.actions == ()
    with pytest.raises(ValidationError):
        model_admin.save_model(request, promotion, form, True)
