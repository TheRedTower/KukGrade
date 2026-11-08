"""Correcting a date of birth keeps open registrations in the right age band."""

from __future__ import annotations

from datetime import date

import pytest
from django.core.exceptions import ValidationError

from audit.models import AuditAction, AuditEvent
from gradings.models import GradingCandidate, GradingSession
from gradings.testing import (
    assessment,
    auth_client,
    candidate,
    grading_session,
    student,
    user,
)
from students.services import update_student
from syllabus.models import AgeBand, SyllabusRequirement

pytestmark = pytest.mark.django_db

# Born in 2017, a candidate on 20 March 2027 is ten (9-12); born in 2013, fourteen.
CORRECTED = date(2013, 3, 20)


def test_a_corrected_birth_date_moves_an_open_registration_to_its_band() -> None:
    built = candidate()
    assert built.age_band == AgeBand.AGE_9_TO_12
    actor = user("dob-fix@example.com")

    update_student(built.student, date_of_birth=CORRECTED, actor=actor)

    built.refresh_from_db()
    assert built.age_band == AgeBand.AGE_13_TO_17
    event = AuditEvent.objects.filter(action=AuditAction.STUDENT_UPDATED).latest("pk")
    assert event.metadata["rebanded"] == [
        {"candidate": built.pk, "from": "AGE_9_TO_12", "to": "AGE_13_TO_17"},
    ]


def test_a_correction_into_a_band_with_no_syllabus_for_the_rank_is_refused() -> None:
    """Review N-08 (2026-11-07): the C-02 rule, on the re-banding path."""
    built = candidate()
    SyllabusRequirement.objects.filter(
        rank=built.testing_for_rank,
        age_band=AgeBand.AGE_13_TO_17,
    ).delete()

    with pytest.raises(ValidationError, match="no syllabus recorded for Yellow Stripe"):
        update_student(built.student, date_of_birth=CORRECTED)

    built.refresh_from_db()
    built.student.refresh_from_db()
    assert built.age_band == AgeBand.AGE_9_TO_12
    assert built.student.date_of_birth != CORRECTED


def test_a_correction_inside_the_same_band_changes_no_registration() -> None:
    built = candidate()

    update_student(built.student, date_of_birth=date(2016, 6, 1))

    built.refresh_from_db()
    assert built.age_band == AgeBand.AGE_9_TO_12
    event = AuditEvent.objects.filter(action=AuditAction.STUDENT_UPDATED).latest("pk")
    assert event.metadata["rebanded"] == []


def test_a_prepared_assessment_form_blocks_a_correction_into_another_band() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    assessment(candidate=built)

    with pytest.raises(ValidationError) as exc_info:
        update_student(built.student, date_of_birth=CORRECTED)

    assert "Remove the assessment form first" in str(exc_info.value)
    built.student.refresh_from_db()
    assert built.student.date_of_birth == date(2017, 3, 20)
    built.refresh_from_db()
    assert built.age_band == AgeBand.AGE_9_TO_12


def test_a_settled_registration_keeps_the_band_it_was_graded_in() -> None:
    built = candidate(student=student(first_name="Sam"))
    GradingCandidate.objects.filter(pk=built.pk).update(
        status=GradingCandidate.Status.WITHDRAWN,
        withdrawal_reason=GradingCandidate.WithdrawalReason.ABSENT,
        withdrawn_by=user("withdrawn-by@example.com"),
        withdrawn_at=built.created_at,
    )

    update_student(built.student, date_of_birth=CORRECTED)

    built.refresh_from_db()
    assert built.age_band == AgeBand.AGE_9_TO_12


def test_the_api_rebands_on_a_corrected_birth_date() -> None:
    built = candidate()

    response = auth_client("dob-api@example.com").patch(
        f"/api/students/{built.student_id}/",
        {"date_of_birth": "2013-03-20"},
        format="json",
    )

    assert response.status_code == 200, response.json()
    built.refresh_from_db()
    assert built.age_band == AgeBand.AGE_13_TO_17


def test_the_api_refuses_a_correction_that_would_change_a_prepared_form() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    assessment(candidate=built)

    response = auth_client("dob-api-blocked@example.com").patch(
        f"/api/students/{built.student_id}/",
        {"date_of_birth": "2013-03-20"},
        format="json",
    )

    assert response.status_code == 400
    assert "Remove the assessment form first" in response.json()["error"]["message"]
