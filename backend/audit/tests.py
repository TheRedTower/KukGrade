"""The audit log records what happened, and only what happened."""

from __future__ import annotations

from datetime import date

import pytest
from django.contrib.admin.sites import site as admin_site
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db.models.deletion import ProtectedError
from django.http import HttpRequest
from django.test import RequestFactory
from rest_framework.test import APIClient

from accounts.models import User
from audit.admin import AuditEventAdmin
from audit.models import AuditAction, AuditEvent
from audit.recording import record
from audit.testing import (
    draft_session_with_candidates,
    locked_completed_candidate_with_outcome,
)
from gradings.models import CandidateOutcome, GradingSession

pytestmark = pytest.mark.django_db


def user(email: str) -> User:
    return User.objects.create_user(email=email)


def grant(actor: User, codename: str, model: str) -> User:
    actor.user_permissions.add(
        Permission.objects.get(
            codename=codename,
            content_type=ContentType.objects.get(app_label="gradings", model=model),
        ),
    )
    return User.objects.get(pk=actor.pk)


def master(email: str) -> User:
    """An instructor holding Master (final-decision) authority.

    Distinct from an administrator - CanViewAuditLog grants audit log
    access to either, and several tests need to tell the two paths apart.
    """
    return grant(user(email), "can_make_final_grading_decision", "candidateoutcome")


def events_for(action: str) -> list[AuditEvent]:
    return list(AuditEvent.objects.filter(action=action))


# ---------------------------------------------------------------------------
# Immutability
# ---------------------------------------------------------------------------


def test_an_event_cannot_be_changed_or_deleted() -> None:
    actor = user("audit-immutable@example.com")
    event = record(
        AuditAction.SESSION_CREATED,
        actor,
        "Something happened.",
        actor=actor,
    )

    event.summary = "Something else happened."
    with pytest.raises(ValidationError):
        event.save()
    with pytest.raises(ValidationError):
        event.delete()
    with pytest.raises(ValidationError):
        AuditEvent.objects.filter(pk=event.pk).delete()
    with pytest.raises(ValidationError):
        AuditEvent.objects.filter(pk=event.pk).update(summary="Rewritten")

    event.refresh_from_db()
    assert event.summary == "Something happened."


def test_deleting_an_actor_is_blocked_rather_than_erasing_who_acted() -> None:
    actor = user("audit-actor-protected@example.com")
    record(AuditAction.SESSION_CREATED, actor, "Acted.", actor=actor)

    with pytest.raises(ProtectedError):
        actor.delete()


def test_entity_reference_is_stored_as_plain_strings() -> None:
    # Not a ContentType foreign key: an audit record has to outlive the
    # schema it describes.
    actor = user("audit-entity@example.com")
    event = record(AuditAction.STUDENT_CREATED, actor, "Created.", actor=actor)

    assert event.entity_type == "User"
    assert event.entity_id == str(actor.pk)


# ---------------------------------------------------------------------------
# The revision case, which is the whole point
# ---------------------------------------------------------------------------


def test_revising_a_proposal_records_what_it_said_before() -> None:
    from gradings.services import propose_candidate_outcome

    outcome, first, second = locked_completed_candidate_with_outcome()

    propose_candidate_outcome(
        outcome,
        CandidateOutcome.Outcome.PASS,
        "Looked strong.",
        first,
    )
    outcome.refresh_from_db()
    propose_candidate_outcome(
        outcome,
        CandidateOutcome.Outcome.FAIL,
        "Disagree - forms were weak.",
        second,
    )

    proposals = sorted(
        events_for(AuditAction.OUTCOME_PROPOSED),
        key=lambda e: e.pk,
    )
    assert len(proposals) == 2

    # The first proposal had nothing before it.
    assert proposals[0].metadata["before"]["proposed_outcome"] is None
    assert proposals[0].actor == first

    # The second must show what it overwrote, or the Master adjudicates blind.
    assert proposals[1].metadata["before"]["proposed_outcome"] == "PASS"
    assert proposals[1].metadata["before"]["proposal_notes"] == "Looked strong."
    assert proposals[1].metadata["after"]["proposed_outcome"] == "FAIL"
    assert proposals[1].actor == second
    assert "revising an earlier PASS" in proposals[1].summary


