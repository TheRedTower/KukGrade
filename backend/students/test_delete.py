"""Administrator-only hard delete of a student, cascading through every
grading-session registration, assessment, outcome and promotion involving
them; a linked LegacyGradingRecord is unlinked, not deleted."""

from __future__ import annotations

import pytest
from django.contrib import admin
from django.test import RequestFactory
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditAction, AuditEvent
from data_imports.testing import legacy_record
from gradings.models import (
    CandidateAssessment,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    Promotion,
)
from gradings.services import (
    generate_candidate_assessment,
    get_next_active_rank,
    promote_candidate,
    transition_grading_session,
)
from gradings.tests import (
    candidate,
    complete_assessment,
    finalised_outcome,
    grading_session,
    locked_completed_candidate,
    promoter,
    rank,
    start_assessment,
    user,
)
from students.admin import StudentAdmin
from students.models import Student
from students.services import delete_student

pytestmark = pytest.mark.django_db


def test_delete_requires_the_students_delete_permission() -> None:
    built = candidate()
    instructor = user("student-delete-forbidden@example.com")

    client = APIClient()
    client.force_authenticate(user=instructor)
    response = client.delete(f"/api/students/{built.student.pk}/")

    assert response.status_code == 403
    assert Student.objects.filter(pk=built.student.pk).exists()


def test_administrator_can_delete_a_student_with_no_history() -> None:
    student = Student.objects.create(
        wksa_id="DEL-0001",
        first_name="No",
        last_name="History",
        date_of_birth="2015-01-01",
        current_rank=rank("WHITE"),
    )
    admin = user("student-delete-admin-1@example.com", role=User.Role.ADMINISTRATOR)
    events_before = AuditEvent.objects.count()
    student_pk = student.pk

    delete_student(student, admin)

    assert not Student.objects.filter(pk=student_pk).exists()
    event = AuditEvent.objects.filter(
        entity_type="Student",
        entity_id=str(student_pk),
        action=AuditAction.STUDENT_DELETED,
    ).get()
    assert event.metadata["wksa_id"] == "DEL-0001"
    assert event.metadata["cascaded_grading_candidates"] == []
    assert event.metadata["cascaded_promotions"] == 0
    assert event.metadata["cascaded_outcomes"] == 0
    assert event.metadata["legacy_records_unlinked"] == []
    assert AuditEvent.objects.count() == events_before + 1


def test_deleting_a_student_cascades_registrations_assessments_outcomes_and_promotions() -> (  # noqa: E501
    None
):
    built, generated = locked_completed_candidate()
    student = built.student
    outcome = finalised_outcome(built)
    promotion = promote_candidate(
        outcome,
        promoter("student-delete-cascade@example.com"),
    )

    other_session = grading_session()
    other_candidate = candidate(session=other_session, student=student)

    admin = user(
        "student-delete-cascade-admin@example.com", role=User.Role.ADMINISTRATOR
    )
    student_pk = student.pk

    delete_student(student, admin)

    assert not Student.objects.filter(pk=student_pk).exists()
    assert not GradingCandidate.objects.filter(pk=built.pk).exists()
    assert not GradingCandidate.objects.filter(pk=other_candidate.pk).exists()
    assert not CandidateAssessment.objects.filter(pk=generated.pk).exists()
    assert not CandidateOutcome.objects.filter(pk=outcome.pk).exists()
    assert not Promotion.objects.filter(pk=promotion.pk).exists()

    event = AuditEvent.objects.filter(
        entity_type="Student",
        entity_id=str(student_pk),
        action=AuditAction.STUDENT_DELETED,
    ).get()
    assert event.metadata["cascaded_promotions"] == 1
    assert event.metadata["cascaded_outcomes"] == 1
    cascaded_ids = {row["id"] for row in event.metadata["cascaded_grading_candidates"]}
    assert cascaded_ids == {built.pk, other_candidate.pk}


