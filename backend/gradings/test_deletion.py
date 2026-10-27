"""Deletion rules holding from every path: model, queryset, API and admin."""

from __future__ import annotations

from typing import cast

import pytest
from django.contrib import admin
from django.contrib.auth.models import Permission
from django.contrib.messages.storage.fallback import FallbackStorage
from django.contrib.sessions.backends.db import SessionStore
from django.core.exceptions import ValidationError
from django.http import HttpRequest
from django.test import RequestFactory
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditAction, AuditEvent
from gradings.admin import (
    GradingSessionAdmin,
)
from gradings.models import (
    CandidateAssessment,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    Promotion,
)
from gradings.outcome_services import promote_candidate
from gradings.services import delete_grading_session, transition_grading_session
from gradings.testing import (
    assessment,
    auth_client,
    candidate,
    finalised_outcome,
    grading_session,
    locked_completed_candidate,
    locked_session_with_undecided_candidate,
    override_master,
    promoter,
    rank,
    start_assessment,
    user,
)
from students.models import Student

pytestmark = pytest.mark.django_db


def test_session_api_delete_rules_work() -> None:
    draft = grading_session(status=GradingSession.Status.DRAFT)
    open_session = grading_session(status=GradingSession.Status.OPEN)
    locked = grading_session(status=GradingSession.Status.LOCKED)
    completed = grading_session(status=GradingSession.Status.COMPLETED)
    cancelled = grading_session(status=GradingSession.Status.CANCELLED)
    client = auth_client("session-delete@example.com")

    open_delete_response = client.delete(f"/api/gradings/sessions/{open_session.id}/")
    assert open_delete_response.status_code == 400
    assert client.delete(f"/api/gradings/sessions/{locked.id}/").status_code == 400
    assert client.delete(f"/api/gradings/sessions/{completed.id}/").status_code == 400
    assert client.delete(f"/api/gradings/sessions/{draft.id}/").status_code == 204
    assert client.delete(f"/api/gradings/sessions/{cancelled.id}/").status_code == 204


def test_delete_cancelled_session_rules() -> None:
    u1 = user("creator-del-1@example.com")
    u2 = user("creator-del-2@example.com")
    u3 = user("creator-del-3@example.com")
    client = auth_client("delete-cancelled-test@example.com")

    # 1. Cancelled session with no candidates deletes cleanly
    empty_cancelled = grading_session(
        status=GradingSession.Status.CANCELLED,
        created_by=u1,
    )
    resp = client.delete(f"/api/gradings/sessions/{empty_cancelled.id}/")
    assert resp.status_code == 204
    assert not GradingSession.objects.filter(id=empty_cancelled.id).exists()
    assert AuditEvent.objects.filter(
        action=AuditAction.SESSION_DELETED,
        entity_id=str(empty_cancelled.id),
    ).exists()

    # 2. Cancelled session with NOT_STARTED candidate assessment deletes cleanly
    session_with_unstarted = grading_session(
        status=GradingSession.Status.OPEN,
        created_by=u2,
    )
    cand1 = candidate(session=session_with_unstarted)
    assessment(candidate=cand1, status=CandidateAssessment.Status.NOT_STARTED)
    GradingSession.objects.filter(pk=session_with_unstarted.pk).update(
        status=GradingSession.Status.CANCELLED
    )
    resp2 = client.delete(f"/api/gradings/sessions/{session_with_unstarted.id}/")
    assert resp2.status_code == 204
    assert not GradingSession.objects.filter(id=session_with_unstarted.id).exists()

    # 3. Cancelled session with candidate whose assessment has started cannot be deleted
    session_with_started = grading_session(
        status=GradingSession.Status.OPEN,
        created_by=u3,
    )
    cand2 = candidate(session=session_with_started)
    ass2 = assessment(candidate=cand2)
    start_assessment(ass2)
    GradingSession.objects.filter(pk=session_with_started.pk).update(
        status=GradingSession.Status.CANCELLED
    )
    resp3 = client.delete(f"/api/gradings/sessions/{session_with_started.id}/")
    assert resp3.status_code == 400
    assert "assessment work has already been recorded" in str(resp3.data)
    assert GradingSession.objects.filter(id=session_with_started.id).exists()