# ---------------------------------------------------------------------------
# Events never outlive the action that produced them
# ---------------------------------------------------------------------------


def test_no_event_survives_a_rolled_back_action() -> None:
    from django.db import transaction

    from gradings.services import create_grading_session

    actor = user("audit-rollback@example.com")

    with pytest.raises(RuntimeError), transaction.atomic():
        create_grading_session(
            title="Never committed",
            grading_date=date(2027, 10, 1),
            location="",
            notes="",
            created_by=actor,
        )
        raise RuntimeError("something failed after the session was created")

    # An event claiming something happened when it did not is worse than none.
    assert not AuditEvent.objects.filter(
        action=AuditAction.SESSION_CREATED,
    ).exists()
    assert not GradingSession.objects.filter(title="Never committed").exists()


def test_a_refused_action_records_nothing() -> None:
    from gradings.services import create_grading_session, transition_grading_session

    actor = user("audit-refused@example.com")
    session = create_grading_session(
        title="Refused transition",
        grading_date=date(2027, 11, 1),
        location="",
        notes="",
        created_by=actor,
    )

    with pytest.raises(ValidationError):
        transition_grading_session(session, GradingSession.Status.COMPLETED)

    assert not AuditEvent.objects.filter(
        action=AuditAction.SESSION_TRANSITIONED,
    ).exists()


# ---------------------------------------------------------------------------
# The workflow writes one event per action
# ---------------------------------------------------------------------------


def test_a_full_grading_writes_the_expected_trail() -> None:
    outcome, _first, _second = locked_completed_candidate_with_outcome()

    recorded = list(
        AuditEvent.objects.values_list("action", flat=True).order_by("pk"),
    )

    for expected in (
        AuditAction.SESSION_CREATED,
        AuditAction.CANDIDATE_REGISTERED,
        AuditAction.ASSESSMENT_GENERATED,
        AuditAction.ASSESSMENT_STARTED,
        AuditAction.ITEM_RESULT_RECORDED,
        AuditAction.ASSESSMENT_COMPLETED,
        AuditAction.SESSION_TRANSITIONED,
        AuditAction.OUTCOME_CREATED,
    ):
        assert expected in recorded, f"{expected} was not recorded"

    assert outcome.pk is not None


def test_every_event_names_who_did_it() -> None:
    locked_completed_candidate_with_outcome()

    unattributed = AuditEvent.objects.filter(actor__isnull=True)
    assert not unattributed.exists(), [e.action for e in unattributed]


# ---------------------------------------------------------------------------
# Reading the log
# ---------------------------------------------------------------------------


def test_plain_instructor_cannot_read_the_log() -> None:
    locked_completed_candidate_with_outcome()
    client = APIClient()
    client.force_authenticate(user=user("audit-plain-instructor@example.com"))

    assert client.get("/api/audit-events/").status_code == 403


def test_administrator_can_read_the_log() -> None:
    locked_completed_candidate_with_outcome()
    client = APIClient()
    client.force_authenticate(
        user=User.objects.create_user(
            email="audit-admin-reader-2@example.com",
            role=User.Role.ADMINISTRATOR,
        ),
    )

    response = client.get("/api/audit-events/")

    assert response.status_code == 200
    assert response.json()["count"] > 0


def test_reading_the_log_follows_the_permission_not_the_role() -> None:
    locked_completed_candidate_with_outcome()
    reader = user("audit-view-granted@example.com")
    reader.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="audit",
            codename="view_auditevent",
        ),
    )
    client = APIClient()
    client.force_authenticate(user=User.objects.get(pk=reader.pk))

    assert client.get("/api/audit-events/").status_code == 200


def test_master_authority_instructor_can_read_the_log() -> None:
    locked_completed_candidate_with_outcome()
    client = APIClient()
    client.force_authenticate(user=master("audit-master-reader@example.com"))

    response = client.get("/api/audit-events/")

    assert response.status_code == 200
    assert response.json()["count"] > 0


