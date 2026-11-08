"""Administrator-only delete of a student: never before a final decision;
afterwards the record is kept for its history, and only a record with no
history is erased."""

from __future__ import annotations

from typing import Any

import pytest
from django.core.exceptions import ValidationError
from django.test import Client
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditAction, AuditEvent
from data_imports.testing import legacy_record
from gradings.legacy_matching import PersonGroup, suggest_for_groups
from gradings.legacy_services import (
    bulk_link_legacy_records,
    link_legacy_record_to_student,
)
from gradings.models import (
    CandidateAssessment,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    Promotion,
)
from gradings.outcome_services import promote_candidate, propose_for_candidate
from gradings.services import register_candidate
from gradings.testing import (
    candidate,
    finalised_outcome,
    grading_session,
    locked_completed_candidate,
    promoter,
    rank,
    student,
    user,
)
from kukgrade.testing import render_admin_pages
from students.models import RetiredWksaId, Student
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


def _admin(email: str) -> User:
    return user(email, role=User.Role.ADMINISTRATOR)


def _no_history_student(wksa_id: str = "123-4-500") -> Student:
    return Student.objects.create(
        wksa_id=wksa_id,
        first_name="No",
        last_name="History",
        date_of_birth="2015-01-01",
        current_rank=rank("WHITE"),
    )


def _event(student_pk: int) -> AuditEvent:
    return AuditEvent.objects.filter(
        entity_type="Student",
        entity_id=str(student_pk),
        action=AuditAction.STUDENT_DELETED,
    ).get()


def test_a_student_with_no_history_is_erased_and_their_number_retired() -> None:
    student = _no_history_student()
    student_pk = student.pk

    assert delete_student(student, _admin("student-delete-admin-1@example.com"))

    assert not Student.objects.filter(pk=student_pk).exists()
    assert RetiredWksaId.objects.filter(wksa_id="123-4-500").exists()
    event = _event(student_pk)
    assert event.metadata["wksa_id"] == "123-4-500"
    assert event.metadata["kept_for_their_history"] is False


def test_a_student_is_not_deleted_while_their_grading_has_no_decision() -> None:
    built = candidate(session=grading_session(title="Spring grading"))

    with pytest.raises(ValidationError) as refused:
        delete_student(built.student, _admin("student-delete-open@example.com"))

    assert "'Spring grading'" in refused.value.message_dict["student"][0]
    assert "not reached its final decision" in refused.value.message_dict["student"][0]
    built.student.refresh_from_db()
    assert built.student.deleted_at is None
    assert GradingCandidate.objects.filter(pk=built.pk).exists()


def test_a_proposal_is_not_a_final_decision() -> None:
    built, _generated = locked_completed_candidate()
    propose_for_candidate(
        built,
        CandidateOutcome.Outcome.PASS,
        "Ready.",
        user("student-delete-proposer@example.com"),
    )

    with pytest.raises(ValidationError, match="not reached its final decision"):
        delete_student(built.student, _admin("student-delete-proposal@example.com"))


def test_a_pass_waits_for_its_promotion() -> None:
    built, _generated = locked_completed_candidate()
    finalised_outcome(built)

    with pytest.raises(ValidationError, match="promotion has not been recorded"):
        delete_student(built.student, _admin("student-delete-unpromoted@example.com"))


def test_after_the_decision_the_student_is_deleted_and_their_history_kept() -> None:
    built, generated = locked_completed_candidate()
    student = built.student
    outcome = finalised_outcome(built)
    promotion = promote_candidate(
        outcome,
        promoter("student-delete-kept@example.com"),
    )
    legacy = legacy_record(student=student)

    kept = delete_student(student, _admin("student-delete-kept-admin@example.com"))

    assert kept is False
    student.refresh_from_db()
    assert student.deleted_at is not None
    assert GradingCandidate.objects.filter(pk=built.pk, student=student).exists()
    assert CandidateAssessment.objects.filter(pk=generated.pk).exists()
    assert CandidateOutcome.objects.filter(pk=outcome.pk).exists()
    assert Promotion.objects.filter(pk=promotion.pk).exists()
    legacy.refresh_from_db()
    assert legacy.student_id == student.pk
    # The number stays with the record that still holds it.
    assert not RetiredWksaId.objects.filter(wksa_id=student.wksa_id).exists()
    assert _event(student.pk).metadata["kept_for_their_history"] is True


