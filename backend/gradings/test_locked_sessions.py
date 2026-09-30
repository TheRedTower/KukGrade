"""Leaving a locked session honestly: withdrawal and cancellation with a reason."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, cast

import pytest
from django.contrib import admin
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.forms import ModelForm
from django.http import HttpRequest
from django.test import RequestFactory
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditAction, AuditEvent
from gradings.admin import (
    GradingSessionAdmin,
    GradingSessionAdminForm,
)
from gradings.models import (
    CandidateAssessment,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
)
from gradings.services import (
    create_candidate_outcome,
    propose_candidate_outcome,
    transition_grading_session,
    withdraw_locked_candidate,
)
from gradings.testing import (
    auth_client,
    candidate,
    finalised_outcome,
    grading_session,
    locked_completed_candidate,
    locked_session_with_undecided_candidate,
    override_master,
    user,
)
from kukgrade.testing import results

pytestmark = pytest.mark.django_db


def test_a_candidate_withdrawn_after_lock_no_longer_blocks_completion() -> None:
    # Without this a candidate who could not receive a decision (registered in
    # error, or unable to continue) could only be cleared by finalising an
    # outcome nobody actually decided.
    session, built = locked_session_with_undecided_candidate()
    master_user = override_master("override-master@example.com")

    withdrawn = withdraw_locked_candidate(
        built,
        reason=GradingCandidate.WithdrawalReason.INJURY,
        note="Ankle injury during breaking.",
        actor=master_user,
    )

    assert withdrawn.status == GradingCandidate.Status.WITHDRAWN
    assert withdrawn.withdrawal_reason == GradingCandidate.WithdrawalReason.INJURY
    assert withdrawn.withdrawn_by == master_user
    assert withdrawn.withdrawn_at is not None

    # And the session can now complete, since withdrawn candidates do not block.
    completed = transition_grading_session(
        session,
        GradingSession.Status.COMPLETED,
    )
    assert completed.status == GradingSession.Status.COMPLETED


def test_withdrawal_keeps_the_assessment_exactly_as_recorded() -> None:
    session, built = locked_session_with_undecided_candidate()
    generated = built.assessment
    item = generated.items.first()
    assert item is not None
    result_before = item.result

    withdraw_locked_candidate(
        built,
        reason=GradingCandidate.WithdrawalReason.INJURY,
        note="",
        actor=override_master("keeps-partial@example.com"),
    )

    item.refresh_from_db()
    generated.refresh_from_db()
    assert item.result == result_before
    assert generated.status == CandidateAssessment.Status.COMPLETED


def test_locked_withdrawal_requires_authority() -> None:
    _session, built = locked_session_with_undecided_candidate()

    with pytest.raises(ValidationError):
        withdraw_locked_candidate(
            built,
            reason=GradingCandidate.WithdrawalReason.INJURY,
            note="",
            actor=user("no-override-authority@example.com"),
        )

    built.refresh_from_db()
    assert built.status == GradingCandidate.Status.COMPLETED


def test_locked_withdrawal_is_refused_once_the_outcome_is_finalised() -> None:
    built, _generated = locked_completed_candidate()
    finalised_outcome(built)

    with pytest.raises(ValidationError) as exc_info:
        withdraw_locked_candidate(
            built,
            reason=GradingCandidate.WithdrawalReason.WITHDREW,
            note="",
            actor=override_master("too-late@example.com"),
        )

    assert "finalised outcome" in str(exc_info.value)


def test_locked_withdrawal_clears_an_undecided_outcome() -> None:
    built, _generated = locked_completed_candidate()
    proposer = user("proposer-before-withdrawal@example.com")
    outcome = create_candidate_outcome(built, user("draft-outcome@example.com"))
    propose_candidate_outcome(
        outcome,
        proposed_outcome=CandidateOutcome.Outcome.PASS,
        proposal_notes="Strong performance, recommend a pass.",
        actor=proposer,
    )

    withdrawn = withdraw_locked_candidate(
        built,
        reason=GradingCandidate.WithdrawalReason.OTHER,
        note="Registered against the wrong session.",
        actor=override_master("clears-proposal@example.com"),
    )

    # A proposal was never a decision; leaving it attached to a withdrawn
    # candidate would misrepresent the record.
    assert not CandidateOutcome.objects.filter(pk=outcome.pk).exists()

    # But discarding it silently would erase that someone proposed PASS -
    # captured into the withdrawal event before the delete (KG-041).
    event = AuditEvent.objects.filter(
        action=AuditAction.CANDIDATE_WITHDRAWN,
        entity_id=str(withdrawn.pk),
    ).latest("occurred_at")
    discarded = event.metadata["discarded_proposal"]
    assert discarded["status"] == CandidateOutcome.Status.PROPOSED
    assert discarded["proposed_outcome"] == CandidateOutcome.Outcome.PASS
    assert discarded["proposal_notes"] == "Strong performance, recommend a pass."
    assert discarded["proposed_by"] == str(proposer.pk)


def test_locked_withdrawal_rejects_an_unknown_reason() -> None:
    _session, built = locked_session_with_undecided_candidate()

    with pytest.raises(ValidationError):
        withdraw_locked_candidate(
            built,
            reason="BECAUSE",
            note="",
            actor=override_master("bad-reason@example.com"),
        )


def test_cancelling_a_locked_session_requires_authority_and_a_reason() -> None:
    session, _built = locked_session_with_undecided_candidate()

    with pytest.raises(ValidationError):
        transition_grading_session(
            session,
            GradingSession.Status.CANCELLED,
            actor=user("cannot-cancel-locked@example.com"),
        )

    with pytest.raises(ValidationError) as exc_info:
        transition_grading_session(
            session,
            GradingSession.Status.CANCELLED,
            actor=override_master("no-reason-given@example.com"),
            reason="   ",
        )
    assert "reason is required" in str(exc_info.value)

    session.refresh_from_db()
    assert session.status == GradingSession.Status.LOCKED


def test_admin_session_form_accepts_a_cancellation_reason() -> None:
    # The regression this actually guards against: driving save_model with a
    # stub form (as the test below does) never exercises Meta.fields at all,
    # so it would pass even with the field missing from the real form. Only
    # binding real POST-shaped data through GradingSessionAdminForm proves
    # the field is there to submit in the first place (KG-050).
    session, _built = locked_session_with_undecided_candidate()

    form = GradingSessionAdminForm(
        data={
            "title": session.title,
            "grading_date": session.grading_date,
            "status": GradingSession.Status.CANCELLED,
            "location": session.location,
            "notes": session.notes,
            "cancellation_reason": "Venue lost power; grading abandoned.",
            "created_by": session.created_by_id,
        },
        instance=session,
    )

    assert form.is_valid(), form.errors
    saved = form.save(commit=False)
    assert saved.cancellation_reason == "Venue lost power; grading abandoned."


def test_admin_can_cancel_a_locked_session_with_a_reason() -> None:
    # Complements the form-binding test above: once the reason reaches the
    # object, save_model must actually thread it through to
    # transition_grading_session rather than dropping it.
    session, _built = locked_session_with_undecided_candidate()
    model_admin = GradingSessionAdmin(GradingSession, admin.site)
    master_user = override_master("admin-cancel-master@example.com")
    session.status = GradingSession.Status.CANCELLED
    session.cancellation_reason = "Venue lost power; grading abandoned."
    form = cast(
        "ModelForm[Any]",
        SimpleNamespace(changed_data=["status", "cancellation_reason"]),
    )
    request = cast(HttpRequest, RequestFactory().post("/admin/"))
    request.user = master_user

    model_admin.save_model(request, session, form, True)

    session.refresh_from_db()
    assert session.status == GradingSession.Status.CANCELLED
    assert session.cancellation_reason == "Venue lost power; grading abandoned."


def test_cancelling_a_locked_session_records_the_reason() -> None:
    session, _built = locked_session_with_undecided_candidate()

    cancelled = transition_grading_session(
        session,
        GradingSession.Status.CANCELLED,
        actor=override_master("cancels-locked@example.com"),
        reason="Venue lost; grading abandoned.",
    )

    assert cancelled.status == GradingSession.Status.CANCELLED
    assert cancelled.cancellation_reason == "Venue lost; grading abandoned."


def test_api_accepts_the_cancellation_reason_but_never_serves_it() -> None:
    session, _built = locked_session_with_undecided_candidate()
    canceller = user("api-cancel-locked@example.com", role=User.Role.ADMINISTRATOR)
    canceller.user_permissions.add(
        Permission.objects.get(
            codename="can_override_locked_session",
            content_type=ContentType.objects.get_for_model(GradingSession),
        ),
    )
    client = APIClient()
    client.force_authenticate(user=User.objects.get(pk=canceller.pk))
    url = f"/api/gradings/sessions/{session.id}/"

    refused = client.patch(url, {"status": "CANCELLED"}, format="json")
    assert refused.status_code == 400
    assert "reason is required" in refused.json()["error"]["message"]
    session.refresh_from_db()
    assert session.status == GradingSession.Status.LOCKED

    accepted = client.patch(
        url,
        {
            "status": "CANCELLED",
            "cancellation_reason": "Venue lost; grading abandoned.",
        },
        format="json",
    )
    assert accepted.status_code == 200, accepted.json()
    assert accepted.json()["status"] == "CANCELLED"
    assert "cancellation_reason" not in accepted.json()
    assert "cancellation_reason" not in client.get(url).json()
    session.refresh_from_db()
    assert session.cancellation_reason == "Venue lost; grading abandoned."


def test_cancelling_a_draft_session_still_needs_no_reason() -> None:
    session = grading_session(status=GradingSession.Status.DRAFT)

    cancelled = transition_grading_session(session, GradingSession.Status.CANCELLED)

    assert cancelled.status == GradingSession.Status.CANCELLED
    assert cancelled.cancellation_reason == ""


def test_withdrawal_attribution_is_a_database_constraint() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            GradingCandidate.objects.filter(pk=built.pk).update(
                withdrawal_reason=GradingCandidate.WithdrawalReason.INJURY,
                withdrawn_by=None,
                withdrawn_at=None,
            )


def test_withdraw_api_requires_override_authority() -> None:
    _session, built = locked_session_with_undecided_candidate()
    client = auth_client("withdraw-api-plain@example.com")

    response = client.post(
        f"/api/gradings/candidates/{built.id}/withdraw/",
        {"withdrawal_reason": GradingCandidate.WithdrawalReason.INJURY},
        format="json",
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


def test_withdraw_api_records_the_withdrawal() -> None:
    _session, built = locked_session_with_undecided_candidate()
    master_user = override_master("withdraw-api-master@example.com")
    client = APIClient()
    client.force_authenticate(user=master_user)

    response = client.post(
        f"/api/gradings/candidates/{built.id}/withdraw/",
        {
            "withdrawal_reason": GradingCandidate.WithdrawalReason.ABSENT,
            "withdrawal_note": "Did not arrive.",
        },
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == GradingCandidate.Status.WITHDRAWN
    assert (
        payload["student_display_name"]
        == (f"{built.student.first_name} {built.student.last_name}").strip()
    )
    assert payload["withdrawal_reason"] == GradingCandidate.WithdrawalReason.ABSENT
    assert payload["withdrawal_reason_display"] == "Did not attend"
    assert payload["withdrawal_note"] == "Did not arrive."
    built.refresh_from_db()
    assert built.withdrawn_by == master_user
    assert built.withdrawn_at is not None


def test_withdrawal_reasons_are_served_with_which_needs_a_note() -> None:
    response = auth_client("withdrawal-reasons@example.com").get(
        "/api/gradings/withdrawal-reasons/",
    )

    assert response.status_code == 200
    assert results(response) == [
        {"code": "INJURY", "name": "Injured during grading", "note_required": False},
        {"code": "WITHDREW", "name": "Withdrew voluntarily", "note_required": False},
        {"code": "ABSENT", "name": "Did not attend", "note_required": False},
        {"code": "OTHER", "name": "Other", "note_required": True},
    ]


def test_an_other_withdrawal_needs_a_note() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    client = auth_client("other-withdrawal@example.com")
    url = "/api/gradings/candidates/bulk-update-status/"

    refused = client.post(
        url,
        {
            "candidates": [built.pk],
            "status": "WITHDRAWN",
            "withdrawal_reason": "OTHER",
            "withdrawal_note": "  ",
        },
        format="json",
    )
    accepted = client.post(
        url,
        {
            "candidates": [built.pk],
            "status": "WITHDRAWN",
            "withdrawal_reason": "OTHER",
            "withdrawal_note": "Family emergency",
        },
        format="json",
    )

    assert refused.status_code == 200
    assert refused.json()["errors"]["0"] == ["Say what the other reason is."]
    assert accepted.status_code == 200
    assert accepted.json()["errors"] == {}
    built.refresh_from_db()
    assert built.withdrawal_note == "Family emergency"


def test_a_locked_other_withdrawal_needs_a_note() -> None:
    built, _generated = locked_completed_candidate()

    with pytest.raises(ValidationError) as exc_info:
        withdraw_locked_candidate(
            built,
            reason=GradingCandidate.WithdrawalReason.OTHER,
            note="",
            actor=override_master("other-locked@example.com"),
        )

    assert "withdrawal_note" in exc_info.value.message_dict