def test_anonymous_users_cannot_read_the_log() -> None:
    assert APIClient().get("/api/audit-events/").status_code == 403


def test_the_log_is_filterable_so_marking_does_not_drown_decisions() -> None:
    outcome, _first, _second = locked_completed_candidate_with_outcome()
    client = APIClient()
    client.force_authenticate(user=master("audit-filter@example.com"))

    everything = client.get("/api/audit-events/").json()["count"]
    outcomes_only = client.get(
        f"/api/audit-events/?action={AuditAction.OUTCOME_CREATED}",
    ).json()
    by_entity = client.get(
        f"/api/audit-events/?entity_type=CandidateOutcome&entity_id={outcome.pk}",
    ).json()

    assert outcomes_only["count"] == 1
    assert outcomes_only["count"] < everything
    assert by_entity["count"] >= 1
    assert all(r["entity_type"] == "CandidateOutcome" for r in by_entity["results"])


def test_the_log_searches_summary_entity_and_actor() -> None:
    actor = master("searchable-master@example.com")
    event = record(
        AuditAction.SESSION_CREATED,
        actor,
        "Winter grading opened for Colchester.",
        actor=actor,
    )
    client = APIClient()
    client.force_authenticate(user=actor)

    by_summary = client.get("/api/audit-events/?search=Colchester").json()
    by_entity = client.get(f"/api/audit-events/?search={actor.pk}").json()
    by_actor = client.get("/api/audit-events/?search=searchable-master").json()

    assert [row["id"] for row in by_summary["results"]] == [event.pk]
    assert [row["id"] for row in by_entity["results"]] == [event.pk]
    assert [row["id"] for row in by_actor["results"]] == [event.pk]


def test_the_log_is_read_only_over_http() -> None:
    client = APIClient()
    client.force_authenticate(user=master("audit-readonly@example.com"))

    assert client.post("/api/audit-events/", {}, format="json").status_code == 405
    assert client.delete("/api/audit-events/1/").status_code == 405


def test_an_unknown_filter_value_returns_nothing_rather_than_everything() -> None:
    locked_completed_candidate_with_outcome()
    client = APIClient()
    client.force_authenticate(user=master("audit-badfilter@example.com"))

    assert client.get("/api/audit-events/?action=NONSENSE").json()["count"] == 0


def test_deleting_a_session_records_what_was_cascaded_away() -> None:
    session, candidates = draft_session_with_candidates()
    actor = User.objects.get(email="audit-creator@example.com")

    from gradings.services import delete_grading_session

    delete_grading_session(session, actor=actor)

    event = AuditEvent.objects.get(action=AuditAction.SESSION_DELETED)
    cascaded = event.metadata["cascaded_candidates"]

    # Otherwise two candidates would disappear with nothing recording it.
    assert len(cascaded) == len(candidates)
    assert {c["student_wksa_id"] for c in cascaded} == {
        c.student.wksa_id for c in candidates
    }
    assert "removing 2 registered candidate(s)" in event.summary


# ---------------------------------------------------------------------------
# Logistics is an administrator concern (KG-048)
# ---------------------------------------------------------------------------


def administrator(email: str) -> User:
    return User.objects.create_user(email=email, role=User.Role.ADMINISTRATOR)


def test_master_authority_instructor_cannot_see_user_management_events_in_the_log() -> (
    None
):
    from accounts.services import create_platform_user

    admin_actor = administrator("audit-user-mgmt-admin@example.com")
    created = create_platform_user(
        email="audit-user-mgmt-target@example.com",
        password="Str0ng-Passphrase!42",
        actor=admin_actor,
    )
    client = APIClient()
    client.force_authenticate(user=master("audit-instructor-reader@example.com"))

    listing = client.get("/api/audit-events/")
    event_id = AuditEvent.objects.get(
        action=AuditAction.USER_CREATED,
        entity_id=str(created.pk),
    ).pk
    detail = client.get(f"/api/audit-events/{event_id}/")
    filtered = client.get("/api/audit-events/?action=USER_CREATED")

    assert AuditAction.USER_CREATED not in {
        row["action"] for row in listing.json()["results"]
    }
    assert detail.status_code == 404
    assert filtered.json()["count"] == 0


