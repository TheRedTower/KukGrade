"""A record's history: its own events and everything that belongs to it."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditAction, AuditEntity, AuditEvent
from gradings.models import GradingCandidate, GradingSession
from gradings.outcome_services import promote_candidate
from gradings.services import register_candidate, transition_grading_session
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
from students.services import delete_student

pytestmark = pytest.mark.django_db


def administrator() -> APIClient:
    account = User.objects.filter(email="history-admin@example.com").first() or user(
        "history-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    client = APIClient()
    client.force_authenticate(user=account)
    return client


def history(client: APIClient, subject: str) -> list[AuditEvent]:
    rows = results(
        client.get("/api/audit-events/", {"subject": subject, "page_size": "200"})
    )
    return list(AuditEvent.objects.filter(pk__in=[row["id"] for row in rows]))


def kinds(events: list[AuditEvent]) -> set[str]:
    return {event.entity_type for event in events}


def graded_session() -> tuple[GradingSession, list[GradingCandidate]]:
    """A session through registration, marking, lock, decision and promotion."""
    session = grading_session(status=GradingSession.Status.OPEN)
    registered = [
        register_candidate(
            session=session,
            student=student(),
            testing_for_rank=rank("YELLOW_STRIPE"),
            actor=user(f"history-registrar-{number}@example.com"),
        )
        for number in range(2)
    ]
    first, second = registered
    for built in (first, second):
        complete_assessment(assessment(candidate=built))
    transition_grading_session(session, GradingSession.Status.LOCKED)
    promote_candidate(
        finalised_outcome(first), promoter("history-promoter@example.com")
    )
    return session, [first, second]


def test_a_gradings_history_has_its_candidates_marks_decisions_and_promotions() -> None:
    session, (first, _second) = graded_session()
    elsewhere = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    complete_assessment(assessment(candidate=elsewhere))

    events = history(administrator(), f"session:{session.pk}")

    assert {
        AuditEntity.GRADING_SESSION,
        AuditEntity.GRADING_CANDIDATE,
        AuditEntity.CANDIDATE_ASSESSMENT,
        AuditEntity.CANDIDATE_OUTCOME,
        AuditEntity.PROMOTION,
    } <= kinds(events)
    assert all(
        event.metadata.get("session_id", session.pk) == session.pk for event in events
    )
    other = history(administrator(), f"session:{elsewhere.session_id}")
    assert {event.pk for event in events}.isdisjoint({event.pk for event in other})
    assert AuditAction.PROMOTION_RECORDED in {event.action for event in events}
    assert first.student.wksa_id in " ".join(event.summary for event in events)


def test_a_students_history_is_theirs_alone() -> None:
    _session, (first, second) = graded_session()
    first_events = history(administrator(), f"student:{first.student_id}")
    second_events = history(administrator(), f"student:{second.student_id}")

    assert AuditAction.PROMOTION_RECORDED in {event.action for event in first_events}
    assert AuditAction.PROMOTION_RECORDED not in {
        event.action for event in second_events
    }
    assert {event.pk for event in first_events}.isdisjoint(
        {event.pk for event in second_events},
    )


def test_a_candidates_history_follows_one_registration() -> None:
    _session, (first, second) = graded_session()

    events = history(administrator(), f"candidate:{first.pk}")

    assert AuditEntity.CANDIDATE_ASSESSMENT in kinds(events)
    other = history(administrator(), f"candidate:{second.pk}")
    assert {event.pk for event in events}.isdisjoint({event.pk for event in other})


def test_events_written_before_the_ids_were_carried_are_still_found() -> None:
    """Older events hold no session or candidate id; the records that still exist
    are followed instead."""
    session, (first, _second) = graded_session()
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE audit_auditevent SET metadata = metadata - 'session_id'"
            " - 'candidate_id' - 'student_id'",
        )

    events = history(administrator(), f"session:{session.pk}")

    assert {
        AuditEntity.GRADING_SESSION,
        AuditEntity.GRADING_CANDIDATE,
        AuditEntity.CANDIDATE_ASSESSMENT,
        AuditEntity.CANDIDATE_OUTCOME,
        AuditEntity.PROMOTION,
    } <= kinds(events)
    assert first.pk  # the registration the events were about


def test_a_users_history_is_what_was_done_to_them_and_what_they_did() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    actor = user("history-actor@example.com")
    candidate(session=session)
    admin = administrator()
    from gradings.services import update_grading_session

    update_grading_session(session, changes={"notes": "Hello"}, actor=actor)

    events = history(admin, f"user:{actor.pk}")

    assert AuditAction.SESSION_UPDATED in {event.action for event in events}
    assert all(event.actor_id == actor.pk for event in events)


def test_a_malformed_or_unknown_history_is_an_empty_page_not_an_error() -> None:
    admin = administrator()
    for subject in (
        "",
        "nonsense",
        "session:",
        "session:abc",
        "planet:1",
        "user:not-a-uuid",
    ):
        response = admin.get("/api/audit-events/", {"subject": subject})
        assert response.status_code == 200
        if subject:
            assert results(response) == []


def test_the_subject_is_named_as_it_is_now_and_blank_once_gone() -> None:
    session, (first, _second) = graded_session()
    admin = administrator()

    named = admin.get(
        "/api/audit-events/subject/", {"subject": f"session:{session.pk}"}
    ).json()
    student = admin.get(
        "/api/audit-events/subject/",
        {"subject": f"student:{first.student_id}"},
    ).json()
    registration = admin.get(
        "/api/audit-events/subject/",
        {"subject": f"candidate:{first.pk}"},
    ).json()

    assert named["name"].startswith(session.title)
    assert named["path"] == f"/gradings/{session.pk}"
    assert first.student.first_name in student["name"]
    assert student["path"] == f"/students/{first.student_id}"
    assert registration["path"] == (
        f"/gradings/{session.pk}/assessments/{first.pk}/review"
    )

    delete_student(
        first.student, user("history-remover@example.com", role=User.Role.ADMINISTRATOR)
    )
    gone = admin.get(
        "/api/audit-events/subject/",
        {"subject": f"student:{first.student_id}"},
    ).json()
    assert gone["name"] == "" and gone["path"] == ""
    # The events outlive the record.
    assert history(admin, f"student:{first.student_id}")


def test_only_those_who_may_read_the_audit_log_can_ask_for_a_history() -> None:
    session, _ = graded_session()
    ordinary = APIClient()
    ordinary.force_authenticate(user=user("history-ordinary@example.com"))

    assert (
        ordinary.get(
            "/api/audit-events/", {"subject": f"session:{session.pk}"}
        ).status_code
        == 403
    )
    assert (
        ordinary.get(
            "/api/audit-events/subject/", {"subject": f"session:{session.pk}"}
        ).status_code
        == 403
    )
