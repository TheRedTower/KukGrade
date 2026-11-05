"""New audit events carry ids and field names, never names or dates of birth.

The audit log is permanent, so personal details written into it cannot be
erased with the student. These tests drive the whole life of a student through
the services and then read every event back.
"""

from __future__ import annotations

import json
from datetime import date

import pytest
from pytest_django.fixtures import DjangoAssertNumQueries
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditAction, AuditEvent
from gradings.models import GradingCandidate, GradingSession
from gradings.outcome_services import promote_candidate
from gradings.services import (
    apply_candidate_update,
    delete_candidate,
    register_candidate,
    transition_grading_session,
)
from gradings.testing import (
    assessment,
    candidate,
    complete_assessment,
    finalised_outcome,
    grading_session,
    promoter,
    rank,
    student,
    user,
)
from kukgrade.testing import results
from students.services import create_student, delete_student, update_student

pytestmark = pytest.mark.django_db

PERSONAL = [
    "Zephyrine",
    "Quillfeather",
    "Marigold",
    "Thistlewood",
    "2014-06-07",
    "2014-06-08",
]


def everything_recorded() -> str:
    return " ".join(
        event.summary + " " + json.dumps(event.metadata)
        for event in AuditEvent.objects.all()
    )


def test_a_students_whole_life_leaves_no_name_or_birth_date_in_the_log() -> None:
    actor = user("no-pii-actor@example.com")
    graded = create_student(
        wksa_id="123-4-777",
        first_name="Zephyrine",
        last_name="Quillfeather",
        date_of_birth=date(2014, 6, 7),
        current_rank=rank("WHITE"),
        actor=actor,
    )
    update_student(
        graded,
        first_name="Marigold",
        date_of_birth=date(2014, 6, 8),
        status="INACTIVE",
        actor=actor,
    )
    update_student(graded, last_name="Thistlewood", status="ACTIVE", actor=actor)
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session, student=graded)
    other = candidate(session=session)
    gone = candidate(session=session)
    apply_candidate_update(
        other,
        status=GradingCandidate.Status.WITHDRAWN,
        withdrawal_reason=GradingCandidate.WithdrawalReason.ABSENT,
        actor=actor,
    )
    delete_candidate(gone, actor=actor)
    complete_assessment(assessment(candidate=built))
    transition_grading_session(session, GradingSession.Status.LOCKED)
    promote_candidate(finalised_outcome(built), promoter("no-pii-promoter@example.com"))
    leaving = create_student(
        wksa_id="123-4-778",
        first_name="Zephyrine",
        last_name="Quillfeather",
        date_of_birth=date(2014, 6, 7),
        current_rank=rank("WHITE"),
        actor=actor,
    )
    delete_student(
        leaving, actor=user("no-pii-admin@example.com", role=User.Role.ADMINISTRATOR)
    )

    recorded = everything_recorded()

    assert AuditEvent.objects.count() > 10
    for token in PERSONAL:
        assert token not in recorded, token
    assert "123-4-777" in recorded


def test_an_event_about_a_student_says_which_student_by_id() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    registered = student()

    register_candidate(
        session=session,
        student=registered,
        testing_for_rank=rank("YELLOW_STRIPE"),
    )

    event = AuditEvent.objects.get(action=AuditAction.CANDIDATE_REGISTERED)
    assert event.metadata["student_id"] == registered.pk
    assert registered.wksa_id in event.summary


def administrator_client() -> APIClient:
    client = APIClient()
    client.force_authenticate(
        user=user("no-pii-reader@example.com", role=User.Role.ADMINISTRATOR),
    )
    return client


def test_the_log_screen_resolves_the_current_name_while_the_student_exists() -> None:
    actor = user("no-pii-actor-2@example.com")
    graded = create_student(
        wksa_id="123-4-779",
        first_name="Zephyrine",
        last_name="Quillfeather",
        date_of_birth=date(2014, 6, 7),
        current_rank=rank("WHITE"),
        actor=actor,
    )
    session = grading_session(status=GradingSession.Status.OPEN)
    register_candidate(
        session=session,
        student=graded,
        testing_for_rank=rank("YELLOW_STRIPE"),
        actor=actor,
    )
    client = administrator_client()

    rows = results(client.get("/api/audit-events/"))

    about = {row["action"]: row["subject_name"] for row in rows}
    assert about[AuditAction.STUDENT_CREATED] == "Zephyrine Quillfeather"
    assert about[AuditAction.CANDIDATE_REGISTERED] == "Zephyrine Quillfeather"
    assert all("Zephyrine" not in row["summary"] for row in rows)


def test_the_name_follows_a_correction_and_is_blank_once_the_student_is_gone() -> None:
    actor = user("no-pii-actor-3@example.com")
    graded = create_student(
        wksa_id="123-4-780",
        first_name="Zephyrine",
        last_name="Quillfeather",
        date_of_birth=date(2014, 6, 7),
        current_rank=rank("WHITE"),
        actor=actor,
    )
    client = administrator_client()
    update_student(graded, first_name="Marigold", actor=actor)

    [first, *_] = results(client.get("/api/audit-events/"))
    delete_student(
        graded, actor=user("no-pii-admin-2@example.com", role=User.Role.ADMINISTRATOR)
    )
    names_after = {
        row["subject_name"] for row in results(client.get("/api/audit-events/"))
    }

    assert first["subject_name"] == "Marigold Quillfeather"
    assert names_after == {""}


def test_resolving_names_costs_the_same_queries_however_many_events(
    django_assert_max_num_queries: DjangoAssertNumQueries,
) -> None:
    actor = user("no-pii-actor-4@example.com")
    for number in range(6):
        create_student(
            wksa_id=f"123-4-8{number:02d}",
            first_name="Many",
            last_name=f"Student{number}",
            date_of_birth=date(2014, 6, 7),
            current_rank=rank("WHITE"),
            actor=actor,
        )
    client = administrator_client()
    client.get("/api/audit-events/")

    with django_assert_max_num_queries(8):
        response = client.get("/api/audit-events/")

    assert len(results(response)) == 6