def test_administrator_can_see_user_management_events_in_the_log() -> None:
    from accounts.services import create_platform_user

    admin_actor = administrator("audit-user-mgmt-admin-2@example.com")
    created = create_platform_user(
        email="audit-user-mgmt-target-2@example.com",
        password="Str0ng-Passphrase!42",
        actor=admin_actor,
    )
    client = APIClient()
    client.force_authenticate(user=administrator("audit-admin-reader@example.com"))

    listing = client.get("/api/audit-events/")
    event_id = AuditEvent.objects.get(
        action=AuditAction.USER_CREATED,
        entity_id=str(created.pk),
    ).pk
    detail = client.get(f"/api/audit-events/{event_id}/")

    assert AuditAction.USER_CREATED in {
        row["action"] for row in listing.json()["results"]
    }
    assert detail.status_code == 200


def test_master_authority_instructor_still_sees_every_other_action_in_the_log() -> None:
    locked_completed_candidate_with_outcome()
    client = APIClient()
    client.force_authenticate(
        user=master("audit-instructor-general-reader@example.com")
    )

    # page_size raised well past the number of events this fixture writes,
    # so a large item-result trail cannot push SESSION_CREATED onto a
    # second page and produce a false failure here.
    response = client.get("/api/audit-events/?page_size=200")

    actions = {row["action"] for row in response.json()["results"]}
    assert AuditAction.SESSION_CREATED in actions
    assert AuditAction.CANDIDATE_REGISTERED in actions


# ---------------------------------------------------------------------------
# The grantable audit-log permission, and API/admin parity
# ---------------------------------------------------------------------------


def audit_log_reader(email: str) -> User:
    """A plain instructor granted only can_view_grading_audit_log."""
    return grant(user(email), "can_view_grading_audit_log", "candidateoutcome")


def user_created_event() -> AuditEvent:
    from accounts.services import create_platform_user

    created = create_platform_user(
        email="audit-parity-target@example.com",
        password="Str0ng-Passphrase!42",
        actor=administrator("audit-parity-admin@example.com"),
    )
    return AuditEvent.objects.get(
        action=AuditAction.USER_CREATED,
        entity_id=str(created.pk),
    )


def admin_view(viewer: User) -> tuple[AuditEventAdmin, HttpRequest]:
    request = RequestFactory().get("/admin/audit/auditevent/")
    request.user = viewer
    return AuditEventAdmin(AuditEvent, admin_site), request


def test_granted_instructor_can_read_the_log_but_not_user_management() -> None:
    locked_completed_candidate_with_outcome()
    user_event = user_created_event()
    client = APIClient()
    client.force_authenticate(user=audit_log_reader("audit-granted@example.com"))

    listing = client.get("/api/audit-events/?page_size=200")

    assert listing.status_code == 200
    actions = {row["action"] for row in listing.json()["results"]}
    assert AuditAction.SESSION_CREATED in actions
    assert AuditAction.USER_CREATED not in actions
    assert client.get(f"/api/audit-events/{user_event.pk}/").status_code == 404


def test_admin_grants_the_log_exactly_as_the_api_does() -> None:
    cases = [
        (user("audit-admin-plain@example.com"), False),
        (audit_log_reader("audit-admin-granted@example.com"), True),
        (master("audit-admin-master@example.com"), True),
        (administrator("audit-admin-administrator@example.com"), True),
    ]
    for viewer, expected in cases:
        model_admin, request = admin_view(viewer)
        assert model_admin.has_module_permission(request) is expected, viewer.email
        assert model_admin.has_view_permission(request) is expected, viewer.email


def test_admin_hides_user_management_events_exactly_as_the_api_does() -> None:
    user_event = user_created_event()

    master_admin, master_request = admin_view(master("audit-admin-m@example.com"))
    admin_admin, admin_request = admin_view(administrator("audit-admin-a@example.com"))

    assert user_event not in master_admin.get_queryset(master_request)
    assert user_event in admin_admin.get_queryset(admin_request)