def test_session_delete_rule_holds_from_model_delete() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)

    with pytest.raises(ValidationError):
        session.delete()

    assert GradingSession.objects.filter(pk=session.pk).exists()


def test_session_delete_rule_holds_from_queryset_delete() -> None:
    # QuerySet.delete() does not call Model.delete(); before this it was the
    # simplest way to walk past the rule entirely.
    session = grading_session(status=GradingSession.Status.OPEN)

    with pytest.raises(ValidationError):
        GradingSession.objects.filter(pk=session.pk).delete()

    assert GradingSession.objects.filter(pk=session.pk).exists()


def test_session_delete_rule_blocks_a_whole_bulk_selection() -> None:
    deletable = grading_session(status=GradingSession.Status.DRAFT)
    blocked = grading_session(status=GradingSession.Status.OPEN)

    with pytest.raises(ValidationError):
        GradingSession.objects.filter(pk__in=[deletable.pk, blocked.pk]).delete()

    # All or nothing: the deletable row must not vanish alongside the refusal.
    assert GradingSession.objects.filter(pk=deletable.pk).exists()
    assert GradingSession.objects.filter(pk=blocked.pk).exists()


def test_draft_session_still_deletes_from_every_path() -> None:
    by_model = grading_session(status=GradingSession.Status.DRAFT)
    by_queryset = grading_session(status=GradingSession.Status.CANCELLED)

    by_model.delete()
    GradingSession.objects.filter(pk=by_queryset.pk).delete()

    assert not GradingSession.objects.filter(
        pk__in=[by_model.pk, by_queryset.pk],
    ).exists()


def test_candidate_delete_rule_holds_from_model_and_queryset() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)

    with pytest.raises(ValidationError):
        built.delete()
    with pytest.raises(ValidationError):
        GradingCandidate.objects.filter(pk=built.pk).delete()

    assert GradingCandidate.objects.filter(pk=built.pk).exists()


def test_candidate_delete_rule_holds_through_the_related_manager() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)

    with pytest.raises(ValidationError):
        session.candidates.all().delete()

    assert GradingCandidate.objects.filter(pk=built.pk).exists()


def test_admin_hides_delete_for_a_session_that_cannot_be_deleted() -> None:
    # A non-administrator: the ordinary DRAFT/CANCELLED-only gate applies,
    # same as the API. An administrator's extra power is covered by
    # test_admin_shows_delete_for_any_status_to_an_administrator below -
    # request.user is threaded into the validator, so this must use a
    # non-admin to still exercise the gate.
    request = RequestFactory().get("/admin/")
    request.user = user("delete-instructor@example.com")
    model_admin = GradingSessionAdmin(GradingSession, admin.site)

    open_session = grading_session(status=GradingSession.Status.OPEN)
    draft_session = grading_session(status=GradingSession.Status.DRAFT)

    assert model_admin.has_delete_permission(request, open_session) is False
    assert model_admin.has_delete_permission(request, draft_session) is True
    # The changelist still offers the action; delete_queryset does the check.
    assert model_admin.has_delete_permission(request, None) is True


