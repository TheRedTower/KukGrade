"""Grading candidates: registration, withdrawal, bulk operations and the API."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import patch

import pytest
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.forms import ModelForm
from django.http import HttpRequest
from django.test import RequestFactory
from rest_framework.test import APIClient

from audit.models import AuditAction, AuditEvent
from gradings.admin import (
    GradingCandidateAdmin,
)
from gradings.age import resolve_age_band
from gradings.models import (
    CandidateAssessment,
    GradingCandidate,
    GradingSession,
)
from gradings.services import (
    apply_candidate_update,
    build_candidate,
    bulk_register_candidates,
    register_candidate,
)
from gradings.testing import (
    admin_request,
    assessment,
    auth_client,
    candidate,
    earlier_double_registration,
    grading_session,
    rank,
    start_assessment,
    student,
    user,
)
from kukgrade.testing import results
from students.models import Student
from syllabus.models import AgeBand

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize(
    ("dob", "grading_date", "expected"),
    [
        (date(2019, 6, 1), date(2027, 6, 1), AgeBand.AGE_8_AND_UNDER),
        (date(2018, 6, 1), date(2027, 6, 1), AgeBand.AGE_9_TO_12),
        (date(2015, 6, 1), date(2027, 6, 1), AgeBand.AGE_9_TO_12),
        (date(2014, 6, 1), date(2027, 6, 1), AgeBand.AGE_13_TO_17),
        (date(2010, 6, 1), date(2027, 6, 1), AgeBand.AGE_13_TO_17),
        (date(2009, 6, 1), date(2027, 6, 1), AgeBand.AGE_18_AND_OVER),
        (date(2014, 12, 31), date(2027, 6, 1), AgeBand.AGE_9_TO_12),
        # The day before each band's first birthday is still the band below.
        (date(2018, 6, 2), date(2027, 6, 1), AgeBand.AGE_8_AND_UNDER),
        (date(2014, 6, 2), date(2027, 6, 1), AgeBand.AGE_9_TO_12),
        (date(2009, 6, 2), date(2027, 6, 1), AgeBand.AGE_13_TO_17),
        # Every band edge of a 29 February birth falls in a common year, where
        # the birthday counts from 1 March.
        (date(2012, 2, 29), date(2021, 2, 28), AgeBand.AGE_8_AND_UNDER),
        (date(2012, 2, 29), date(2021, 3, 1), AgeBand.AGE_9_TO_12),
        (date(2012, 2, 29), date(2025, 2, 28), AgeBand.AGE_9_TO_12),
        (date(2012, 2, 29), date(2025, 3, 1), AgeBand.AGE_13_TO_17),
        (date(2008, 2, 29), date(2026, 2, 28), AgeBand.AGE_13_TO_17),
        (date(2008, 2, 29), date(2026, 3, 1), AgeBand.AGE_18_AND_OVER),
    ],
)
def test_age_band_helper(dob: date, grading_date: date, expected: str) -> None:
    assert resolve_age_band(dob, grading_date) == expected


def test_valid_grading_candidate_can_be_created_with_derived_age_band() -> None:
    built = candidate()

    assert built.pk is not None
    assert built.age_band == AgeBand.AGE_9_TO_12
    assert built.status == GradingCandidate.Status.REGISTERED


def test_candidate_age_band_is_not_recalculated_after_student_dob_changes() -> None:
    built = candidate()

    built.student.date_of_birth = date(2000, 1, 1)
    built.student.save()
    built.refresh_from_db()

    assert built.age_band == AgeBand.AGE_9_TO_12


def test_duplicate_student_session_candidate_rejected() -> None:
    session = grading_session()
    candidate_student = student()
    candidate(session=session, student=candidate_student)

    with pytest.raises(ValidationError):
        candidate(session=session, student=candidate_student)


def test_invalid_candidate_age_band_rejected_at_database_level() -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        GradingCandidate.objects.bulk_create(
            [
                GradingCandidate(
                    session=grading_session(),
                    student=student(),
                    from_rank=rank("WHITE"),
                    testing_for_rank=rank("YELLOW_STRIPE"),
                    age_band="INVALID",
                ),
            ],
        )


def test_invalid_candidate_status_rejected_at_database_level() -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        GradingCandidate.objects.bulk_create(
            [
                GradingCandidate(
                    session=grading_session(),
                    student=student(),
                    from_rank=rank("WHITE"),
                    testing_for_rank=rank("YELLOW_STRIPE"),
                    age_band=AgeBand.AGE_9_TO_12,
                    status="INVALID",
                ),
            ],
        )


def test_student_deletion_blocked_by_protect() -> None:
    built = candidate()

    with pytest.raises(ProtectedError):
        built.student.delete()


def test_rank_deletion_blocked_by_protect() -> None:
    built = candidate()

    with pytest.raises(ProtectedError):
        built.testing_for_rank.delete()


def test_candidate_deleted_when_session_is_deleted() -> None:
    session = grading_session()
    built = candidate(session=session)

    session.delete()

    assert not GradingCandidate.objects.filter(pk=built.pk).exists()


def test_next_rank_validation_accepts_next_active_rank() -> None:
    built = candidate(testing_for_rank=rank("YELLOW_STRIPE"))

    assert built.testing_for_rank.code == "YELLOW_STRIPE"


def test_next_rank_validation_skips_inactive_ranks() -> None:
    yellow_stripe = rank("YELLOW_STRIPE")
    yellow_stripe.active = False
    yellow_stripe.save()

    built = candidate(testing_for_rank=rank("YELLOW"))

    assert built.testing_for_rank.code == "YELLOW"


def test_next_rank_validation_rejects_student_at_highest_active_rank() -> None:
    highest_student = student(current_rank=rank("PKJN"))

    with pytest.raises(ValidationError) as exc_info:
        candidate(student=highest_student, testing_for_rank=rank("PKJN"))

    assert exc_info.value.message_dict["testing_for_rank"] == [
        "Student has no next active rank.",
    ]


@pytest.mark.parametrize("target_code", ["WHITE", "YELLOW", "BLUE_STRIPE"])
def test_next_rank_validation_rejects_same_lower_or_skipped_rank(
    target_code: str,
) -> None:
    with pytest.raises(ValidationError):
        candidate(testing_for_rank=rank(target_code))


@pytest.mark.parametrize(
    "session_status",
    [
        GradingSession.Status.LOCKED,
        GradingSession.Status.COMPLETED,
        GradingSession.Status.CANCELLED,
    ],
)
def test_candidate_creation_rejected_for_closed_session_states(
    session_status: str,
) -> None:
    session = grading_session(status=session_status)

    with pytest.raises(ValidationError):
        candidate(session=session)


@pytest.mark.parametrize(
    "session_status",
    [
        GradingSession.Status.LOCKED,
        GradingSession.Status.COMPLETED,
        GradingSession.Status.CANCELLED,
    ],
)
def test_candidate_update_rejected_for_locked_or_terminal_session(
    session_status: str,
) -> None:
    built = candidate()
    GradingSession.objects.filter(pk=built.session_id).update(status=session_status)
    built.session.refresh_from_db()
    built.notes = "Changed after close"

    with pytest.raises(ValidationError) as exc_info:
        built.save()

    assert "session" in exc_info.value.message_dict


def test_candidate_api_requires_authentication() -> None:
    response = APIClient().get("/api/gradings/candidates/")

    assert response.status_code == 403


def test_noop_candidate_update_records_no_audit_event() -> None:
    # Matches the rule students/services.py and accounts/services.py already
    # apply: resending the same values is not a change, and an audit trail
    # exists to show what changed - nothing did here.
    built = candidate()
    before = AuditEvent.objects.filter(action=AuditAction.CANDIDATE_UPDATED).count()

    apply_candidate_update(
        built,
        status=built.status,
        notes=built.notes,
        actor=user("noop-candidate-actor@example.com"),
    )

    after = AuditEvent.objects.filter(action=AuditAction.CANDIDATE_UPDATED).count()
    assert after == before


def test_real_candidate_update_records_exactly_one_event_with_full_metadata() -> None:
    built = candidate(notes="Original note")

    updated = apply_candidate_update(
        built,
        notes="Changed note",
        actor=user("real-candidate-update-actor@example.com"),
    )

    events = AuditEvent.objects.filter(
        action=AuditAction.CANDIDATE_UPDATED,
        entity_id=str(updated.pk),
    )
    assert events.count() == 1
    metadata = events.get().metadata
    assert metadata["before"]["notes"] == "Original note"
    assert metadata["after"]["notes"] == "Changed note"
    assert metadata["before"]["session"] == built.session_id
    assert metadata["after"]["session"] == built.session_id


def test_admin_created_candidate_is_persisted_and_audited() -> None:
    # Previously this called build_candidate() (unsaved) and relied on the
    # plain ModelAdmin save to persist it, so register_candidate()'s audit
    # call never ran.
    session = grading_session()
    learner = student()
    obj = GradingCandidate(
        session=session,
        student=learner,
        testing_for_rank=rank("YELLOW_STRIPE"),
        status=GradingCandidate.Status.REGISTERED,
        notes="",
    )
    model_admin = GradingCandidateAdmin(GradingCandidate, admin.site)
    admin_user = user("admin-candidate-creator@example.com")
    request = cast(HttpRequest, RequestFactory().post("/admin/"))
    request.user = admin_user

    model_admin.save_model(
        request,
        obj,
        cast("ModelForm[Any]", SimpleNamespace(changed_data=[])),
        False,
    )

    assert obj.pk is not None
    assert GradingCandidate.objects.filter(pk=obj.pk).exists()
    event = AuditEvent.objects.filter(
        action=AuditAction.CANDIDATE_REGISTERED,
        entity_id=str(obj.pk),
    ).latest("occurred_at")
    assert event.actor == admin_user


def test_admin_candidate_update_is_audited() -> None:
    built = candidate(notes="Before")
    model_admin = GradingCandidateAdmin(GradingCandidate, admin.site)
    built.notes = "After"
    form = cast(
        "ModelForm[Any]", SimpleNamespace(changed_data=["notes"], cleaned_data={})
    )
    admin_user = user("admin-candidate-updater@example.com")
    request = cast(HttpRequest, RequestFactory().post("/admin/"))
    request.user = admin_user

    model_admin.save_model(request, built, form, True)

    built.refresh_from_db()
    assert built.notes == "After"
    event = AuditEvent.objects.filter(
        action=AuditAction.CANDIDATE_UPDATED,
        entity_id=str(built.pk),
    ).latest("occurred_at")
    assert event.actor == admin_user


def test_authenticated_candidate_crud_and_age_band_spoofing_rejected() -> None:
    session = grading_session()
    candidate_student = student(date_of_birth=date(2017, 3, 20))
    client = auth_client("candidate-crud@example.com")

    create_response = client.post(
        "/api/gradings/candidates/bulk-register/",
        {
            "session": session.id,
            "candidates": [
                {
                    "student": candidate_student.id,
                    "testing_for_rank": rank("YELLOW_STRIPE").id,
                    "age_band": AgeBand.AGE_18_AND_OVER,
                    "notes": "Ready",
                },
            ],
        },
        format="json",
    )

    assert create_response.status_code == 200
    payload = create_response.json()["created"][0]["candidate"]
    stored = GradingCandidate.objects.get(pk=payload["id"])
    assert stored.age_band == AgeBand.AGE_9_TO_12
    assert payload["student_wksa_id"] == candidate_student.wksa_id
    assert stored.testing_for_rank.code == "YELLOW_STRIPE"

    detail_response = client.get(f"/api/gradings/candidates/{payload['id']}/")
    other_session = grading_session(title="Move target")
    patch_response = client.patch(
        f"/api/gradings/candidates/{payload['id']}/",
        {"session": other_session.id},
        format="json",
    )
    delete_response = client.delete(f"/api/gradings/candidates/{payload['id']}/")

    assert detail_response.status_code == 200
    assert patch_response.status_code == 200
    assert patch_response.json()["session"] == other_session.id
    assert delete_response.status_code == 204


def test_registration_is_only_through_bulk_register() -> None:
    response = auth_client("single-register@example.com").post(
        "/api/gradings/candidates/",
        {
            "session": grading_session().id,
            "student": student().id,
            "testing_for_rank": rank("YELLOW_STRIPE").id,
        },
        format="json",
    )

    assert response.status_code == 405
    assert not GradingCandidate.objects.exists()


def test_withdrawing_before_lock_requires_a_reason_and_records_who_and_when() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    client = auth_client("prelock-withdraw@example.com")
    url = "/api/gradings/candidates/bulk-update-status/"

    refused = client.post(
        url,
        {"candidates": [built.pk], "status": "WITHDRAWN"},
        format="json",
    )
    accepted = client.post(
        url,
        {
            "candidates": [built.pk],
            "status": "WITHDRAWN",
            "withdrawal_reason": "INJURY",
            "withdrawal_note": "Wrist",
        },
        format="json",
    )

    assert refused.status_code == 400
    assert "withdrawal_reason" in refused.json()["error"]["fields"]
    assert accepted.status_code == 200
    assert accepted.json()["errors"] == {}
    built.refresh_from_db()
    assert built.status == GradingCandidate.Status.WITHDRAWN
    assert built.withdrawal_reason == "INJURY"
    assert built.withdrawal_note == "Wrist"
    assert built.withdrawn_by is not None and built.withdrawn_at is not None
    event = AuditEvent.objects.filter(entity_id=str(built.pk)).latest("occurred_at")
    assert event.action == AuditAction.CANDIDATE_WITHDRAWN


def test_bulk_no_show_without_a_reason_is_refused() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))

    response = auth_client("bulk-no-reason@example.com").post(
        "/api/gradings/candidates/bulk-update-status/",
        {"candidates": [built.pk], "status": "WITHDRAWN"},
        format="json",
    )

    assert response.status_code == 400
    built.refresh_from_db()
    assert built.status == GradingCandidate.Status.REGISTERED


def test_reinstating_a_withdrawn_candidate_clears_the_withdrawal() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    actor = user("reinstate-actor@example.com")
    apply_candidate_update(
        built, status="WITHDRAWN", withdrawal_reason="ABSENT", actor=actor
    )

    reinstated = apply_candidate_update(built, status="REGISTERED", actor=actor)

    reinstated.refresh_from_db()
    assert reinstated.withdrawal_reason == ""
    assert reinstated.withdrawn_by is None and reinstated.withdrawn_at is None


def test_candidate_patch_changes_nothing_but_the_session() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    other = student(wksa_id="206-2-500")

    response = auth_client("student-swap@example.com").patch(
        f"/api/gradings/candidates/{built.pk}/",
        {
            "student": other.pk,
            "testing_for_rank": rank("BLUE").pk,
            "status": GradingCandidate.Status.COMPLETED,
            "withdrawal_note": "Ignored",
        },
        format="json",
    )

    assert response.status_code == 200
    unchanged = GradingCandidate.objects.get(pk=built.pk)
    assert unchanged.student_id == built.student_id
    assert unchanged.testing_for_rank_id == built.testing_for_rank_id
    assert unchanged.status == GradingCandidate.Status.REGISTERED
    assert unchanged.withdrawal_note == ""
    assert not AuditEvent.objects.filter(
        action=AuditAction.CANDIDATE_UPDATED,
        entity_id=str(built.pk),
    ).exists()


def test_a_registrations_student_cannot_be_changed() -> None:
    built = candidate()
    built.student = student(wksa_id="206-2-500")

    with pytest.raises(ValidationError):
        built.save()


def test_boolean_filters_accept_only_true_and_false() -> None:
    # One rule for every boolean filter: anything else is an impossible
    # value and returns an empty page, like an unknown choice or bad date.
    client = auth_client("boolean-filters@example.com")
    url = "/api/gradings/legacy-records/?voided="

    assert client.get(url + "false").status_code == 200
    assert client.get(url + "yes").json()["count"] == 0
    assert client.get("/api/gradings/legacy-records/?linked=maybe").json()["count"] == 0


def test_candidate_api_filters_work() -> None:
    session = grading_session()
    candidate_student = student(wksa_id="206-2-501")
    built = candidate(session=session, student=candidate_student)
    candidate(
        session=grading_session(title="Other Session"),
        student=student(wksa_id="206-2-502", first_name="Blair"),
    )
    client = auth_client("candidate-filter@example.com")

    response = client.get(
        f"/api/gradings/candidates/?session={session.id}",
    )

    assert response.status_code == 200
    assert [item["id"] for item in results(response)] == [built.id]


def test_bulk_register_refuses_a_rank_out_of_turn() -> None:
    target = student()

    response = auth_client("candidate-invalid-rank@example.com").post(
        "/api/gradings/candidates/bulk-register/",
        {
            "session": grading_session().id,
            "candidates": [
                {"student": target.id, "testing_for_rank": rank("YELLOW").id},
            ],
        },
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["created"] == []
    assert list(response.json()["errors"]) == ["0"]
    assert not GradingCandidate.objects.filter(student=target).exists()


@pytest.mark.parametrize(
    "session_status",
    [
        GradingSession.Status.LOCKED,
        GradingSession.Status.COMPLETED,
        GradingSession.Status.CANCELLED,
    ],
)
def test_candidate_api_rejects_invalid_session_state_operations(
    session_status: str,
) -> None:
    session = grading_session(status=session_status)
    client = auth_client(f"candidate-state-{session_status.lower()}@example.com")

    response = client.post(
        "/api/gradings/candidates/bulk-register/",
        {
            "session": session.id,
            "candidates": [
                {"student": student().id, "testing_for_rank": rank("YELLOW_STRIPE").id},
            ],
        },
        format="json",
    )

    assert response.status_code == 200
    assert list(response.json()["errors"]) == ["0"]
    assert not GradingCandidate.objects.filter(session=session).exists()


@pytest.mark.parametrize(
    "session_status",
    [
        GradingSession.Status.LOCKED,
        GradingSession.Status.COMPLETED,
        GradingSession.Status.CANCELLED,
    ],
)
def test_candidate_api_rejects_updates_for_locked_or_terminal_session(
    session_status: str,
) -> None:
    built = candidate()
    GradingSession.objects.filter(pk=built.session_id).update(status=session_status)
    built.session.refresh_from_db()
    client = auth_client(f"candidate-update-{session_status.lower()}@example.com")

    original_session_id = built.session_id
    response = client.patch(
        f"/api/gradings/candidates/{built.id}/",
        {"session": grading_session(title="Elsewhere").id},
        format="json",
    )

    assert response.status_code == 400
    built.refresh_from_db()
    assert built.session_id == original_session_id


def test_candidate_api_delete_rules_work() -> None:
    draft_candidate = candidate(
        session=grading_session(status=GradingSession.Status.DRAFT)
    )
    open_candidate = candidate(
        session=grading_session(status=GradingSession.Status.OPEN),
        student=student(wksa_id="206-2-503"),
    )
    locked_candidate = candidate()
    GradingSession.objects.filter(pk=locked_candidate.session_id).update(
        status=GradingSession.Status.LOCKED,
    )
    locked_candidate.session.refresh_from_db()
    client = auth_client("candidate-delete@example.com")

    assert (
        client.delete(f"/api/gradings/candidates/{locked_candidate.id}/").status_code
        == 400
    )
    assert (
        client.delete(f"/api/gradings/candidates/{draft_candidate.id}/").status_code
        == 204
    )
    assert (
        client.delete(f"/api/gradings/candidates/{open_candidate.id}/").status_code
        == 204
    )


def test_candidate_api_serves_whether_it_can_be_moved_or_removed() -> None:
    open_session = grading_session(status=GradingSession.Status.OPEN)
    draft_session = grading_session(
        status=GradingSession.Status.DRAFT,
        title="Draft grading",
    )
    unassessed = candidate(session=open_session, student=student(wksa_id="206-2-504"))
    started = candidate(session=open_session, student=student(wksa_id="206-2-505"))
    start_assessment(assessment(candidate=started))
    prepared = candidate(session=draft_session, student=student(wksa_id="206-2-506"))
    assessment(candidate=prepared)
    client = auth_client("candidate-flags@example.com")

    rows = {row["id"]: row for row in results(client.get("/api/gradings/candidates/"))}

    assert [
        (rows[c.id]["can_be_moved"], rows[c.id]["can_be_removed"])
        for c in (unassessed, started, prepared)
    ] == [(True, True), (False, False), (False, True)]
    assert client.delete(f"/api/gradings/candidates/{started.id}/").status_code == 400
    assert client.delete(f"/api/gradings/candidates/{prepared.id}/").status_code == 204
    assert (
        client.patch(
            f"/api/gradings/candidates/{unassessed.id}/",
            {"session": draft_session.id},
            format="json",
        ).status_code
        == 200
    )


def test_bulk_register_creates_every_candidate_in_one_request() -> None:
    session = grading_session()
    first_student = student(wksa_id="206-2-507")
    second_student = student(wksa_id="206-2-508", first_name="Sam")
    client = auth_client("bulk-register@example.com")

    response = client.post(
        "/api/gradings/candidates/bulk-register/",
        {
            "session": session.id,
            "candidates": [
                {
                    "student": first_student.id,
                    "testing_for_rank": rank("YELLOW_STRIPE").id,
                    "notes": "First candidate",
                },
                {"student": second_student.id},
            ],
        },
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["errors"] == {}
    assert [item["candidate"]["student"] for item in payload["created"]] == [
        first_student.id,
        second_student.id,
    ]
    assert all(item["assessment"] is None for item in payload["created"])
    assert GradingCandidate.objects.filter(session=session).count() == 2
    assert (
        AuditEvent.objects.filter(action=AuditAction.CANDIDATE_REGISTERED).count() == 2
    )


def test_bulk_register_resolves_testing_for_rank_from_each_students_own_belt() -> None:
    # A group is rarely one belt. Mirrors registering a mixed cohort - some
    # blue belts, a couple of white belts, a brown stripe, some browns - in
    # one request with no rank picked at all, and each resolves to that
    # student's own next active rank.
    session = grading_session()
    white_student = student(wksa_id="206-2-509", current_rank=rank("WHITE"))
    blue_student = student(
        wksa_id="206-2-510",
        current_rank=rank("BLUE"),
        first_name="Robin",
    )
    brown_stripe_student = student(
        wksa_id="206-2-511",
        current_rank=rank("BROWN_STRIPE"),
        first_name="Sam",
    )
    client = auth_client("bulk-register-mixed@example.com")

    response = client.post(
        "/api/gradings/candidates/bulk-register/",
        {
            "session": session.id,
            "candidates": [
                {"student": white_student.id},
                {"student": blue_student.id},
                {"student": brown_stripe_student.id},
            ],
        },
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["errors"] == {}
    resolved_ranks = {
        item["candidate"]["student"]: item["candidate"]["testing_for_rank_name"]
        for item in payload["created"]
    }
    assert resolved_ranks == {
        white_student.id: "Yellow Stripe",
        blue_student.id: "Red Stripe",
        brown_stripe_student.id: "Brown",
    }


def test_bulk_register_is_independent_per_row_when_one_row_is_invalid() -> None:
    session = grading_session()
    valid_student = student(wksa_id="206-2-512")
    already_registered_student = student(wksa_id="206-2-513")
    candidate(session=session, student=already_registered_student)
    client = auth_client("bulk-register-partial@example.com")

    response = client.post(
        "/api/gradings/candidates/bulk-register/",
        {
            "session": session.id,
            "candidates": [
                {"student": valid_student.id},
                # Already registered for this session - this row fails, but
                # that must not stop the first row from being registered.
                {"student": already_registered_student.id},
            ],
        },
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["candidate"]["student"] for item in payload["created"]] == [
        valid_student.id,
    ]
    assert list(payload["errors"].keys()) == ["1"]
    assert GradingCandidate.objects.filter(student=valid_student).exists()
    assert (
        GradingCandidate.objects.filter(student=already_registered_student).count() == 1
    )


def test_bulk_register_can_generate_assessments_in_the_same_request() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    first_student = student(wksa_id="206-2-514")
    second_student = student(wksa_id="206-2-515", first_name="Robin")
    client = auth_client("bulk-register-generate@example.com")

    response = client.post(
        "/api/gradings/candidates/bulk-register/",
        {
            "session": session.id,
            "candidates": [
                {"student": first_student.id},
                {"student": second_student.id},
            ],
            "generate_assessments": True,
        },
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["errors"] == {}
    assert all(item["assessment"] is not None for item in payload["created"])
    assert (
        CandidateAssessment.objects.filter(
            candidate__student__in=[first_student, second_student],
        ).count()
        == 2
    )


def test_bulk_register_with_generation_rolls_back_only_the_failing_row() -> None:
    # A student already at the top rank cannot be registered at all (no next
    # active rank to resolve to), but that must not block the other row's
    # registration-and-generation in the same request.
    session = grading_session(status=GradingSession.Status.OPEN)
    registerable_student = student(wksa_id="206-2-516")
    topped_out_student = student(
        wksa_id="A-00517",
        current_rank=rank("PKJN"),
        first_name="Robin",
    )
    client = auth_client("bulk-register-generate-partial@example.com")

    response = client.post(
        "/api/gradings/candidates/bulk-register/",
        {
            "session": session.id,
            "candidates": [
                {"student": registerable_student.id},
                {"student": topped_out_student.id},
            ],
            "generate_assessments": True,
        },
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["candidate"]["student"] for item in payload["created"]] == [
        registerable_student.id,
    ]
    assert payload["created"][0]["assessment"] is not None
    assert list(payload["errors"].keys()) == ["1"]
    assert not GradingCandidate.objects.filter(student=topped_out_student).exists()


def test_bulk_generate_assessments_creates_every_snapshot_in_one_request() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    first_candidate = candidate(session=session, student=student(wksa_id="206-2-518"))
    second_candidate = candidate(session=session, student=student(wksa_id="206-2-519"))
    client = auth_client("bulk-generate@example.com")

    response = client.post(
        "/api/gradings/candidates/bulk-generate-assessments/",
        {"candidates": [first_candidate.id, second_candidate.id]},
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["errors"] == {}
    assert [item["candidate"] for item in payload["created"]] == [
        first_candidate.id,
        second_candidate.id,
    ]
    assert (
        CandidateAssessment.objects.filter(
            candidate_id__in=[first_candidate.id, second_candidate.id],
        ).count()
        == 2
    )


def test_bulk_generate_assessments_is_independent_per_row() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    fresh_candidate = candidate(session=session, student=student(wksa_id="206-2-520"))
    already_assessed = candidate(session=session, student=student(wksa_id="206-2-521"))
    assessment(candidate=already_assessed)
    client = auth_client("bulk-generate-partial@example.com")

    response = client.post(
        "/api/gradings/candidates/bulk-generate-assessments/",
        {"candidates": [fresh_candidate.id, already_assessed.id]},
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["candidate"] for item in payload["created"]] == [fresh_candidate.id]
    assert list(payload["errors"].keys()) == ["1"]
    assert CandidateAssessment.objects.filter(candidate=fresh_candidate).exists()


def test_bulk_start_starts_every_assessment_in_one_request() -> None:
    # A separate, deliberate action - not bundled into generation, so a
    # caller chooses whether to bulk-start assessments or not.
    session = grading_session(status=GradingSession.Status.OPEN)
    first_assessment = assessment(
        candidate=candidate(session=session, student=student(wksa_id="206-2-522")),
    )
    second_assessment = assessment(
        candidate=candidate(session=session, student=student(wksa_id="206-2-523")),
    )
    client = auth_client("bulk-start@example.com")

    response = client.post(
        "/api/gradings/assessments/bulk-start/",
        {"assessments": [first_assessment.id, second_assessment.id]},
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["errors"] == {}
    assert [item["id"] for item in payload["started"]] == [
        first_assessment.id,
        second_assessment.id,
    ]
    assert all(
        item["status"] == CandidateAssessment.Status.IN_PROGRESS
        for item in payload["started"]
    )
    first_assessment.refresh_from_db()
    second_assessment.refresh_from_db()
    assert first_assessment.status == CandidateAssessment.Status.IN_PROGRESS
    assert second_assessment.status == CandidateAssessment.Status.IN_PROGRESS


def test_bulk_start_is_independent_per_row() -> None:
    open_session = grading_session(status=GradingSession.Status.OPEN)
    fresh_assessment = assessment(
        candidate=candidate(
            session=open_session,
            student=student(wksa_id="206-2-524"),
        ),
    )
    # Generated while still draft (allowed), but starting requires the
    # session to already be open - this row fails independently of the
    # first, which is in an open session and starts cleanly.
    draft_session_assessment = assessment(
        candidate=candidate(
            session=grading_session(status=GradingSession.Status.DRAFT),
            student=student(wksa_id="206-2-525"),
        ),
    )
    client = auth_client("bulk-start-partial@example.com")

    response = client.post(
        "/api/gradings/assessments/bulk-start/",
        {"assessments": [fresh_assessment.id, draft_session_assessment.id]},
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["id"] for item in payload["started"]] == [fresh_assessment.id]
    assert list(payload["errors"].keys()) == ["1"]
    fresh_assessment.refresh_from_db()
    draft_session_assessment.refresh_from_db()
    assert fresh_assessment.status == CandidateAssessment.Status.IN_PROGRESS
    assert draft_session_assessment.status == CandidateAssessment.Status.NOT_STARTED


def test_bulk_update_status_confirms_attendance_independently_per_row() -> None:
    # The tick-boxes-then-confirm workflow: select the candidates who did
    # not show up, set them WITHDRAWN in one request, and everyone else is
    # left untouched.
    session = grading_session()
    absent_first = candidate(session=session, student=student(wksa_id="206-2-526"))
    absent_second = candidate(
        session=session,
        student=student(wksa_id="206-2-527", first_name="Robin"),
    )
    client = auth_client("bulk-attendance@example.com")

    response = client.post(
        "/api/gradings/candidates/bulk-update-status/",
        {
            "candidates": [absent_first.id, absent_second.id],
            "status": GradingCandidate.Status.WITHDRAWN,
            "withdrawal_reason": "ABSENT",
        },
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["errors"] == {}
    assert {item["id"] for item in payload["updated"]} == {
        absent_first.id,
        absent_second.id,
    }
    for item in payload["updated"]:
        assert item["withdrawal_reason"] == "ABSENT"
        assert item["withdrawal_reason_display"] == "Did not attend"
    absent_first.refresh_from_db()
    absent_second.refresh_from_db()
    for withdrawn in (absent_first, absent_second):
        assert withdrawn.withdrawn_by is not None
        assert withdrawn.withdrawn_by.email == "bulk-attendance@example.com"
        assert withdrawn.withdrawn_at is not None
    assert absent_first.status == GradingCandidate.Status.WITHDRAWN
    assert absent_second.status == GradingCandidate.Status.WITHDRAWN


def test_bulk_update_status_is_independent_when_one_candidates_session_is_locked() -> (
    None
):
    open_session_candidate = candidate(
        session=grading_session(status=GradingSession.Status.OPEN),
        student=student(wksa_id="206-2-528"),
    )
    locked_session_candidate = candidate(student=student(wksa_id="206-2-529"))
    GradingSession.objects.filter(
        pk=locked_session_candidate.session_id,
    ).update(status=GradingSession.Status.LOCKED)
    client = auth_client("bulk-attendance-partial@example.com")

    response = client.post(
        "/api/gradings/candidates/bulk-update-status/",
        {
            "candidates": [open_session_candidate.id, locked_session_candidate.id],
            "status": GradingCandidate.Status.WITHDRAWN,
            "withdrawal_reason": "ABSENT",
        },
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["id"] for item in payload["updated"]] == [open_session_candidate.id]
    assert list(payload["errors"].keys()) == ["1"]
    open_session_candidate.refresh_from_db()
    locked_session_candidate.refresh_from_db()
    assert open_session_candidate.status == GradingCandidate.Status.WITHDRAWN
    assert locked_session_candidate.status == GradingCandidate.Status.REGISTERED


def test_a_student_who_has_left_cannot_be_registered_for_a_grading() -> None:
    session = grading_session(status=GradingSession.Status.DRAFT)
    learner = student(wksa_id="206-2-530")
    learner.status = Student.Status.LEFT
    learner.save()

    with pytest.raises(ValidationError) as exc_info:
        build_candidate(
            session=session,
            student=learner,
            testing_for_rank=rank("YELLOW_STRIPE"),
        )

    assert "has left" in str(exc_info.value)


def test_an_inactive_student_can_still_be_registered() -> None:
    session = grading_session(status=GradingSession.Status.DRAFT)
    learner = student(wksa_id="206-2-531")
    learner.status = Student.Status.INACTIVE
    learner.save()

    built = build_candidate(
        session=session,
        student=learner,
        testing_for_rank=rank("YELLOW_STRIPE"),
    )
    built.save()

    assert built.pk is not None


def test_bulk_registration_reports_a_duplicate_insert_and_keeps_the_other_rows() -> (
    None
):
    session = grading_session(status=GradingSession.Status.OPEN)
    first, second = student(), student()
    registrar = user("bulk-duplicate-registrar@example.com")

    # Take full_clean()'s duplicate check out of the way so the second row
    # really reaches the INSERT and the database refuses it - what a
    # registration that somehow bypassed the session lock would meet.
    with patch.object(
        GradingCandidate,
        "validate_constraints",
        lambda self, exclude=None: None,
    ):
        created, errors = bulk_register_candidates(
            session=session,
            rows=[{"student": first}, {"student": first}, {"student": second}],
            actor=registrar,
        )

    assert [registered.student_id for registered, _ in created] == [first.pk, second.pk]
    assert errors == {"1": ["Student is already registered for this session."]}
    registered_events = AuditEvent.objects.filter(
        action=AuditAction.CANDIDATE_REGISTERED,
    ).values_list("entity_id", flat=True)
    assert sorted(registered_events) == sorted(
        str(registered.pk) for registered, _ in created
    )


def test_a_move_onto_an_existing_registration_is_refused_by_the_service() -> None:
    # The duplicate is translated where the save happens, so Django admin -
    # which calls the service directly - gets the same refusal the API did,
    # instead of an IntegrityError.
    source = grading_session(status=GradingSession.Status.OPEN, title="Source")
    target = grading_session(status=GradingSession.Status.OPEN, title="Target")
    both = student()
    moving = candidate(session=source, student=both)
    earlier_double_registration(session=target, student=both)

    with (
        patch.object(
            GradingCandidate,
            "validate_constraints",
            lambda self, exclude=None: None,
        ),
        pytest.raises(ValidationError) as refusal,
    ):
        apply_candidate_update(
            moving,
            session=target,
            actor=user("duplicate-mover@example.com"),
        )

    assert refusal.value.message_dict == {
        "student": ["Student is already registered for this session."],
    }
    moving.refresh_from_db()
    assert moving.session_id == source.pk


def test_registration_decides_on_the_student_as_stored_not_as_passed() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    registered_before = student()
    stale = Student.objects.get(pk=registered_before.pk)
    Student.objects.filter(pk=registered_before.pk).update(status=Student.Status.LEFT)

    with pytest.raises(ValidationError):
        register_candidate(
            session=session,
            student=stale,
            testing_for_rank=rank("YELLOW_STRIPE"),
            actor=user("stale-registrar@example.com"),
        )

    assert not GradingCandidate.objects.filter(student=registered_before).exists()


def test_a_no_op_candidate_update_writes_nothing() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    written_at = GradingCandidate.objects.get(pk=built.pk).updated_at

    apply_candidate_update(
        built,
        notes=built.notes,
        status=built.status,
        actor=user("no-op-candidate-editor@example.com"),
    )

    assert GradingCandidate.objects.get(pk=built.pk).updated_at == written_at
    assert not AuditEvent.objects.filter(
        action=AuditAction.CANDIDATE_UPDATED,
        entity_id=str(built.pk),
    ).exists()


def test_admin_candidate_delete_goes_through_the_service() -> None:
    session = grading_session(status=GradingSession.Status.DRAFT)
    built = candidate(session=session)
    request = admin_request("candidate-admin-deleter@example.com")
    model_admin = GradingCandidateAdmin(GradingCandidate, admin.site)

    model_admin.delete_model(request, built)

    assert not GradingCandidate.objects.filter(pk=built.pk).exists()
    deleted = AuditEvent.objects.get(
        action=AuditAction.CANDIDATE_DELETED,
        entity_id=str(built.pk),
    )
    assert deleted.actor == request.user


def _registered_twice_then_promoted_in_first() -> tuple[GradingCandidate, Student]:
    """A student registered in two sessions and promoted from the first."""
    from gradings.outcome_services import promote_candidate
    from gradings.services import transition_grading_session
    from gradings.testing import complete_assessment, finalised_outcome, promoter

    pupil = student()
    first = grading_session(
        title="First", grading_date=date(2027, 3, 20), status=GradingSession.Status.OPEN
    )
    second = grading_session(
        title="Second",
        grading_date=date(2027, 6, 20),
        status=GradingSession.Status.OPEN,
    )
    in_first = candidate(session=first, student=pupil)
    in_second = earlier_double_registration(session=second, student=pupil)
    first_assessment = assessment(candidate=in_first)
    start_assessment(first_assessment)
    complete_assessment(first_assessment)
    transition_grading_session(first, GradingSession.Status.LOCKED)
    in_first.refresh_from_db()
    promote_candidate(finalised_outcome(in_first), promoter())
    pupil.refresh_from_db()
    in_second.refresh_from_db()
    return in_second, pupil


def test_a_registration_overtaken_by_a_promotion_can_still_be_withdrawn() -> None:
    # The testing rank is checked when it is chosen. Re-checking it on every
    # save stranded this registration: no withdrawal, no move, no promotion.
    stale, pupil = _registered_twice_then_promoted_in_first()
    assert pupil.current_rank == stale.testing_for_rank

    apply_candidate_update(
        stale,
        status=GradingCandidate.Status.WITHDRAWN,
        withdrawal_reason=GradingCandidate.WithdrawalReason.OTHER,
        withdrawal_note="Already promoted at the earlier grading.",
        actor=user("withdrawer@example.com"),
    )

    stale.refresh_from_db()
    assert stale.status == GradingCandidate.Status.WITHDRAWN


def test_a_registration_overtaken_by_a_promotion_can_be_withdrawn_after_lock() -> None:
    from gradings.services import transition_grading_session, withdraw_locked_candidate
    from gradings.testing import complete_assessment, override_master

    stale, _pupil = _registered_twice_then_promoted_in_first()
    stale_assessment = assessment(candidate=stale)
    start_assessment(stale_assessment)
    complete_assessment(stale_assessment)
    transition_grading_session(stale.session, GradingSession.Status.LOCKED)
    stale.refresh_from_db()

    withdraw_locked_candidate(
        stale,
        reason=GradingCandidate.WithdrawalReason.OTHER,
        note="Already promoted at the earlier grading.",
        actor=override_master("override@example.com"),
    )

    stale.refresh_from_db()
    assert stale.status == GradingCandidate.Status.WITHDRAWN


def test_moving_or_reinstating_a_registration_rechecks_its_testing_rank() -> None:
    stale, _pupil = _registered_twice_then_promoted_in_first()
    elsewhere = grading_session(
        title="Elsewhere",
        grading_date=date(2027, 9, 20),
        status=GradingSession.Status.OPEN,
    )
    actor = user("mover@example.com")

    with pytest.raises(ValidationError) as moved:
        apply_candidate_update(stale, session=elsewhere, actor=actor)
    assert "testing_for_rank" in moved.value.message_dict

    apply_candidate_update(
        stale,
        status=GradingCandidate.Status.WITHDRAWN,
        withdrawal_reason=GradingCandidate.WithdrawalReason.ABSENT,
        actor=actor,
    )
    stale.refresh_from_db()
    with pytest.raises(ValidationError) as reinstated:
        apply_candidate_update(
            stale, status=GradingCandidate.Status.REGISTERED, actor=actor
        )
    assert "testing_for_rank" in reinstated.value.message_dict


ONE_GRADING_REFUSAL = "has not reached its result yet"


def _graded_in(first: GradingSession) -> GradingCandidate:
    from gradings.services import transition_grading_session
    from gradings.testing import complete_assessment

    built = candidate(session=first)
    generated = assessment(candidate=built)
    start_assessment(generated)
    complete_assessment(generated)
    transition_grading_session(first, GradingSession.Status.LOCKED)
    built.refresh_from_db()
    return built


def _register_elsewhere(pupil: Student) -> dict[str, list[str]]:
    later = grading_session(
        title="Later", grading_date=date(2027, 9, 20), status=GradingSession.Status.OPEN
    )
    _created, errors = bulk_register_candidates(
        session=later,
        rows=[{"student": Student.objects.get(pk=pupil.pk)}],
        actor=user(f"registrar-{later.pk}@example.com"),
    )
    return errors


def test_a_student_is_registered_for_one_grading_at_a_time() -> None:
    first = grading_session(title="First", status=GradingSession.Status.OPEN)
    registered = candidate(session=first)

    errors = _register_elsewhere(registered.student)

    assert list(errors) == ["0"]
    assert ONE_GRADING_REFUSAL in errors["0"][0]
    assert "'First'" in errors["0"][0]
    assert GradingCandidate.objects.filter(student=registered.student).count() == 1


def test_a_locked_grading_awaiting_its_decision_still_holds_the_student() -> None:
    from gradings.outcome_services import (
        create_candidate_outcome,
        propose_candidate_outcome,
    )

    graded = _graded_in(grading_session(status=GradingSession.Status.OPEN))
    assert ONE_GRADING_REFUSAL in _register_elsewhere(graded.student)["0"][0]

    outcome = create_candidate_outcome(graded, user("drafter@example.com"))
    propose_candidate_outcome(
        outcome, "PASS", "Ready for decision.", user("proposer@example.com")
    )

    assert ONE_GRADING_REFUSAL in _register_elsewhere(graded.student)["0"][0]


def test_a_finalised_pass_holds_the_student_until_promoted() -> None:
    from gradings.outcome_services import promote_candidate
    from gradings.testing import finalised_outcome, promoter

    graded = _graded_in(grading_session(status=GradingSession.Status.OPEN))
    outcome = finalised_outcome(graded)
    assert ONE_GRADING_REFUSAL in _register_elsewhere(graded.student)["0"][0]

    promote_candidate(outcome, promoter())

    assert _register_elsewhere(graded.student) == {}


@pytest.mark.parametrize("final", ["FAIL", "CONDITIONAL"])
def test_a_finalised_fail_or_conditional_releases_the_student(final: str) -> None:
    from gradings.testing import finalised_outcome

    graded = _graded_in(grading_session(status=GradingSession.Status.OPEN))
    finalised_outcome(
        graded,
        proposed=final,
        final=final,
        conditional_requirements="Re-test forms." if final == "CONDITIONAL" else "",
    )

    assert _register_elsewhere(graded.student) == {}


def test_a_withdrawal_or_cancelled_session_releases_the_student() -> None:
    from gradings.services import transition_grading_session

    withdrawn = candidate(
        session=grading_session(title="Withdrawn", status=GradingSession.Status.OPEN),
        status=GradingCandidate.Status.WITHDRAWN,
    )
    assert _register_elsewhere(withdrawn.student) == {}

    cancelled_session = grading_session(
        title="Cancelled", status=GradingSession.Status.OPEN
    )
    in_cancelled = candidate(session=cancelled_session)
    transition_grading_session(cancelled_session, GradingSession.Status.CANCELLED)
    assert _register_elsewhere(in_cancelled.student) == {}


def test_reinstating_is_refused_while_another_grading_holds_the_student() -> None:
    first = grading_session(title="First", status=GradingSession.Status.OPEN)
    withdrawn = candidate(session=first, status=GradingCandidate.Status.WITHDRAWN)
    assert _register_elsewhere(withdrawn.student) == {}

    with pytest.raises(ValidationError) as refusal:
        apply_candidate_update(
            withdrawn,
            status=GradingCandidate.Status.REGISTERED,
            actor=user("reinstater@example.com"),
        )

    assert ONE_GRADING_REFUSAL in refusal.value.message_dict["student"][0]


def test_registering_twice_in_one_session_keeps_its_own_message() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    registered = candidate(session=session)

    _created, errors = bulk_register_candidates(
        session=session,
        rows=[{"student": registered.student}],
        actor=user("registrar@example.com"),
    )

    assert errors == {"0": ["Student is already registered for this session."]}


def test_bulk_reinstating_refuses_only_the_student_held_elsewhere() -> None:
    from gradings.services import bulk_update_candidate_status

    first = grading_session(title="First", status=GradingSession.Status.OPEN)
    held = candidate(session=first, status=GradingCandidate.Status.WITHDRAWN)
    free = candidate(session=first, status=GradingCandidate.Status.WITHDRAWN)
    assert _register_elsewhere(held.student) == {}

    updated, errors = bulk_update_candidate_status(
        candidates=[held, free],
        new_status=GradingCandidate.Status.REGISTERED,
        actor=user("bulk-reinstater@example.com"),
    )

    assert [row.pk for row in updated] == [free.pk]
    assert list(errors) == ["0"]
    assert ONE_GRADING_REFUSAL in errors["0"][0]


def test_a_withdrawn_registration_in_the_session_gets_the_same_message() -> None:
    # The unique constraint's own message named neither the student nor the
    # session; the cohort builder recognises this one.
    session = grading_session(status=GradingSession.Status.OPEN)
    withdrawn = candidate(session=session, status=GradingCandidate.Status.WITHDRAWN)

    _created, errors = bulk_register_candidates(
        session=session,
        rows=[{"student": withdrawn.student}],
        actor=user("registrar-again@example.com"),
    )

    assert errors == {"0": ["Student is already registered for this session."]}


def test_moving_onto_a_session_holding_the_student_gets_the_same_message() -> None:
    source = grading_session(status=GradingSession.Status.OPEN, title="Source")
    target = grading_session(status=GradingSession.Status.OPEN, title="Target")
    both = student()
    candidate(session=target, student=both, status=GradingCandidate.Status.WITHDRAWN)
    moving = candidate(session=source, student=both)

    with pytest.raises(ValidationError) as refusal:
        apply_candidate_update(moving, session=target, actor=user("mover2@example.com"))

    assert refusal.value.message_dict == {
        "student": ["Student is already registered for this session."],
    }