def test_deleting_a_student_unlinks_but_does_not_delete_linked_legacy_records() -> None:
    built, _generated = locked_completed_candidate()
    student = built.student
    legacy = legacy_record(student=student)

    admin = user(
        "student-delete-legacy-admin@example.com", role=User.Role.ADMINISTRATOR
    )
    student_pk = student.pk

    delete_student(student, admin)

    assert not Student.objects.filter(pk=student_pk).exists()
    legacy.refresh_from_db()
    assert legacy.student_id is None
    assert AuditEvent.objects.filter(
        action=AuditAction.LEGACY_GRADING_UNLINKED,
        entity_id=str(legacy.pk),
    ).exists()
    event = AuditEvent.objects.filter(
        entity_type="Student",
        entity_id=str(student_pk),
        action=AuditAction.STUDENT_DELETED,
    ).get()
    assert event.metadata["legacy_records_unlinked"] == [legacy.pk]


def test_deleting_a_student_with_multiple_promotions_needs_no_supersession_check() -> (
    None
):
    # Contrast with session-cascade delete: every promotion this student has
    # is removed together, so there is no surviving promotion left for
    # either one to supersede - unlike gradings.tests's
    # test_session_delete_with_a_superseded_promotion_is_refused_and_deletes_nothing.
    built, _generated = locked_completed_candidate()
    student = built.student
    first_outcome = finalised_outcome(built)
    first_promotion = promote_candidate(
        first_outcome,
        promoter("student-delete-multi-promotion-1@example.com"),
    )

    student.refresh_from_db()
    next_rank = get_next_active_rank(student.current_rank)
    assert next_rank is not None
    second_session = grading_session(status=GradingSession.Status.OPEN)
    second_built = candidate(
        session=second_session,
        student=student,
        testing_for_rank=next_rank,
    )
    second_generated = generate_candidate_assessment(
        second_built,
        user("student-delete-multi-generator@example.com"),
    )
    start_assessment(second_generated)
    complete_assessment(second_generated)
    transition_grading_session(second_session, GradingSession.Status.LOCKED)
    second_outcome = finalised_outcome(second_built)
    second_promotion = promote_candidate(
        second_outcome,
        promoter("student-delete-multi-promotion-2@example.com"),
    )

    admin = user(
        "student-delete-multi-promotion-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    student_pk = student.pk

    delete_student(student, admin)

    assert not Student.objects.filter(pk=student_pk).exists()
    assert not Promotion.objects.filter(pk=first_promotion.pk).exists()
    assert not Promotion.objects.filter(pk=second_promotion.pk).exists()


def test_api_admin_can_delete_student() -> None:
    student = Student.objects.create(
        wksa_id="DEL-API-0001",
        first_name="Api",
        last_name="Delete",
        date_of_birth="2015-01-01",
        current_rank=rank("WHITE"),
    )
    client = APIClient()
    client.force_authenticate(
        user=user("student-delete-api-admin@example.com", role=User.Role.ADMINISTRATOR),
    )

    response = client.delete(f"/api/students/{student.pk}/")

    assert response.status_code == 204
    assert not Student.objects.filter(pk=student.pk).exists()


def test_admin_delete_goes_through_the_service_even_with_history() -> None:
    # Django's own delete refuses a student with registrations (PROTECT) or,
    # with none, deletes the row without the domain event; the service does
    # neither (KG-A14).
    built = candidate()
    student = built.student
    request = RequestFactory().post("/admin/")
    request.user = user(
        "student-admin-delete@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    model_admin = StudentAdmin(Student, admin.site)

    assert model_admin.get_deleted_objects([student], request)[3] == []
    model_admin.delete_queryset(request, Student.objects.filter(pk=student.pk))

    assert not Student.objects.filter(pk=student.pk).exists()
    assert not GradingCandidate.objects.filter(pk=built.pk).exists()
    assert AuditEvent.objects.filter(
        action=AuditAction.STUDENT_DELETED,
        entity_id=str(student.pk),
        actor=request.user,
    ).exists()