def test_a_fail_is_a_final_decision_too() -> None:
    built, _generated = locked_completed_candidate()
    finalised_outcome(
        built,
        proposed=CandidateOutcome.Outcome.FAIL,
        final=CandidateOutcome.Outcome.FAIL,
    )

    assert not delete_student(built.student, _admin("student-delete-fail@example.com"))


def test_a_student_taken_out_of_a_grading_can_be_deleted() -> None:
    built = candidate()
    # Taken out by cancelling that grading; withdrawal settles it the same
    # way (gradings.services.unsettled_registrations).
    GradingSession.objects.filter(pk=built.session_id).update(
        status=GradingSession.Status.CANCELLED,
    )

    assert not delete_student(
        built.student, _admin("student-delete-withdrawn@example.com")
    )
    assert GradingCandidate.objects.filter(pk=built.pk).exists()


def test_a_deleted_student_is_gone_from_the_list_and_closed_to_changes() -> None:
    built, _generated = locked_completed_candidate()
    student = built.student
    finalised_outcome(
        built,
        proposed=CandidateOutcome.Outcome.FAIL,
        final=CandidateOutcome.Outcome.FAIL,
    )
    admin = _admin("student-delete-closed@example.com")
    delete_student(student, admin)
    client = APIClient()
    client.force_authenticate(user=admin)

    listed = client.get("/api/students/").json()
    page = client.get(f"/api/students/{student.pk}/")
    history = client.get(f"/api/students/{student.pk}/grading-history/")
    edited = client.patch(f"/api/students/{student.pk}/", {"first_name": "X"})
    again = client.delete(f"/api/students/{student.pk}/")
    open_session = grading_session(status=GradingSession.Status.OPEN)
    student.refresh_from_db()
    with pytest.raises(ValidationError, match="has been deleted"):
        register_candidate(
            session=open_session,
            student=student,
            testing_for_rank=rank("YELLOW_STRIPE"),
        )

    rows = listed["results"] if isinstance(listed, dict) else listed
    assert student.pk not in {row["id"] for row in rows}
    assert page.status_code == 200
    assert page.json()["deleted_at"] is not None
    assert history.status_code == 200
    assert edited.status_code == 404
    assert again.status_code == 404


def test_a_deleted_student_is_not_suggested_or_linked_to_new_records() -> None:
    """Their existing historical records stay theirs; nothing new is linked
    to a closed record, and they are not offered as a match (Codex, #192)."""
    built, _generated = locked_completed_candidate()
    finalised_outcome(
        built,
        proposed=CandidateOutcome.Outcome.FAIL,
        final=CandidateOutcome.Outcome.FAIL,
    )
    deleted = built.student
    kept = legacy_record(student=deleted)
    admin = _admin("student-delete-legacy@example.com")
    delete_student(deleted, admin)
    deleted.refresh_from_db()
    loose = legacy_record(source_name=deleted.full_name)

    with pytest.raises(ValidationError, match="has been deleted"):
        link_legacy_record_to_student(loose, deleted, actor=admin)
    with pytest.raises(ValidationError, match="has been deleted"):
        bulk_link_legacy_records([(loose, deleted)], actor=admin)

    group = PersonGroup(key="x", source_name=deleted.full_name, records=[loose])
    suggest_for_groups([group])
    assert deleted.pk not in {c.student.pk for c in group.candidates}
    kept.refresh_from_db()
    assert kept.student_id == deleted.pk


def test_api_admin_can_delete_student() -> None:
    student = Student.objects.create(
        wksa_id="123-4-501",
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


def test_the_admin_cannot_delete_a_student(settings: Any) -> None:
    render_admin_pages(settings)
    target = student()
    client = Client()
    client.force_login(
        user("no-delete-admin@example.com", is_staff=True, is_superuser=True),
    )

    single = client.post(
        f"/admin/students/student/{target.pk}/delete/",
        {"post": "yes"},
    )
    bulk = client.post(
        "/admin/students/student/",
        {
            "action": "delete_selected",
            "_selected_action": [target.pk],
            "post": "yes",
        },
    )

    assert single.status_code == 403
    assert bulk.status_code in {200, 302}
    assert Student.objects.filter(pk=target.pk).exists()
