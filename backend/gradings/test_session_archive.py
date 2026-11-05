"""Archiving a finished session: hidden from lists, nothing erased."""

from __future__ import annotations

import pytest
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditAction, AuditEvent
from gradings.models import CandidateOutcome, GradingSession, Promotion
from gradings.outcome_services import promote_candidate
from gradings.services import (
    archive_grading_session,
    restore_grading_session,
    transition_grading_session,
)
from gradings.testing import (
    finalised_outcome,
    grading_session,
    locked_completed_candidate,
    promoter,
    user,
)
from kukgrade.testing import results

pytestmark = pytest.mark.django_db


def admin(email: str = "archive-admin@example.com") -> User:
    return user(email, role=User.Role.ADMINISTRATOR)


def admin_client(email: str = "archive-admin-client@example.com") -> APIClient:
    client = APIClient()
    client.force_authenticate(user=admin(email))
    return client


def completed_session() -> GradingSession:
    built, _generated = locked_completed_candidate()
    promote_candidate(finalised_outcome(built), promoter("archive-promoter@e.com"))
    transition_grading_session(built.session, GradingSession.Status.COMPLETED)
    built.session.refresh_from_db()
    return built.session


def test_an_administrator_archives_a_completed_session_and_nothing_is_erased() -> None:
    session = completed_session()

    archived = archive_grading_session(session, admin())

    session.refresh_from_db()
    assert session.archived_at is not None
    assert archived.archived_at == session.archived_at
    assert CandidateOutcome.objects.filter(candidate__session=session).count() == 1
    assert Promotion.objects.filter(grading_candidate__session=session).count() == 1
    event = AuditEvent.objects.get(action=AuditAction.SESSION_ARCHIVED)
    assert event.entity_id == str(session.pk)


def test_a_cancelled_session_can_be_archived() -> None:
    session = grading_session(status=GradingSession.Status.DRAFT)
    transition_grading_session(session, GradingSession.Status.CANCELLED)
    session.refresh_from_db()

    archive_grading_session(session, admin("archive-cancelled@example.com"))

    session.refresh_from_db()
    assert session.archived_at is not None


@pytest.mark.parametrize(
    "status",
    [
        GradingSession.Status.DRAFT,
        GradingSession.Status.OPEN,
        GradingSession.Status.LOCKED,
    ],
)
def test_a_session_still_in_progress_cannot_be_archived(
    status: GradingSession.Status,
) -> None:
    session = grading_session(status=status)

    with pytest.raises(ValidationError, match="completed or cancelled"):
        archive_grading_session(session, admin("archive-live@example.com"))

    session.refresh_from_db()
    assert session.archived_at is None


def test_only_an_administrator_archives_or_restores() -> None:
    session = completed_session()
    instructor = user("archive-instructor@example.com")

    with pytest.raises(ValidationError, match="administrator"):
        archive_grading_session(session, instructor)
    archive_grading_session(session, admin())
    with pytest.raises(ValidationError, match="administrator"):
        restore_grading_session(session, instructor)

    session.refresh_from_db()
    assert session.archived_at is not None


def test_archiving_twice_and_restoring_what_is_not_archived_are_refused() -> None:
    session = completed_session()
    boss = admin()

    with pytest.raises(ValidationError, match="not archived"):
        restore_grading_session(session, boss)
    archive_grading_session(session, boss)
    with pytest.raises(ValidationError, match="already archived"):
        archive_grading_session(session, boss)


def test_restoring_brings_the_session_back_and_is_audited() -> None:
    session = completed_session()
    boss = admin()
    archive_grading_session(session, boss)

    restore_grading_session(session, boss)

    session.refresh_from_db()
    assert session.archived_at is None
    assert AuditEvent.objects.filter(action=AuditAction.SESSION_RESTORED).count() == 1


def test_the_database_refuses_an_archived_session_that_is_not_finished() -> None:
    from django.db import IntegrityError, transaction
    from django.utils import timezone

    session = grading_session(status=GradingSession.Status.OPEN)

    with pytest.raises(IntegrityError), transaction.atomic():
        GradingSession.objects.filter(pk=session.pk).update(
            archived_at=timezone.now(),
        )


def test_the_list_leaves_out_archived_sessions_unless_asked() -> None:
    kept = grading_session(title="Kept")
    archived = completed_session()
    archive_grading_session(archived, admin())
    client = admin_client()

    def ids(query: str) -> set[int]:
        response = client.get(f"/api/gradings/sessions/{query}")
        return {row["id"] for row in results(response)}

    assert kept.pk in ids("")
    assert archived.pk not in ids("")
    assert archived.pk not in ids("?archived=exclude")
    assert ids("?archived=only") == {archived.pk}
    assert {kept.pk, archived.pk} <= ids("?archived=include")
    assert ids("?archived=nonsense") == set()


def test_one_archived_session_still_opens_by_its_link() -> None:
    session = completed_session()
    archive_grading_session(session, admin())

    response = admin_client().get(f"/api/gradings/sessions/{session.pk}/")

    assert response.status_code == 200
    assert response.json()["archived_at"] is not None


def test_the_archive_and_restore_endpoints_follow_who_may() -> None:
    session = completed_session()
    instructor = APIClient()
    instructor.force_authenticate(user=user("archive-api-instructor@example.com"))
    boss = admin_client()
    url = f"/api/gradings/sessions/{session.pk}/"

    refused = instructor.post(f"{url}archive/")
    archived = boss.post(f"{url}archive/")
    again = boss.post(f"{url}archive/")
    restored = boss.post(f"{url}restore/")

    assert refused.status_code == 403
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None
    assert archived.json()["can_be_restored"] is True
    assert archived.json()["can_be_archived"] is False
    assert again.status_code == 400
    assert restored.status_code == 200
    assert restored.json()["archived_at"] is None
    assert restored.json()["can_be_archived"] is True


def test_the_capabilities_are_served_per_viewer() -> None:
    session = completed_session()
    instructor = APIClient()
    instructor.force_authenticate(user=user("archive-cap-instructor@example.com"))

    seen_by_instructor = instructor.get(f"/api/gradings/sessions/{session.pk}/").json()
    seen_by_admin = admin_client().get(f"/api/gradings/sessions/{session.pk}/").json()

    assert seen_by_instructor["can_be_archived"] is False
    assert seen_by_admin["can_be_archived"] is True
    assert seen_by_admin["can_be_deleted"] is False  # it holds a final decision


def test_a_session_with_final_decisions_reports_it_cannot_be_deleted() -> None:
    built, _generated = locked_completed_candidate()
    finalised_outcome(built)

    body = (
        admin_client("archive-del-cap@example.com")
        .get(
            f"/api/gradings/sessions/{built.session_id}/",
        )
        .json()
    )

    assert body["can_be_deleted"] is False
