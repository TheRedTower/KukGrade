"""Grading sessions: model rules, lifecycle, API, admin and progress counts."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace
from typing import Any, cast

import pytest
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.forms import ModelForm
from django.http import HttpRequest
from django.test import RequestFactory
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from audit.models import AuditAction, AuditEvent
from gradings.admin import (
    CandidateAssessmentAdmin,
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
    apply_candidate_update,
    create_candidate_outcome,
    propose_candidate_outcome,
    transition_grading_session,
    validate_session_transition,
)
from gradings.testing import (
    admin_request,
    assessment,
    auth_client,
    candidate,
    complete_assessment,
    finalised_outcome,
    grading_session,
    start_assessment,
    user,
)
from kukgrade.testing import results

pytestmark = pytest.mark.django_db


def test_valid_grading_session_can_be_created() -> None:
    creator = user("session-creator@example.com")
    session = grading_session(created_by=creator)

    assert session.pk is not None
    assert session.title == "March 2027 Colchester Grading"
    assert session.status == GradingSession.Status.DRAFT
    assert session.created_by == creator
    assert str(session) == "March 2027 Colchester Grading (2027-03-20)"


def test_grading_session_blank_title_rejected() -> None:
    session = GradingSession(
        title="   ",
        grading_date=date(2027, 3, 20),
        created_by=user("blank-title@example.com"),
    )

    with pytest.raises(ValidationError) as exc_info:
        session.full_clean()

    assert "Title is required." in exc_info.value.message_dict["title"]

    with pytest.raises(IntegrityError), transaction.atomic():
        GradingSession.objects.bulk_create(
            [
                GradingSession(
                    title="",
                    grading_date=date(2027, 3, 20),
                    created_by=user("blank-title-db@example.com"),
                ),
            ],
        )


def test_invalid_grading_session_status_rejected_at_database_level() -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        GradingSession.objects.bulk_create(
            [
                GradingSession(
                    title="Invalid Status Grading",
                    grading_date=date(2027, 3, 20),
                    status="INVALID",
                    created_by=user("invalid-status@example.com"),
                ),
            ],
        )


def test_grading_session_date_cannot_change_after_candidates_exist() -> None:
    session = grading_session()
    candidate(session=session)

    session.grading_date = date(2027, 4, 1)

    with pytest.raises(ValidationError) as exc_info:
        session.save()

    assert "grading_date" in exc_info.value.message_dict
    session.refresh_from_db()
    assert session.grading_date == date(2027, 3, 20)


def test_grading_session_default_status_is_draft() -> None:
    assert grading_session().status == GradingSession.Status.DRAFT


def test_new_grading_session_must_start_in_draft_status() -> None:
    with pytest.raises(ValidationError) as exc_info:
        GradingSession.objects.create(
            title="Locked on create",
            grading_date=date(2027, 3, 20),
            status=GradingSession.Status.LOCKED,
            created_by=user("locked-on-create@example.com"),
        )

    assert "New grading sessions must start in draft status." in str(exc_info.value)


def test_grading_session_ordering_is_deterministic() -> None:
    first = grading_session(title="First", grading_date=date(2027, 1, 1))
    latest_early = grading_session(title="Latest Early", grading_date=date(2027, 5, 1))
    latest_late = grading_session(title="Latest Late", grading_date=date(2027, 5, 1))

    assert list(GradingSession.objects.all()) == [latest_early, latest_late, first]


@pytest.mark.parametrize(
    ("from_status", "to_status"),
    [
        (GradingSession.Status.DRAFT, GradingSession.Status.OPEN),
        (GradingSession.Status.DRAFT, GradingSession.Status.CANCELLED),
        (GradingSession.Status.OPEN, GradingSession.Status.LOCKED),
        (GradingSession.Status.OPEN, GradingSession.Status.CANCELLED),
        (GradingSession.Status.LOCKED, GradingSession.Status.COMPLETED),
        # Added 2026-09: an abandoned grading needs an exit. Authority and a
        # recorded reason are enforced by transition_grading_session, not by
        # the transition table.
        (GradingSession.Status.LOCKED, GradingSession.Status.CANCELLED),
    ],
)
def test_valid_lifecycle_transitions(from_status: str, to_status: str) -> None:
    validate_session_transition(from_status, to_status)


@pytest.mark.parametrize(
    ("from_status", "to_status"),
    [
        (GradingSession.Status.DRAFT, GradingSession.Status.LOCKED),
        (GradingSession.Status.DRAFT, GradingSession.Status.COMPLETED),
        (GradingSession.Status.OPEN, GradingSession.Status.COMPLETED),
        (GradingSession.Status.LOCKED, GradingSession.Status.OPEN),
        (GradingSession.Status.COMPLETED, GradingSession.Status.OPEN),
        (GradingSession.Status.CANCELLED, GradingSession.Status.OPEN),
    ],
)
def test_invalid_lifecycle_transitions(from_status: str, to_status: str) -> None:
    with pytest.raises(ValidationError):
        validate_session_transition(from_status, to_status)


def test_completed_and_cancelled_states_are_terminal() -> None:
    for terminal_status in [
        GradingSession.Status.COMPLETED,
        GradingSession.Status.CANCELLED,
    ]:
        for target_status in GradingSession.Status.values:
            if target_status != terminal_status:
                with pytest.raises(ValidationError):
                    validate_session_transition(terminal_status, target_status)


def test_session_api_requires_authentication() -> None:
    response = APIClient().get("/api/gradings/sessions/")

    assert response.status_code == 403


def test_authenticated_session_crud_and_created_by_spoofing_rejected() -> None:
    creator = user("api-real-creator@example.com")
    spoofed = user("api-spoofed-creator@example.com")
    client = APIClient()
    client.force_authenticate(user=creator)

    create_response = client.post(
        "/api/gradings/sessions/",
        {
            "title": "API Grading",
            "grading_date": "2027-04-01",
            "status": GradingSession.Status.DRAFT,
            "location": "Colchester",
            "created_by": spoofed.id,
        },
        format="json",
    )

    assert create_response.status_code == 201
    payload = create_response.json()
    assert GradingSession.objects.get(pk=payload["id"]).created_by == creator

    detail_response = client.get(f"/api/gradings/sessions/{payload['id']}/")
    patch_response = client.patch(
        f"/api/gradings/sessions/{payload['id']}/",
        {"status": GradingSession.Status.OPEN},
        format="json",
    )
    delete_response = client.delete(f"/api/gradings/sessions/{payload['id']}/")

    assert detail_response.status_code == 200
    assert patch_response.status_code == 200
    assert delete_response.status_code == 400


def test_session_api_rejects_non_draft_initial_status() -> None:
    client = auth_client("api-non-draft-create@example.com")

    response = client.post(
        "/api/gradings/sessions/",
        {
            "title": "Locked on create",
            "grading_date": "2027-04-01",
            "status": GradingSession.Status.LOCKED,
        },
        format="json",
    )

    assert response.status_code == 400
    assert not GradingSession.objects.filter(title="Locked on create").exists()


def test_session_api_filters_work() -> None:
    draft = grading_session(
        title="Draft",
        grading_date=date(2027, 4, 1),
        status=GradingSession.Status.DRAFT,
    )
    grading_session(
        title="Open",
        grading_date=date(2027, 5, 1),
        status=GradingSession.Status.OPEN,
    )
    client = auth_client("session-filter@example.com")

    response = client.get(
        "/api/gradings/sessions/"
        "?status=DRAFT&grading_date_from=2027-03-01&grading_date_to=2027-04-30",
    )

    assert response.status_code == 200
    assert [item["id"] for item in results(response)] == [draft.id]


def test_session_api_searches_title_and_location() -> None:
    title_match = grading_session(title="Spring Black Belt Grading")
    location_match = grading_session(
        title="Junior Grading",
        location="Colchester Central Dojang",
    )
    grading_session(title="Unrelated", location="Ipswich")
    client = auth_client("session-search@example.com")

    title_response = client.get("/api/gradings/sessions/?search=black%20belt")
    location_response = client.get("/api/gradings/sessions/?search=colchester")

    assert [item["id"] for item in results(title_response)] == [title_match.id]
    assert [item["id"] for item in results(location_response)] == [location_match.id]


def test_session_api_malformed_or_reversed_date_filters_return_empty_list() -> None:
    grading_session(title="Filtered", grading_date=date(2027, 4, 1))
    client = auth_client("session-filter-invalid@example.com")

    malformed_response = client.get(
        "/api/gradings/sessions/?grading_date_from=not-a-date",
    )
    reversed_response = client.get(
        "/api/gradings/sessions/"
        "?grading_date_from=2027-05-01&grading_date_to=2027-04-01",
    )

    assert malformed_response.status_code == 200
    assert results(malformed_response) == []
    assert reversed_response.status_code == 200
    assert results(reversed_response) == []


def test_session_api_lifecycle_validation() -> None:
    session = grading_session(status=GradingSession.Status.DRAFT)
    client = auth_client("session-lifecycle@example.com")

    invalid_response = client.patch(
        f"/api/gradings/sessions/{session.id}/",
        {"status": GradingSession.Status.COMPLETED},
        format="json",
    )
    valid_response = client.patch(
        f"/api/gradings/sessions/{session.id}/",
        {"status": GradingSession.Status.OPEN},
        format="json",
    )

    assert invalid_response.status_code == 400
    assert valid_response.status_code == 200
    assert valid_response.json()["status"] == GradingSession.Status.OPEN


def test_session_api_enforces_assessment_prerequisites_for_locking() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    client = auth_client("session-lock-api@example.com")

    missing_response = client.patch(
        f"/api/gradings/sessions/{session.id}/",
        {"status": GradingSession.Status.LOCKED},
        format="json",
    )
    generated = assessment(candidate=built)
    start_assessment(generated)
    in_progress_response = client.patch(
        f"/api/gradings/sessions/{session.id}/",
        {"status": GradingSession.Status.LOCKED},
        format="json",
    )
    complete_assessment(generated)
    allowed_response = client.patch(
        f"/api/gradings/sessions/{session.id}/",
        {"status": GradingSession.Status.LOCKED},
        format="json",
    )

    assert missing_response.status_code == 400
    assert in_progress_response.status_code == 400
    assert allowed_response.status_code == 200
    assert allowed_response.json()["status"] == GradingSession.Status.LOCKED


def test_session_api_rejects_locking_when_assessment_is_not_started() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    assessment(candidate=built)
    client = auth_client("session-lock-not-started-api@example.com")

    response = client.patch(
        f"/api/gradings/sessions/{session.id}/",
        {"status": GradingSession.Status.LOCKED},
        format="json",
    )

    assert response.status_code == 400
    assert "must be completed" in str(response.json())
    session.refresh_from_db()
    assert session.status == GradingSession.Status.OPEN


def test_session_api_enforces_assessment_completion_before_session_completion() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    complete_assessment(generated)
    transition_grading_session(session, GradingSession.Status.LOCKED)
    client = auth_client("session-complete-api@example.com")

    undecided_response = client.patch(
        f"/api/gradings/sessions/{session.id}/",
        {"status": GradingSession.Status.COMPLETED},
        format="json",
    )
    finalised_outcome(built)
    complete_response = client.patch(
        f"/api/gradings/sessions/{session.id}/",
        {"status": GradingSession.Status.COMPLETED},
        format="json",
    )

    assert undecided_response.status_code == 400
    assert complete_response.status_code == 200
    assert complete_response.json()["status"] == GradingSession.Status.COMPLETED


def test_session_api_rejects_locked_to_open_transition() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    complete_assessment(generated)
    transition_grading_session(session, GradingSession.Status.LOCKED)
    client = auth_client("session-reopen-api@example.com")

    response = client.patch(
        f"/api/gradings/sessions/{session.id}/",
        {"status": GradingSession.Status.OPEN},
        format="json",
    )

    assert response.status_code == 400
    session.refresh_from_db()
    assert session.status == GradingSession.Status.LOCKED


def test_session_api_rejects_grading_date_change_after_candidates_exist() -> None:
    session = grading_session()
    candidate(session=session)
    client = auth_client("session-date-change@example.com")

    response = client.patch(
        f"/api/gradings/sessions/{session.id}/",
        {"grading_date": "2027-04-01"},
        format="json",
    )

    assert response.status_code == 400
    session.refresh_from_db()
    assert session.grading_date == date(2027, 3, 20)


def test_direct_session_save_rejects_status_changes_and_allows_other_edits() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    session.location = "New hall"
    session.save()
    session.refresh_from_db()
    assert session.location == "New hall"

    session.status = GradingSession.Status.LOCKED
    with pytest.raises(ValidationError) as exc_info:
        session.save()

    assert "transition_grading_session" in str(exc_info.value)
    session.refresh_from_db()
    assert session.status == GradingSession.Status.OPEN


def test_transition_service_enforces_session_prerequisites_and_terminal_states() -> (
    None
):
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)

    with pytest.raises(ValidationError):
        transition_grading_session(session, GradingSession.Status.LOCKED)

    generated = assessment(candidate=built)
    with pytest.raises(ValidationError) as not_started_exc:
        transition_grading_session(session, GradingSession.Status.LOCKED)
    assert "must be completed" in str(not_started_exc.value)

    start_assessment(generated)
    with pytest.raises(ValidationError) as in_progress_exc:
        transition_grading_session(session, GradingSession.Status.LOCKED)
    assert "must be completed" in str(in_progress_exc.value)

    complete_assessment(generated)
    locked = transition_grading_session(session, GradingSession.Status.LOCKED)
    assert locked.status == GradingSession.Status.LOCKED

    with pytest.raises(ValidationError):
        transition_grading_session(locked, GradingSession.Status.OPEN)
    with pytest.raises(ValidationError):
        transition_grading_session(locked, GradingSession.Status.COMPLETED)
    finalised_outcome(built)
    completed = transition_grading_session(locked, GradingSession.Status.COMPLETED)
    assert completed.status == GradingSession.Status.COMPLETED

    with pytest.raises(ValidationError):
        transition_grading_session(completed, GradingSession.Status.OPEN)

    cancelled = grading_session(status=GradingSession.Status.CANCELLED)
    with pytest.raises(ValidationError):
        transition_grading_session(cancelled, GradingSession.Status.OPEN)


def test_session_lock_rejects_not_started_assessment() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    generated = assessment(candidate=candidate(session=session))

    with pytest.raises(ValidationError) as exc_info:
        transition_grading_session(session, GradingSession.Status.LOCKED)

    assert "must be completed" in str(exc_info.value)
    session.refresh_from_db()
    generated.refresh_from_db()
    assert session.status == GradingSession.Status.OPEN
    assert generated.status == CandidateAssessment.Status.NOT_STARTED


def test_session_lock_rejects_in_progress_assessments() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    start_assessment(assessment(candidate=candidate(session=session)))
    start_assessment(assessment(candidate=candidate(session=session)))

    with pytest.raises(ValidationError) as exc_info:
        transition_grading_session(session, GradingSession.Status.LOCKED)

    assert "must be completed" in str(exc_info.value)


def test_session_lock_allows_all_completed_assessments() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    complete_assessment(assessment(candidate=candidate(session=session)))
    complete_assessment(assessment(candidate=candidate(session=session)))

    locked = transition_grading_session(session, GradingSession.Status.LOCKED)

    assert locked.status == GradingSession.Status.LOCKED


def test_session_lock_rejects_one_in_progress_among_completed() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    start_assessment(assessment(candidate=candidate(session=session)))
    complete_assessment(assessment(candidate=candidate(session=session)))

    with pytest.raises(ValidationError):
        transition_grading_session(session, GradingSession.Status.LOCKED)


def test_withdrawn_candidates_do_not_block_session_locking() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    active = candidate(session=session)
    withdrawn_without_assessment = candidate(
        session=session,
        status=GradingCandidate.Status.WITHDRAWN,
    )
    withdrawn_with_not_started_assessment = candidate(session=session)
    assessment(candidate=withdrawn_with_not_started_assessment)
    apply_candidate_update(
        withdrawn_with_not_started_assessment,
        status=GradingCandidate.Status.WITHDRAWN,
        withdrawal_reason=GradingCandidate.WithdrawalReason.ABSENT,
        actor=user("lock-withdrawer@example.com"),
    )
    complete_assessment(assessment(candidate=active))

    locked = transition_grading_session(session, GradingSession.Status.LOCKED)

    assert locked.status == GradingSession.Status.LOCKED
    assert not CandidateAssessment.objects.filter(
        candidate=withdrawn_without_assessment,
    ).exists()
    withdrawn_snapshot = withdrawn_with_not_started_assessment.assessment
    assert withdrawn_snapshot.status == CandidateAssessment.Status.NOT_STARTED


def test_admin_session_form_reports_transition_prerequisite_errors() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    candidate(session=session)
    form = GradingSessionAdminForm(
        data={
            "title": session.title,
            "grading_date": session.grading_date,
            "status": GradingSession.Status.LOCKED,
            "location": session.location,
            "notes": session.notes,
            "created_by": session.created_by_id,
        },
        instance=session,
    )

    assert form.is_valid() is False
    assert "status" in form.errors


def test_admin_session_form_reports_not_started_assessment_lock_error() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    assessment(candidate=candidate(session=session))
    form = GradingSessionAdminForm(
        data={
            "title": session.title,
            "grading_date": session.grading_date,
            "status": GradingSession.Status.LOCKED,
            "location": session.location,
            "notes": session.notes,
            "created_by": session.created_by_id,
        },
        instance=session,
    )

    assert form.is_valid() is False
    assert "status" in form.errors
    assert "must be completed" in str(form.errors["status"])


def test_admin_session_form_rejects_non_draft_initial_status() -> None:
    form = GradingSessionAdminForm(
        data={
            "title": "Locked on create",
            "grading_date": date(2027, 3, 20),
            "status": GradingSession.Status.LOCKED,
            "location": "",
            "notes": "",
            "created_by": user("admin-non-draft-create@example.com").id,
        },
    )

    assert form.is_valid() is False
    assert "status" in form.errors


def test_admin_created_session_is_persisted_and_audited() -> None:
    # Previously this went straight through ModelAdmin's default save,
    # bypassing create_grading_session() and its audit call entirely
    # (KG-036).
    creator = user("admin-session-creator@example.com")
    obj = GradingSession(
        title="Admin-created session",
        grading_date=date(2027, 11, 1),
        created_by=creator,
    )
    model_admin = GradingSessionAdmin(GradingSession, admin.site)
    request = admin_request("admin-session-operator@example.com")

    model_admin.save_model(
        request, obj, cast("ModelForm[Any]", SimpleNamespace(changed_data=[])), False
    )

    assert obj.pk is not None
    persisted = GradingSession.objects.get(pk=obj.pk)
    assert persisted.title == "Admin-created session"
    assert persisted.status == GradingSession.Status.DRAFT
    event = AuditEvent.objects.filter(
        action=AuditAction.SESSION_CREATED,
        entity_id=str(obj.pk),
    ).latest("occurred_at")
    assert event.actor == creator


def test_admin_session_save_uses_transition_service_for_status_changes() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    candidate(session=session)
    model_admin = GradingSessionAdmin(GradingSession, admin.site)
    session.status = GradingSession.Status.LOCKED
    form = cast("ModelForm[Any]", SimpleNamespace(changed_data=["status"]))

    with pytest.raises(ValidationError):
        model_admin.save_model(
            admin_request("session-admin-lock@example.com"),
            session,
            form,
            True,
        )

    session.refresh_from_db()
    assert session.status == GradingSession.Status.OPEN


def test_admin_session_save_handles_valid_status_and_field_change_atomically() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    complete_assessment(assessment(candidate=candidate(session=session)))
    model_admin = GradingSessionAdmin(GradingSession, admin.site)
    session.status = GradingSession.Status.LOCKED
    session.location = "Main hall"
    form = cast("ModelForm[Any]", SimpleNamespace(changed_data=["status", "location"]))

    model_admin.save_model(
        admin_request("session-admin-valid-mixed@example.com"),
        session,
        form,
        True,
    )

    session.refresh_from_db()
    assert session.status == GradingSession.Status.LOCKED
    assert session.location == "Main hall"


def test_admin_session_save_rolls_back_field_change_when_transition_fails() -> None:
    session = grading_session(status=GradingSession.Status.OPEN, location="Old hall")
    candidate(session=session)
    model_admin = GradingSessionAdmin(GradingSession, admin.site)
    session.status = GradingSession.Status.LOCKED
    session.location = "Should roll back"
    form = cast("ModelForm[Any]", SimpleNamespace(changed_data=["status", "location"]))

    with pytest.raises(ValidationError):
        model_admin.save_model(
            admin_request("session-admin-invalid-mixed@example.com"),
            session,
            form,
            True,
        )

    session.refresh_from_db()
    assert session.status == GradingSession.Status.OPEN
    assert session.location == "Old hall"


def test_admin_session_save_rolls_back_field_change_when_assessment_not_started() -> (
    None
):
    session = grading_session(status=GradingSession.Status.OPEN, location="Old hall")
    assessment(candidate=candidate(session=session))
    model_admin = GradingSessionAdmin(GradingSession, admin.site)
    session.status = GradingSession.Status.LOCKED
    session.location = "Should roll back"
    form = cast("ModelForm[Any]", SimpleNamespace(changed_data=["status", "location"]))

    with pytest.raises(ValidationError) as exc_info:
        model_admin.save_model(
            admin_request("session-admin-not-started-mixed@example.com"),
            session,
            form,
            True,
        )

    assert "must be completed" in str(exc_info.value)
    session.refresh_from_db()
    assert session.status == GradingSession.Status.OPEN
    assert session.location == "Old hall"


def test_admin_assessment_status_change_is_attributed_to_the_admin_user() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    generated = assessment(candidate=candidate(session=session))
    model_admin = CandidateAssessmentAdmin(CandidateAssessment, admin.site)
    generated.status = CandidateAssessment.Status.IN_PROGRESS
    form = cast("ModelForm[Any]", SimpleNamespace(changed_data=["status"]))
    admin_user = user("assessment-admin-actor@example.com")
    request = cast(HttpRequest, RequestFactory().post("/admin/"))
    request.user = admin_user

    model_admin.save_model(request, generated, form, True)

    event = AuditEvent.objects.filter(
        action=AuditAction.ASSESSMENT_STARTED,
    ).latest("occurred_at")
    assert event.actor == admin_user


def test_editing_a_sessions_details_is_audited_and_a_resend_is_not() -> None:
    session = grading_session(title="Spring grading", location="Hall A")
    client = auth_client("session-detail-editor@example.com")
    url = f"/api/gradings/sessions/{session.pk}/"

    first = client.patch(url, {"title": "Spring grading", "location": "Hall B"})
    resent = client.patch(url, {"title": " Spring grading ", "location": "Hall B "})

    assert first.status_code == resent.status_code == 200
    [event] = AuditEvent.objects.filter(
        action=AuditAction.SESSION_UPDATED,
        entity_id=str(session.pk),
    )
    assert event.metadata == {
        "before": {"location": "Hall A"},
        "after": {"location": "Hall B"},
    }
    assert event.actor is not None
    assert event.actor.email == "session-detail-editor@example.com"


def test_an_admin_session_edit_records_the_same_event() -> None:
    session = grading_session(notes="Bring belts")
    session.notes = "Bring belts and water"
    admin_user = user("session-admin-editor@example.com")
    request = cast(HttpRequest, RequestFactory().post("/admin/"))
    request.user = admin_user

    GradingSessionAdmin(GradingSession, admin.site).save_model(
        request,
        session,
        cast("ModelForm[Any]", SimpleNamespace(changed_data=["notes"])),
        True,
    )

    event = AuditEvent.objects.get(action=AuditAction.SESSION_UPDATED)
    assert event.actor == admin_user
    assert event.metadata["after"] == {"notes": "Bring belts and water"}


def served_progress(session: GradingSession) -> dict[str, int]:
    row = auth_client("session-progress-reader@example.com").get(
        f"/api/gradings/sessions/{session.pk}/",
    )
    assert row.status_code == 200
    body = row.json()
    return {
        name: body[name]
        for name in (
            "candidate_count",
            "completed_assessment_count",
            "awaiting_decision_count",
        )
    }


def test_open_session_progress_counts_only_completed_assessments() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    assessment(candidate=candidate(session=session))  # not started
    start_assessment(assessment(candidate=candidate(session=session)))
    complete_assessment(assessment(candidate=candidate(session=session)))
    candidate(session=session)  # no assessment yet
    candidate(session=session, status=GradingCandidate.Status.WITHDRAWN)

    assert served_progress(session) == {
        "candidate_count": 4,
        "completed_assessment_count": 1,
        "awaiting_decision_count": 1,
    }


def test_awaiting_decision_excludes_finalised_outcomes() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    decided, proposed, undecided = (candidate(session=session) for _ in range(3))
    for built in (decided, proposed, undecided):
        complete_assessment(assessment(candidate=built))
    candidate(session=session, status=GradingCandidate.Status.WITHDRAWN)
    transition_grading_session(session, GradingSession.Status.LOCKED)
    finalised_outcome(decided)
    propose_candidate_outcome(
        create_candidate_outcome(proposed, user("progress-outcome@example.com")),
        CandidateOutcome.Outcome.PASS,
        "Ready.",
        user("progress-proposer@example.com"),
    )

    assert served_progress(session) == {
        "candidate_count": 3,
        "completed_assessment_count": 3,
        "awaiting_decision_count": 2,
    }


def test_listing_sessions_counts_progress_without_a_query_per_session() -> None:
    client = auth_client("session-progress-list@example.com")
    grading_session(title="First")
    # The first request also loads the user's permissions; measure after it.
    client.get("/api/gradings/sessions/")

    with CaptureQueriesContext(connection) as one:
        assert client.get("/api/gradings/sessions/").status_code == 200
    for title in ("Second", "Third", "Fourth"):
        candidate(session=grading_session(title=title))
    with CaptureQueriesContext(connection) as many:
        response = client.get("/api/gradings/sessions/")

    assert response.json()["count"] == GradingSession.objects.count() > 1
    assert len(many.captured_queries) == len(one.captured_queries)
