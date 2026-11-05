"""Grading sessions: model rules, lifecycle, API, admin and progress counts."""

from __future__ import annotations

from datetime import date

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.permissions import DELETE_ANY_SESSION_PERMISSION
from accounts.testing import grant_permission
from audit.models import AuditAction, AuditEvent
from gradings.models import (
    CandidateAssessment,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
)
from gradings.outcome_services import propose_for_candidate
from gradings.services import (
    apply_candidate_update,
    create_grading_session,
    transition_grading_session,
    update_grading_session,
    validate_session_transition,
)
from gradings.testing import (
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
    assert session.title == "March 2027 Riverside Grading"
    assert session.status == GradingSession.Status.DRAFT
    assert session.created_by == creator
    assert str(session) == "March 2027 Riverside Grading (2027-03-20)"


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

    with pytest.raises(ValidationError) as exc_info:
        update_grading_session(session, changes={"grading_date": date(2027, 4, 1)})

    assert "grading_date" in exc_info.value.message_dict
    session.refresh_from_db()
    assert session.grading_date == date(2027, 3, 20)
    assert not AuditEvent.objects.filter(action=AuditAction.SESSION_UPDATED).exists()


def test_grading_session_date_can_change_before_anyone_is_registered() -> None:
    session = grading_session()

    update_grading_session(session, changes={"grading_date": date(2027, 4, 1)})

    session.refresh_from_db()
    assert session.grading_date == date(2027, 4, 1)


def test_grading_session_default_status_is_draft() -> None:
    assert grading_session().status == GradingSession.Status.DRAFT


def test_creating_a_session_refuses_any_status_but_draft() -> None:
    creator = user("locked-on-create@example.com")

    with pytest.raises(ValidationError) as exc_info:
        create_grading_session(
            title="Locked on create",
            grading_date=date(2027, 3, 20),
            location="",
            notes="",
            created_by=creator,
            status=GradingSession.Status.LOCKED,
        )

    assert "New grading sessions must start in draft status." in str(exc_info.value)
    assert not GradingSession.objects.filter(title="Locked on create").exists()
    assert not AuditEvent.objects.filter(action=AuditAction.SESSION_CREATED).exists()


def test_creating_a_session_over_the_api_refuses_a_status_too() -> None:
    client = auth_client("api-locked-on-create@example.com")

    response = client.post(
        "/api/gradings/sessions/",
        {"title": "Locked on create", "grading_date": "2027-03-20", "status": "LOCKED"},
        format="json",
    )

    assert response.status_code == 400
    assert not GradingSession.objects.filter(title="Locked on create").exists()


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
            "location": "Riverside",
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


def test_session_api_status_takes_several_values_and_orders_either_way() -> None:
    early = grading_session(title="Early", grading_date=date(2027, 4, 1))
    opened = grading_session(
        title="Open",
        grading_date=date(2027, 5, 1),
        status=GradingSession.Status.OPEN,
    )
    grading_session(
        title="Done",
        grading_date=date(2027, 4, 15),
        status=GradingSession.Status.COMPLETED,
    )
    client = auth_client("session-filter-multi@example.com")

    either = client.get(
        "/api/gradings/sessions/?status=DRAFT,OPEN&ordering=grading_date",
    )
    newest_first = client.get("/api/gradings/sessions/?status=DRAFT,OPEN")
    unknown_status = client.get("/api/gradings/sessions/?status=DRAFT,NOPE")
    unknown_ordering = client.get("/api/gradings/sessions/?ordering=title")

    assert [item["id"] for item in results(either)] == [early.id, opened.id]
    assert [item["id"] for item in results(newest_first)] == [opened.id, early.id]
    assert results(unknown_status) == []
    assert results(unknown_ordering) == []


def test_session_years_lists_each_year_once_newest_first() -> None:
    for year, month in ((2025, 1), (2027, 3), (2027, 9), (2026, 6)):
        grading_session(grading_date=date(year, month, 1))
    client = auth_client("session-years@example.com")

    response = client.get("/api/gradings/sessions/years/")

    assert response.status_code == 200
    assert response.json() == {"years": [2027, 2026, 2025]}


def test_session_years_requires_authentication_and_the_view_permission() -> None:
    assert APIClient().get("/api/gradings/sessions/years/").status_code == 403
    bare = user("session-years-none@example.com")
    bare.groups.clear()
    bare.user_permissions.clear()
    client = APIClient()
    client.force_authenticate(user=type(bare).objects.get(pk=bare.pk))

    response = client.get("/api/gradings/sessions/years/")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


def test_session_api_searches_title_and_location() -> None:
    title_match = grading_session(title="Spring Black Belt Grading")
    location_match = grading_session(
        title="Junior Grading",
        location="Riverside Central Dojang",
    )
    grading_session(title="Unrelated", location="Ipswich")
    client = auth_client("session-search@example.com")

    title_response = client.get("/api/gradings/sessions/?search=black%20belt")
    location_response = client.get("/api/gradings/sessions/?search=riverside")

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


def test_the_update_service_edits_details_but_never_moves_the_status() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)

    update_grading_session(session, changes={"location": "New hall"})
    session.refresh_from_db()
    assert session.location == "New hall"

    with pytest.raises(ValidationError) as exc_info:
        update_grading_session(
            session,
            changes={"status": GradingSession.Status.LOCKED},
        )

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
    propose_for_candidate(
        proposed,
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


def cancelled_session(title: str, *, marked: bool) -> GradingSession:
    session = grading_session(title=title, status=GradingSession.Status.OPEN)
    sat = assessment(candidate=candidate(session=session))
    if marked:
        start_assessment(sat)
    GradingSession.objects.filter(pk=session.pk).update(
        status=GradingSession.Status.CANCELLED,
    )
    session.refresh_from_db()
    return session


def served_can_be_deleted(client: APIClient, session: GradingSession) -> bool:
    response = client.get(f"/api/gradings/sessions/{session.pk}/")
    assert response.status_code == 200
    return bool(response.json()["can_be_deleted"])


def test_can_be_deleted_follows_the_delete_rule_for_an_ordinary_user() -> None:
    client = auth_client("session-deletable-instructor@example.com")
    draft = grading_session(title="Draft")
    opened = grading_session(title="Open", status=GradingSession.Status.OPEN)
    untouched = cancelled_session("Cancelled, never started", marked=False)
    worked = cancelled_session("Cancelled, marked", marked=True)

    assert served_can_be_deleted(client, draft) is True
    assert served_can_be_deleted(client, opened) is False
    assert served_can_be_deleted(client, untouched) is True
    assert served_can_be_deleted(client, worked) is False


def test_can_be_deleted_agrees_with_what_the_delete_endpoint_does() -> None:
    client = auth_client("session-deletable-agree@example.com")
    for session in (
        cancelled_session("Marked", marked=True),
        cancelled_session("Unmarked", marked=False),
        grading_session(),
        grading_session(status=GradingSession.Status.OPEN),
    ):
        advertised = served_can_be_deleted(client, session)
        deleted = client.delete(f"/api/gradings/sessions/{session.pk}/")
        assert (deleted.status_code == 204) is advertised


def test_the_delete_any_permission_makes_every_session_deletable() -> None:
    holder = grant_permission(
        user("session-deletable-admin@example.com"), DELETE_ANY_SESSION_PERMISSION
    )
    client = APIClient()
    client.force_authenticate(user=holder)
    locked = grading_session(status=GradingSession.Status.LOCKED)

    assert served_can_be_deleted(client, locked) is True
    peer = auth_client("session-deletable-peer@example.com")
    assert served_can_be_deleted(peer, locked) is False


def test_listing_sessions_decides_deletability_without_a_query_per_session() -> None:
    client = auth_client("session-deletable-list@example.com")
    cancelled_session("First", marked=False)
    client.get("/api/gradings/sessions/")

    with CaptureQueriesContext(connection) as one:
        assert client.get("/api/gradings/sessions/").status_code == 200
    one_count = len(one.captured_queries)
    for title in ("Second", "Third", "Fourth"):
        cancelled_session(title, marked=True)
    with CaptureQueriesContext(connection) as many:
        response = client.get("/api/gradings/sessions/")
    many_count = len(many.captured_queries)

    flags = {
        row["title"]: row["can_be_deleted"]
        for row in response.json()["results"]
        if row["title"] in {"First", "Second", "Third", "Fourth"}
    }
    assert flags == {
        "First": True,
        "Second": False,
        "Third": False,
        "Fourth": False,
    }
    assert many_count == one_count


def test_a_status_and_field_edit_apply_together() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    complete_assessment(assessment(candidate=candidate(session=session)))

    update_grading_session(
        session,
        changes={"location": "Main hall"},
        target_status=GradingSession.Status.LOCKED,
        actor=user("session-mixed-valid@example.com"),
    )

    session.refresh_from_db()
    assert session.status == GradingSession.Status.LOCKED
    assert session.location == "Main hall"


def test_a_refused_transition_rolls_back_the_field_edit_with_it() -> None:
    session = grading_session(status=GradingSession.Status.OPEN, location="Old hall")
    candidate(session=session)

    with pytest.raises(ValidationError):
        update_grading_session(
            session,
            changes={"location": "Should roll back"},
            target_status=GradingSession.Status.LOCKED,
            actor=user("session-mixed-invalid@example.com"),
        )

    session.refresh_from_db()
    assert session.status == GradingSession.Status.OPEN
    assert session.location == "Old hall"


def test_a_lock_refused_for_an_unfinished_assessment_rolls_back_the_edit() -> None:
    session = grading_session(status=GradingSession.Status.OPEN, location="Old hall")
    assessment(candidate=candidate(session=session))

    with pytest.raises(ValidationError) as exc_info:
        update_grading_session(
            session,
            changes={"location": "Should roll back"},
            target_status=GradingSession.Status.LOCKED,
            actor=user("session-mixed-unstarted@example.com"),
        )

    assert "must be completed" in str(exc_info.value)
    session.refresh_from_db()
    assert session.status == GradingSession.Status.OPEN
    assert session.location == "Old hall"