def test_admin_shows_delete_for_any_status_to_an_administrator() -> None:
    # Regression test: has_delete_permission used to call the validator with
    # no actor at all, so an administrator's override in
    # validate_session_can_be_deleted could never engage through Django
    # admin - Delete stayed hidden for LOCKED/COMPLETED sessions even for a
    # real administrator, unlike the identical case through the API.
    request = RequestFactory().get("/admin/")
    request.user = user(
        "delete-admin-any-status@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    model_admin = GradingSessionAdmin(GradingSession, admin.site)

    for status in (
        GradingSession.Status.OPEN,
        GradingSession.Status.LOCKED,
        GradingSession.Status.COMPLETED,
    ):
        session = grading_session(status=status)
        assert model_admin.has_delete_permission(request, session) is True


def test_admin_bulk_delete_refuses_the_whole_selection() -> None:
    request = RequestFactory().post("/admin/")
    request.user = user("bulk-instructor@example.com")
    request.session = SessionStore()
    request._messages = FallbackStorage(request)  # type: ignore[attr-defined]
    model_admin = GradingSessionAdmin(GradingSession, admin.site)

    deletable = grading_session(status=GradingSession.Status.DRAFT)
    blocked = grading_session(status=GradingSession.Status.OPEN)

    model_admin.delete_queryset(
        request,
        GradingSession.objects.filter(pk__in=[deletable.pk, blocked.pk]),
    )

    assert GradingSession.objects.filter(pk=deletable.pk).exists()
    assert GradingSession.objects.filter(pk=blocked.pk).exists()


def test_admin_bulk_delete_by_an_administrator_reaches_any_status() -> None:
    request = RequestFactory().post("/admin/")
    request.user = user(
        "bulk-admin-any-status@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    request.session = SessionStore()
    request._messages = FallbackStorage(request)  # type: ignore[attr-defined]
    model_admin = GradingSessionAdmin(GradingSession, admin.site)

    draft = grading_session(status=GradingSession.Status.DRAFT)
    open_session = grading_session(status=GradingSession.Status.OPEN)

    model_admin.delete_queryset(
        request,
        GradingSession.objects.filter(pk__in=[draft.pk, open_session.pk]),
    )

    assert not GradingSession.objects.filter(
        pk__in=[draft.pk, open_session.pk],
    ).exists()


def test_admin_delete_model_on_a_locked_session_cascades_through_the_service() -> None:
    # Proves delete_model routes through delete_grading_session rather than
    # a bare obj.delete() - without that, an administrator deleting a
    # LOCKED/COMPLETED session with a finalised outcome and promotion would
    # hit ProtectedError (Promotion.outcome/CandidateOutcome.assessment are
    # both PROTECT) instead of cascading, even with has_delete_permission
    # now correctly returning True for them.
    built, _generated = locked_completed_candidate()
    session = built.session
    outcome = finalised_outcome(built)
    promotion = promote_candidate(
        outcome,
        promoter("admin-delete-model-cascade@example.com"),
    )
    student_row = built.student
    student_row.refresh_from_db()

    request = RequestFactory().post("/admin/")
    request.user = user(
        "delete-model-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    model_admin = GradingSessionAdmin(GradingSession, admin.site)
    session_pk = session.pk

    model_admin.delete_model(request, session)

    assert not GradingSession.objects.filter(pk=session_pk).exists()
    assert not Promotion.objects.filter(pk=promotion.pk).exists()
    assert not CandidateOutcome.objects.filter(pk=outcome.pk).exists()
    student_row.refresh_from_db()
    assert student_row.current_rank == promotion.from_rank
    assert AuditEvent.objects.filter(
        entity_type="GradingSession",
        entity_id=str(session_pk),
        action=AuditAction.SESSION_DELETED,
    ).exists()


def test_admin_bulk_delete_proceeds_when_every_row_is_deletable() -> None:
    request = RequestFactory().post("/admin/")
    request.user = User.objects.create_superuser("bulk-ok-admin@example.com")
    request.session = SessionStore()
    request._messages = FallbackStorage(request)  # type: ignore[attr-defined]
    model_admin = GradingSessionAdmin(GradingSession, admin.site)

    first = grading_session(status=GradingSession.Status.DRAFT)
    second = grading_session(status=GradingSession.Status.CANCELLED)

    model_admin.delete_queryset(
        request,
        GradingSession.objects.filter(pk__in=[first.pk, second.pk]),
    )

    assert not GradingSession.objects.filter(pk__in=[first.pk, second.pk]).exists()


def test_cancelled_session_with_recorded_marking_cannot_be_deleted() -> None:
    # Deleting it would cascade real assessment work away, and there is no
    # audit trail to reconstruct it from.
    session, built = locked_session_with_undecided_candidate()
    transition_grading_session(
        session,
        GradingSession.Status.CANCELLED,
        actor=override_master("cancel-then-delete@example.com"),
        reason="Abandoned mid-grading.",
    )
    session.refresh_from_db()

    with pytest.raises(ValidationError) as exc_info:
        session.delete()

    assert "assessment work" in str(exc_info.value)
    assert GradingSession.objects.filter(pk=session.pk).exists()
    assert GradingCandidate.objects.filter(pk=built.pk).exists()


def test_cancelled_session_with_recorded_marking_deletable_by_administrator() -> None:
    # Administrators can override the guard deliberately - the audit event
    # recorded by delete_grading_session is the trail in that case.
    session, built = locked_session_with_undecided_candidate()
    transition_grading_session(
        session,
        GradingSession.Status.CANCELLED,
        actor=override_master("cancel-then-admin-delete@example.com"),
        reason="Abandoned mid-grading.",
    )
    session.refresh_from_db()
    admin = user(
        "override-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )

    session.delete(actor=admin)

    assert not GradingSession.objects.filter(pk=session.pk).exists()
    assert not GradingCandidate.objects.filter(pk=built.pk).exists()


def test_api_admin_can_delete_cancelled_session_with_recorded_marking() -> None:
    session, _built = locked_session_with_undecided_candidate()
    transition_grading_session(
        session,
        GradingSession.Status.CANCELLED,
        actor=override_master("cancel-then-api-admin-delete@example.com"),
        reason="Abandoned mid-grading.",
    )
    session.refresh_from_db()

    client = APIClient()
    client.force_authenticate(
        user=user("api-override-admin@example.com", role=User.Role.ADMINISTRATOR),
    )
    resp = client.delete(f"/api/gradings/sessions/{session.id}/")

    assert resp.status_code == 204
    assert not GradingSession.objects.filter(pk=session.pk).exists()
    assert AuditEvent.objects.filter(
        action=AuditAction.SESSION_DELETED,
        entity_id=str(session.id),
    ).exists()


def test_non_administrator_cannot_delete_a_locked_or_completed_session() -> None:
    for status in (GradingSession.Status.LOCKED, GradingSession.Status.COMPLETED):
        session = grading_session(status=status)
        instructor = user(f"no-cascade-delete-{status}@example.com")

        with pytest.raises(ValidationError):
            session.delete(actor=instructor)

        assert GradingSession.objects.filter(pk=session.pk).exists()


def test_locked_session_with_finalised_outcomes_and_promotions_deletable_by_administrator() -> (  # noqa: E501
    None
):
    built, generated = locked_completed_candidate()
    session = built.session
    outcome = finalised_outcome(built)
    actor = promoter("session-cascade-delete@example.com")
    promotion = promote_candidate(outcome, actor)
    student_row = built.student
    student_row.refresh_from_db()
    assert student_row.current_rank == promotion.to_rank

    admin = user(
        "session-cascade-delete-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    events_before = AuditEvent.objects.count()
    session_pk = session.pk

    delete_grading_session(session, actor=admin)

    student_row.refresh_from_db()
    assert student_row.current_rank == promotion.from_rank
    assert not GradingSession.objects.filter(pk=session_pk).exists()
    assert not GradingCandidate.objects.filter(pk=built.pk).exists()
    assert not CandidateAssessment.objects.filter(pk=generated.pk).exists()
    assert not CandidateOutcome.objects.filter(pk=outcome.pk).exists()
    assert not Promotion.objects.filter(pk=promotion.pk).exists()

    cascade_event = AuditEvent.objects.filter(
        entity_type="GradingSession",
        entity_id=str(session_pk),
        action=AuditAction.SESSION_DELETED,
    ).get()
    assert cascade_event.metadata["reverted_student_ranks"] == [
        {
            "student_id": student_row.pk,
            "student_wksa_id": student_row.wksa_id,
            "from": promotion.to_rank.code,
            "to": promotion.from_rank.code,
        },
    ]
    assert AuditEvent.objects.count() == events_before + 1


def test_any_status_session_delete_follows_the_permission_not_the_role() -> None:
    # An instructor granted the permission directly may delete a locked
    # session; nothing about the decision reads User.role.
    session = grading_session(status=GradingSession.Status.LOCKED)
    granted = user("delete-any-granted@example.com")
    granted.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="gradings",
            codename="delete_any_gradingsession",
        ),
    )

    delete_grading_session(session, actor=User.objects.get(pk=granted.pk))

    assert not GradingSession.objects.filter(pk=session.pk).exists()


def test_completed_session_is_deletable_by_administrator() -> None:
    session = grading_session(status=GradingSession.Status.COMPLETED)
    admin = user(
        "completed-session-delete-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )

    session.delete(actor=admin)

    assert not GradingSession.objects.filter(pk=session.pk).exists()


def test_session_delete_with_a_superseded_promotion_is_refused_and_deletes_nothing() -> (  # noqa: E501
    None
):
    built, _generated = locked_completed_candidate()
    session = built.session
    outcome = finalised_outcome(built)
    actor = promoter("session-delete-later-promotion@example.com")
    promotion = promote_candidate(outcome, actor)

    # The student has since been promoted again through a second, separate
    # grading - this promotion is no longer "the" record of the student's
    # rank, so cascading the whole session away would silently corrupt it.
    student_row = built.student
    student_row.refresh_from_db()
    Student.objects.filter(pk=student_row.pk).update(current_rank=rank("YELLOW"))

    admin = user(
        "session-delete-later-promotion-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )

    with pytest.raises(ValidationError):
        delete_grading_session(session, actor=admin)

    assert GradingSession.objects.filter(pk=session.pk).exists()
    assert GradingCandidate.objects.filter(pk=built.pk).exists()
    assert CandidateOutcome.objects.filter(pk=outcome.pk).exists()
    assert Promotion.objects.filter(pk=promotion.pk).exists()


def test_api_admin_can_delete_locked_session_with_finalised_outcomes() -> None:
    built, _generated = locked_completed_candidate()
    session = built.session
    outcome = finalised_outcome(built)
    promote_candidate(outcome, promoter("session-cascade-delete-api@example.com"))

    client = APIClient()
    client.force_authenticate(
        user=user(
            "session-cascade-delete-api-admin@example.com",
            role=User.Role.ADMINISTRATOR,
        ),
    )
    response = client.delete(f"/api/gradings/sessions/{session.id}/")

    assert response.status_code == 204
    assert not GradingSession.objects.filter(pk=session.pk).exists()
    assert AuditEvent.objects.filter(
        action=AuditAction.SESSION_DELETED,
        entity_id=str(session.id),
    ).exists()


def test_cancelled_session_without_marking_is_still_deletable() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    candidate(session=session)
    transition_grading_session(session, GradingSession.Status.CANCELLED)
    session.refresh_from_db()

    session.delete()

    assert not GradingSession.objects.filter(pk=session.pk).exists()


def test_admin_deletes_a_locked_session_with_a_promotion_through_the_service() -> None:
    # Django's own collector would refuse: the promotion is PROTECT. The
    # service reverts the rank and removes the history itself, as the API
    # lets an administrator do.
    built, _generated = locked_completed_candidate()
    promote_candidate(
        finalised_outcome(built),
        promoter("admin-delete-promoter@example.com"),
    )
    session = built.session
    request = cast(HttpRequest, RequestFactory().post("/admin/"))
    request.user = user(
        "admin-session-deleter@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    model_admin = GradingSessionAdmin(GradingSession, admin.site)

    _deleted, _counts, perms_needed, protected = model_admin.get_deleted_objects(
        [session],
        request,
    )
    model_admin.delete_model(request, session)

    assert perms_needed == set() and protected == []
    assert not GradingSession.objects.filter(pk=session.pk).exists()
    assert not Promotion.objects.filter(grading_candidate_id=built.pk).exists()
    assert AuditEvent.objects.filter(
        action=AuditAction.SESSION_DELETED,
        actor=request.user,
    ).exists()
