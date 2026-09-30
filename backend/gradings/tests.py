from __future__ import annotations

import importlib
import itertools
from datetime import date
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import patch

import pytest
from django.apps import apps
from django.contrib import admin
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.contrib.messages.storage.fallback import FallbackStorage
from django.contrib.sessions.backends.db import SessionStore
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.db.models.deletion import ProtectedError
from django.forms import ModelForm
from django.http import HttpRequest
from django.test import RequestFactory
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from accounts.permissions import (
    FINAL_GRADING_DECISION_PERMISSION,
    PROMOTE_STUDENT_PERMISSION,
)
from accounts.testing import grant_permission
from audit.models import AuditAction, AuditEvent
from gradings.admin import (
    CandidateAssessmentAdmin,
    CandidateOutcomeAdmin,
    GradingCandidateAdmin,
    GradingSessionAdmin,
    GradingSessionAdminForm,
    PromotionAdmin,
)
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    Promotion,
)
from gradings.services import (
    apply_candidate_update,
    build_candidate,
    bulk_register_candidates,
    candidate_assessment_summary,
    create_candidate_outcome,
    delete_candidate_assessment,
    delete_grading_session,
    finalise_candidate_outcome,
    generate_candidate_assessment,
    promote_candidate,
    propose_candidate_outcome,
    register_candidate,
    reopen_candidate_assessment,
    resolve_age_band,
    student_rank_timeline,
    transition_grading_session,
    update_candidate_assessment,
    update_candidate_assessment_item,
    validate_candidate_can_be_deleted,
    validate_session_transition,
    withdraw_locked_candidate,
)
from kukgrade.testing import results
from ranks.models import Rank
from students.models import Student
from syllabus.models import AgeBand, SyllabusItem, SyllabusRequirement
from syllabus.services import effective_syllabus_requirements

pytestmark = pytest.mark.django_db


def user(email: str = "grading-user@example.com", **overrides: Any) -> User:
    return User.objects.create_user(email=email, **overrides)


def rank(code: str) -> Rank:
    return Rank.objects.get(code=code)


_creator_counter = itertools.count()


def grading_session(**overrides: object) -> GradingSession:
    status = cast(str, overrides.pop("status", GradingSession.Status.DRAFT))
    data: dict[str, object] = {
        "title": "March 2027 Colchester Grading",
        "grading_date": date(2027, 3, 20),
    }
    if "created_by" not in overrides:
        data["created_by"] = user(f"creator-{next(_creator_counter)}@example.com")
    data.update(overrides)
    session = GradingSession.objects.create(**data)
    if status != GradingSession.Status.DRAFT:
        GradingSession.objects.filter(pk=session.pk).update(status=status)
        session.refresh_from_db()
    return session


def student(**overrides: object) -> Student:
    data: dict[str, object] = {
        "wksa_id": f"WKSA{Student.objects.count() + 1:04d}",
        "first_name": "Alex",
        "last_name": "Kim",
        "date_of_birth": date(2017, 3, 20),
        "current_rank": rank("WHITE"),
    }
    data.update(overrides)
    return Student.objects.create(**data)


def candidate(**overrides: object) -> GradingCandidate:
    session = overrides.pop("session", grading_session())
    candidate_student = overrides.pop("student", student())
    testing_for_rank = overrides.pop("testing_for_rank", rank("YELLOW_STRIPE"))
    status = overrides.pop("status", GradingCandidate.Status.REGISTERED)
    built = build_candidate(
        session=cast(GradingSession, session),
        student=cast(Student, candidate_student),
        testing_for_rank=cast(Rank, testing_for_rank),
        notes=cast(str, overrides.pop("notes", "")),
    )
    for key, value in overrides.items():
        setattr(built, key, value)
    built.save()
    if status == GradingCandidate.Status.WITHDRAWN:
        built = apply_candidate_update(
            built,
            status=GradingCandidate.Status.WITHDRAWN,
            withdrawal_reason=GradingCandidate.WithdrawalReason.ABSENT,
            actor=user(f"withdrawer-{built.pk}@example.com"),
        )
    return built


def assessment(**overrides: object) -> CandidateAssessment:
    built_candidate = cast(GradingCandidate, overrides.pop("candidate", candidate()))
    generated_by = cast(
        User,
        overrides.pop(
            "generated_by",
            user(
                f"generator-{User.objects.count()}-"
                f"{CandidateAssessment.objects.count()}@example.com"
            ),
        ),
    )
    return generate_candidate_assessment(built_candidate, generated_by)


def start_assessment(assessment: CandidateAssessment) -> CandidateAssessment:
    return update_candidate_assessment(
        assessment,
        status=CandidateAssessment.Status.IN_PROGRESS,
    )


def complete_assessment(
    assessment: CandidateAssessment,
    assessor: User | None = None,
) -> CandidateAssessment:
    assessment.refresh_from_db()
    if assessment.status == CandidateAssessment.Status.NOT_STARTED:
        assessment = start_assessment(assessment)
    assessment.items.filter(required=True).update(
        result=CandidateAssessmentItem.Result.MET,
        assessor=assessor or user(f"bulk-assessor-{assessment.pk}@example.com"),
        assessed_at=timezone.now(),
    )
    return update_candidate_assessment(
        assessment,
        status=CandidateAssessment.Status.COMPLETED,
    )


def master(email: str = "master@example.com") -> User:
    finaliser = user(email)
    grant_permission(finaliser, FINAL_GRADING_DECISION_PERMISSION)
    return finaliser


def promoter(email: str = "promoter@example.com") -> User:
    promotion_user = user(email)
    grant_permission(promotion_user, PROMOTE_STUDENT_PERMISSION)
    return promotion_user


def finalised_outcome(
    built: GradingCandidate,
    *,
    proposed: str = CandidateOutcome.Outcome.PASS,
    final: str = CandidateOutcome.Outcome.PASS,
    conditional_requirements: str = "",
) -> CandidateOutcome:
    suffix = f"{built.pk}-{CandidateOutcome.objects.count()}"
    outcome = create_candidate_outcome(built, user(f"outcome-{suffix}@example.com"))
    proposed_outcome = propose_candidate_outcome(
        outcome,
        proposed,
        "Ready for final decision.",
        user(f"proposer-{suffix}@example.com"),
    )
    return finalise_candidate_outcome(
        proposed_outcome,
        final,
        "Final decision recorded.",
        conditional_requirements,
        master(f"master-{suffix}@example.com"),
    )


def auth_client(email: str = "grading-api@example.com") -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user(email))
    return client


def admin_request(email: str = "grading-admin@example.com") -> HttpRequest:
    request = RequestFactory().post("/admin/gradings/gradingsession/")
    request.user = user(email)
    return cast(HttpRequest, request)


def test_valid_grading_session_can_be_created() -> None:
    creator = user("session-creator@example.com")
    session = grading_session(created_by=creator)

    assert session.pk is not None
    assert session.title == "March 2027 Colchester Grading"
    assert session.status == GradingSession.Status.DRAFT
    assert session.created_by == creator
    assert str(session) == "March 2027 Colchester Grading (2027-03-20)"


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

    session.grading_date = date(2027, 4, 1)

    with pytest.raises(ValidationError) as exc_info:
        session.save()

    assert "grading_date" in exc_info.value.message_dict
    session.refresh_from_db()
    assert session.grading_date == date(2027, 3, 20)


def test_grading_session_default_status_is_draft() -> None:
    assert grading_session().status == GradingSession.Status.DRAFT


def test_new_grading_session_must_start_in_draft_status() -> None:
    with pytest.raises(ValidationError) as exc_info:
        GradingSession.objects.create(
            title="Locked on create",
            grading_date=date(2027, 3, 20),
            status=GradingSession.Status.LOCKED,
            created_by=user("locked-on-create@example.com"),
        )

    assert "New grading sessions must start in draft status." in str(exc_info.value)


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


def test_assessment_covers_earlier_ranks_but_not_later_ranks_or_other_age_bands() -> (
    None
):
    built = candidate(
        student=student(date_of_birth=date(2016, 1, 1), current_rank=rank("YELLOW")),
        testing_for_rank=rank("BLUE_STRIPE"),
    )
    SyllabusRequirement.objects.create(
        rank=rank("BLUE"),
        item=SyllabusItem.objects.create(
            code="LATER_RANK_ITEM",
            name="Later Rank Item",
            category=SyllabusItem.Category.TECHNIQUE_SET,
        ),
        age_band=built.age_band,
        sequence=100,
    )
    SyllabusRequirement.objects.create(
        rank=rank("YELLOW"),
        item=SyllabusItem.objects.create(
            code="OTHER_BAND_ITEM",
            name="Other Band Item",
            category=SyllabusItem.Category.TECHNIQUE_SET,
        ),
        age_band=AgeBand.AGE_18_AND_OVER,
        sequence=100,
    )

    generated = assessment(candidate=built)

    codes = set(generated.items.values_list("item_code", flat=True))
    assert "SOHN_PPAE_KI" in codes  # introduced at Yellow Stripe
    assert "LATER_RANK_ITEM" not in codes
    assert "OTHER_BAND_ITEM" not in codes
    assert set(generated.items.values_list("source_age_band", flat=True)) == {
        built.age_band,
    }


def test_session_api_requires_authentication() -> None:
    response = APIClient().get("/api/gradings/sessions/")

    assert response.status_code == 403


def test_candidate_api_requires_authentication() -> None:
    response = APIClient().get("/api/gradings/candidates/")

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
            "location": "Colchester",
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


def test_session_api_searches_title_and_location() -> None:
    title_match = grading_session(title="Spring Black Belt Grading")
    location_match = grading_session(
        title="Junior Grading",
        location="Colchester Central Dojang",
    )
    grading_session(title="Unrelated", location="Ipswich")
    client = auth_client("session-search@example.com")

    title_response = client.get("/api/gradings/sessions/?search=black%20belt")
    location_response = client.get("/api/gradings/sessions/?search=colchester")

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


def test_direct_session_save_rejects_status_changes_and_allows_other_edits() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    session.location = "New hall"
    session.save()
    session.refresh_from_db()
    assert session.location == "New hall"

    session.status = GradingSession.Status.LOCKED
    with pytest.raises(ValidationError) as exc_info:
        session.save()

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


def test_admin_session_form_reports_transition_prerequisite_errors() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    candidate(session=session)
    form = GradingSessionAdminForm(
        data={
            "title": session.title,
            "grading_date": session.grading_date,
            "status": GradingSession.Status.LOCKED,
            "location": session.location,
            "notes": session.notes,
            "created_by": session.created_by_id,
        },
        instance=session,
    )

    assert form.is_valid() is False
    assert "status" in form.errors


def test_admin_session_form_reports_not_started_assessment_lock_error() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    assessment(candidate=candidate(session=session))
    form = GradingSessionAdminForm(
        data={
            "title": session.title,
            "grading_date": session.grading_date,
            "status": GradingSession.Status.LOCKED,
            "location": session.location,
            "notes": session.notes,
            "created_by": session.created_by_id,
        },
        instance=session,
    )

    assert form.is_valid() is False
    assert "status" in form.errors
    assert "must be completed" in str(form.errors["status"])


def test_admin_session_form_rejects_non_draft_initial_status() -> None:
    form = GradingSessionAdminForm(
        data={
            "title": "Locked on create",
            "grading_date": date(2027, 3, 20),
            "status": GradingSession.Status.LOCKED,
            "location": "",
            "notes": "",
            "created_by": user("admin-non-draft-create@example.com").id,
        },
    )

    assert form.is_valid() is False
    assert "status" in form.errors


def test_admin_created_session_is_persisted_and_audited() -> None:
    # Previously this went straight through ModelAdmin's default save,
    # bypassing create_grading_session() and its audit call entirely
    # (KG-036).
    creator = user("admin-session-creator@example.com")
    obj = GradingSession(
        title="Admin-created session",
        grading_date=date(2027, 11, 1),
        created_by=creator,
    )
    model_admin = GradingSessionAdmin(GradingSession, admin.site)
    request = admin_request("admin-session-operator@example.com")

    model_admin.save_model(
        request, obj, cast("ModelForm[Any]", SimpleNamespace(changed_data=[])), False
    )

    assert obj.pk is not None
    persisted = GradingSession.objects.get(pk=obj.pk)
    assert persisted.title == "Admin-created session"
    assert persisted.status == GradingSession.Status.DRAFT
    event = AuditEvent.objects.filter(
        action=AuditAction.SESSION_CREATED,
        entity_id=str(obj.pk),
    ).latest("occurred_at")
    assert event.actor == creator


def test_admin_session_save_uses_transition_service_for_status_changes() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    candidate(session=session)
    model_admin = GradingSessionAdmin(GradingSession, admin.site)
    session.status = GradingSession.Status.LOCKED
    form = cast("ModelForm[Any]", SimpleNamespace(changed_data=["status"]))

    with pytest.raises(ValidationError):
        model_admin.save_model(
            admin_request("session-admin-lock@example.com"),
            session,
            form,
            True,
        )

    session.refresh_from_db()
    assert session.status == GradingSession.Status.OPEN


def test_admin_session_save_handles_valid_status_and_field_change_atomically() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    complete_assessment(assessment(candidate=candidate(session=session)))
    model_admin = GradingSessionAdmin(GradingSession, admin.site)
    session.status = GradingSession.Status.LOCKED
    session.location = "Main hall"
    form = cast("ModelForm[Any]", SimpleNamespace(changed_data=["status", "location"]))

    model_admin.save_model(
        admin_request("session-admin-valid-mixed@example.com"),
        session,
        form,
        True,
    )

    session.refresh_from_db()
    assert session.status == GradingSession.Status.LOCKED
    assert session.location == "Main hall"


def test_admin_session_save_rolls_back_field_change_when_transition_fails() -> None:
    session = grading_session(status=GradingSession.Status.OPEN, location="Old hall")
    candidate(session=session)
    model_admin = GradingSessionAdmin(GradingSession, admin.site)
    session.status = GradingSession.Status.LOCKED
    session.location = "Should roll back"
    form = cast("ModelForm[Any]", SimpleNamespace(changed_data=["status", "location"]))

    with pytest.raises(ValidationError):
        model_admin.save_model(
            admin_request("session-admin-invalid-mixed@example.com"),
            session,
            form,
            True,
        )

    session.refresh_from_db()
    assert session.status == GradingSession.Status.OPEN
    assert session.location == "Old hall"


def test_admin_session_save_rolls_back_field_change_when_assessment_not_started() -> (
    None
):
    session = grading_session(status=GradingSession.Status.OPEN, location="Old hall")
    assessment(candidate=candidate(session=session))
    model_admin = GradingSessionAdmin(GradingSession, admin.site)
    session.status = GradingSession.Status.LOCKED
    session.location = "Should roll back"
    form = cast("ModelForm[Any]", SimpleNamespace(changed_data=["status", "location"]))

    with pytest.raises(ValidationError) as exc_info:
        model_admin.save_model(
            admin_request("session-admin-not-started-mixed@example.com"),
            session,
            form,
            True,
        )

    assert "must be completed" in str(exc_info.value)
    session.refresh_from_db()
    assert session.status == GradingSession.Status.OPEN
    assert session.location == "Old hall"


def test_admin_assessment_status_change_is_attributed_to_the_admin_user() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    generated = assessment(candidate=candidate(session=session))
    model_admin = CandidateAssessmentAdmin(CandidateAssessment, admin.site)
    generated.status = CandidateAssessment.Status.IN_PROGRESS
    form = cast("ModelForm[Any]", SimpleNamespace(changed_data=["status"]))
    admin_user = user("assessment-admin-actor@example.com")
    request = cast(HttpRequest, RequestFactory().post("/admin/"))
    request.user = admin_user

    model_admin.save_model(request, generated, form, True)

    event = AuditEvent.objects.filter(
        action=AuditAction.ASSESSMENT_STARTED,
    ).latest("occurred_at")
    assert event.actor == admin_user


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
    # call never ran (KG-036).
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
    other = student(wksa_id="SWAP0002")

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
    built.student = student(wksa_id="SWAP0002")

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
    candidate_student = student(wksa_id="FILTER001")
    built = candidate(session=session, student=candidate_student)
    candidate(
        session=grading_session(title="Other Session"),
        student=student(wksa_id="FILTER002", first_name="Blair"),
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
        student=student(wksa_id="OPENDELETE"),
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
    unassessed = candidate(session=open_session, student=student(wksa_id="FLAG001"))
    started = candidate(session=open_session, student=student(wksa_id="FLAG002"))
    start_assessment(assessment(candidate=started))
    prepared = candidate(session=draft_session, student=student(wksa_id="FLAG003"))
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
    first_student = student(wksa_id="BULKREG001")
    second_student = student(wksa_id="BULKREG002", first_name="Sam")
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
    white_student = student(wksa_id="BULKREG010", current_rank=rank("WHITE"))
    blue_student = student(
        wksa_id="BULKREG011",
        current_rank=rank("BLUE"),
        first_name="Robin",
    )
    brown_stripe_student = student(
        wksa_id="BULKREG012",
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
    valid_student = student(wksa_id="BULKREG003")
    already_registered_student = student(wksa_id="BULKREG004")
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
    first_student = student(wksa_id="BULKREG020")
    second_student = student(wksa_id="BULKREG021", first_name="Robin")
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
    registerable_student = student(wksa_id="BULKREG030")
    topped_out_student = student(
        wksa_id="BULKREG031",
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
    first_candidate = candidate(session=session, student=student(wksa_id="BULKGEN001"))
    second_candidate = candidate(session=session, student=student(wksa_id="BULKGEN002"))
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
    fresh_candidate = candidate(session=session, student=student(wksa_id="BULKGEN003"))
    already_assessed = candidate(session=session, student=student(wksa_id="BULKGEN004"))
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
        candidate=candidate(session=session, student=student(wksa_id="BULKSTART001")),
    )
    second_assessment = assessment(
        candidate=candidate(session=session, student=student(wksa_id="BULKSTART002")),
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
            student=student(wksa_id="BULKSTART003"),
        ),
    )
    # Generated while still draft (allowed), but starting requires the
    # session to already be open - this row fails independently of the
    # first, which is in an open session and starts cleanly.
    draft_session_assessment = assessment(
        candidate=candidate(
            session=grading_session(status=GradingSession.Status.DRAFT),
            student=student(wksa_id="BULKSTART004"),
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
    absent_first = candidate(session=session, student=student(wksa_id="BULKATT001"))
    absent_second = candidate(
        session=session,
        student=student(wksa_id="BULKATT002", first_name="Robin"),
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
        student=student(wksa_id="BULKATT003"),
    )
    locked_session_candidate = candidate(student=student(wksa_id="BULKATT004"))
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


def test_generate_candidate_assessment_creates_snapshot_items() -> None:
    built = candidate()
    generator = user("assessment-generator@example.com")
    requirements = effective_syllabus_requirements(
        rank=built.testing_for_rank,
        age_band=built.age_band,
    )

    generated = generate_candidate_assessment(built, generator)

    assert generated.candidate == built
    assert generated.generated_by == generator
    assert generated.status == CandidateAssessment.Status.NOT_STARTED
    assert generated.generated_at is not None
    assert [item.source_requirement for item in generated.items.all()] == [
        row.requirement for row in requirements
    ]
    assert [item.position for item in generated.items.all()] == list(
        range(1, len(requirements) + 1),
    )
    first_requirement = requirements[0].requirement
    first_item = generated.items.get(source_requirement=first_requirement)
    assert first_item.source_item == first_requirement.item
    assert first_item.source_rank == built.testing_for_rank
    assert first_item.source_age_band == built.age_band
    assert first_item.item_code == first_requirement.item.code
    assert first_item.item_name == first_requirement.item.name
    assert first_item.korean_name == first_requirement.item.korean_name
    assert first_item.category == first_requirement.item.category
    assert first_item.requirement_sequence == first_requirement.sequence
    assert first_item.required is first_requirement.required
    assert first_item.start_number == first_requirement.start_number
    assert first_item.end_number == first_requirement.end_number
    assert first_item.requirement_notes == first_requirement.notes


# The rank each worked-example candidate holds, and a birth date in each age
# band on the default session's grading date (2027-03-20).
RANK_BEFORE = {"BLUE_STRIPE": "YELLOW", "JKN": "DAHN_BO"}
BORN_IN_BAND: dict[str, date] = {
    AgeBand.AGE_8_AND_UNDER: date(2020, 1, 1),
    AgeBand.AGE_9_TO_12: date(2016, 1, 1),
    AgeBand.AGE_13_TO_17: date(2012, 1, 1),
    AgeBand.AGE_18_AND_OVER: date(1990, 1, 1),
}


@pytest.mark.parametrize("testing_for", ["BLUE_STRIPE", "JKN"])
@pytest.mark.parametrize("age_band", AgeBand.values)
def test_assessment_snapshots_the_cumulative_syllabus_the_browser_serves(
    testing_for: str,
    age_band: str,
) -> None:
    # One resolver behind both (KG-A05): what the syllabus screen lists for a
    # rank and age band is exactly what a grading for them assesses, in the
    # same order. syllabus/tests.py pins that content for these cases.
    built = candidate(
        student=student(
            date_of_birth=BORN_IN_BAND[age_band],
            current_rank=rank(RANK_BEFORE[testing_for]),
        ),
        testing_for_rank=rank(testing_for),
    )
    assert built.age_band == age_band

    generated = assessment(candidate=built)
    served = auth_client(f"browser-{testing_for}-{age_band}@example.com").get(
        "/api/syllabus/requirements/effective/",
        {"rank_code": testing_for, "age_band": age_band, "page_size": "200"},
    )

    assert [
        (
            item.position,
            item.category,
            item.item_code,
            item.display_range,
            item.requirement_notes,
            item.required,
        )
        for item in generated.items.all()
    ] == [
        (
            position,
            row["category"],
            row["item_code"],
            row["display_range"],
            row["notes"],
            row["required"],
        )
        for position, row in enumerate(results(served), start=1)
    ]


def test_assessment_item_extended_at_an_earlier_rank_records_that_rank() -> None:
    built = candidate(
        student=student(
            date_of_birth=BORN_IN_BAND[AgeBand.AGE_18_AND_OVER],
            current_rank=rank("YELLOW"),
        ),
        testing_for_rank=rank("BLUE_STRIPE"),
    )

    generated = assessment(candidate=built)

    # Ki Bohn Soo was introduced at Yellow Stripe and extended to 1-15 at
    # Yellow; a Blue Stripe grading still assesses all fifteen.
    ki_bohn_soo = generated.items.get(item_code="KI_BOHN_SOO")
    assert ki_bohn_soo.source_rank == rank("YELLOW")
    assert ki_bohn_soo.source_requirement == SyllabusRequirement.objects.get(
        rank__code="YELLOW",
        age_band=AgeBand.AGE_18_AND_OVER,
        item__code="KI_BOHN_SOO",
    )
    assert ki_bohn_soo.display_range == "1-15"
    assert ki_bohn_soo.required is True


def test_generate_candidate_assessment_retains_optional_requirements() -> None:
    built = candidate()
    optional_item = SyllabusItem.objects.create(
        code="OPTIONAL_ASSESSMENT_ITEM",
        name="Optional Assessment Item",
        category=SyllabusItem.Category.OTHER,
    )
    optional_requirement = SyllabusRequirement.objects.create(
        rank=built.testing_for_rank,
        item=optional_item,
        age_band=built.age_band,
        required=False,
        sequence=999,
        notes="May be assessed if time allows.",
    )

    generated = assessment(candidate=built)

    snapshot = generated.items.get(source_requirement=optional_requirement)
    assert snapshot.required is False
    assert snapshot.requirement_notes == "May be assessed if time allows."


def test_generate_candidate_assessment_excludes_inactive_requirements_and_items() -> (
    None
):
    built = candidate()
    inactive_item = SyllabusItem.objects.create(
        code="INACTIVE_ASSESSMENT_ITEM",
        name="Inactive Assessment Item",
        category=SyllabusItem.Category.OTHER,
        active=False,
    )
    inactive_requirement_item = SyllabusItem.objects.create(
        code="INACTIVE_REQUIREMENT_ITEM",
        name="Inactive Requirement Item",
        category=SyllabusItem.Category.OTHER,
    )
    SyllabusRequirement.objects.create(
        rank=built.testing_for_rank,
        item=inactive_item,
        age_band=built.age_band,
        sequence=990,
    )
    SyllabusRequirement.objects.create(
        rank=built.testing_for_rank,
        item=inactive_requirement_item,
        age_band=built.age_band,
        sequence=991,
        active=False,
    )

    generated = assessment(candidate=built)

    assert not generated.items.filter(
        item_code__in=["INACTIVE_ASSESSMENT_ITEM", "INACTIVE_REQUIREMENT_ITEM"],
    ).exists()


def test_generate_candidate_assessment_refuses_a_rank_with_no_recorded_syllabus() -> (
    None
):
    # Everything through JKN is recorded, but nothing for KSN itself: that is
    # not KSN's syllabus, so no assessment is generated from it.
    built = candidate(
        student=student(
            date_of_birth=BORN_IN_BAND[AgeBand.AGE_18_AND_OVER],
            current_rank=rank("JKN"),
        ),
        testing_for_rank=rank("KSN"),
    )

    with pytest.raises(ValidationError) as exc_info:
        assessment(candidate=built)

    assert exc_info.value.message_dict["candidate"] == [
        "No syllabus is recorded for KSN (18+), so this candidate cannot be "
        "assessed yet.",
    ]
    assert not CandidateAssessment.objects.filter(candidate=built).exists()


@pytest.mark.parametrize(
    "session_status",
    [
        GradingSession.Status.LOCKED,
        GradingSession.Status.COMPLETED,
        GradingSession.Status.CANCELLED,
    ],
)
def test_generate_candidate_assessment_rejected_for_closed_session_states(
    session_status: str,
) -> None:
    built = candidate()
    GradingSession.objects.filter(pk=built.session_id).update(status=session_status)
    built.session.refresh_from_db()

    with pytest.raises(ValidationError):
        assessment(candidate=built)


def test_generate_candidate_assessment_rejects_duplicate_generation() -> None:
    built = candidate()
    assessment(candidate=built)

    with pytest.raises(ValidationError):
        assessment(candidate=built)


def test_duplicate_assessment_is_prevented_at_database_level() -> None:
    built = candidate()
    generator = user("db-duplicate-generator@example.com")
    CandidateAssessment.objects.create(candidate=built, generated_by=generator)

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateAssessment.objects.bulk_create(
            [CandidateAssessment(candidate=built, generated_by=generator)],
        )


def test_generation_is_atomic_if_item_creation_fails() -> None:
    built = candidate()
    requirement = effective_syllabus_requirements(
        rank=built.testing_for_rank,
        age_band=built.age_band,
    )[0]

    # The same requirement twice breaks the item snapshot's own uniqueness: a
    # defect in the data, not a second assessment. It surfaces as the
    # integrity error it is rather than as "already has an assessment"
    # (KG-A11), and takes the half-built assessment with it.
    with (
        patch(
            "gradings.services.effective_syllabus_requirements",
            return_value=[requirement, requirement],
        ),
        pytest.raises(IntegrityError),
        transaction.atomic(),
    ):
        generate_candidate_assessment(built, user("snapshot-defect@example.com"))

    assert not CandidateAssessment.objects.filter(candidate=built).exists()


def test_assessment_snapshot_survives_live_syllabus_edits() -> None:
    generated = assessment()
    snapshot = generated.items.select_related(
        "source_requirement", "source_item"
    ).first()
    assert snapshot is not None
    source_requirement = snapshot.source_requirement
    source_item = snapshot.source_item
    assert source_requirement is not None
    assert source_item is not None

    original_name = snapshot.item_name
    original_start = snapshot.start_number
    original_end = snapshot.end_number
    source_item.name = "Changed Live Item Name"
    source_item.save()
    source_requirement.start_number = 99
    source_requirement.end_number = 100
    source_requirement.notes = "Changed live notes"
    source_requirement.save()

    snapshot.refresh_from_db()
    assert snapshot.item_name == original_name
    assert snapshot.start_number == original_start
    assert snapshot.end_number == original_end
    assert snapshot.requirement_notes != "Changed live notes"


def test_deleting_source_requirement_and_item_preserves_snapshot_display_data() -> None:
    built = candidate()
    source_item = SyllabusItem.objects.create(
        code="DELETABLE_SOURCE_ITEM",
        name="Deletable Source Item",
        category=SyllabusItem.Category.OTHER,
    )
    source_requirement = SyllabusRequirement.objects.create(
        rank=built.testing_for_rank,
        item=source_item,
        age_band=built.age_band,
        sequence=997,
    )
    generated = assessment(candidate=built)
    snapshot = generated.items.select_related("source_requirement", "source_item").get(
        source_requirement=source_requirement
    )
    assert snapshot is not None
    item_name = snapshot.item_name
    item_code = snapshot.item_code

    source_requirement.delete()
    source_item.delete()

    snapshot.refresh_from_db()
    assert snapshot.source_requirement is None
    assert snapshot.source_item is None
    assert snapshot.item_name == item_name
    assert snapshot.item_code == item_code


def test_assessment_lifecycle_requires_start_before_completion() -> None:
    generated = assessment(
        candidate=candidate(session=grading_session(status=GradingSession.Status.OPEN))
    )

    with pytest.raises(ValidationError):
        update_candidate_assessment(
            generated,
            status=CandidateAssessment.Status.COMPLETED,
        )

    started = update_candidate_assessment(
        generated,
        status=CandidateAssessment.Status.IN_PROGRESS,
    )

    assert started.status == CandidateAssessment.Status.IN_PROGRESS
    assert started.started_at is not None


def test_not_started_assessment_cannot_begin_in_locked_session() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    generated = assessment(candidate=candidate(session=session))
    GradingSession.objects.filter(pk=session.pk).update(
        status=GradingSession.Status.LOCKED,
    )

    with pytest.raises(ValidationError) as exc_info:
        update_candidate_assessment(
            generated,
            status=CandidateAssessment.Status.IN_PROGRESS,
        )

    assert "open sessions" in str(exc_info.value)
    generated.refresh_from_db()
    assert generated.status == CandidateAssessment.Status.NOT_STARTED


def test_assessment_completion_requires_required_items_and_completes_candidate() -> (
    None
):
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    generated = assessment(candidate=built)
    update_candidate_assessment(
        generated, status=CandidateAssessment.Status.IN_PROGRESS
    )

    with pytest.raises(ValidationError):
        update_candidate_assessment(
            generated, status=CandidateAssessment.Status.COMPLETED
        )

    generated.items.filter(required=True).update(
        result=CandidateAssessmentItem.Result.MET,
        assessor=user(f"inline-assessor-{generated.pk}@example.com"),
        assessed_at=timezone.now(),
    )
    completed = update_candidate_assessment(
        generated,
        status=CandidateAssessment.Status.COMPLETED,
    )

    built.refresh_from_db()
    assert completed.status == CandidateAssessment.Status.COMPLETED
    assert completed.completed_at is not None
    assert built.status == GradingCandidate.Status.COMPLETED


def test_optional_not_assessed_items_do_not_block_completion() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    optional_item = SyllabusItem.objects.create(
        code="OPTIONAL_COMPLETION_ITEM",
        name="Optional Completion Item",
        category=SyllabusItem.Category.OTHER,
    )
    SyllabusRequirement.objects.create(
        rank=built.testing_for_rank,
        item=optional_item,
        age_band=built.age_band,
        required=False,
        sequence=998,
    )
    generated = assessment(candidate=built)
    update_candidate_assessment(
        generated, status=CandidateAssessment.Status.IN_PROGRESS
    )
    generated.items.filter(required=True).update(
        result=CandidateAssessmentItem.Result.MET,
        assessor=user(f"inline-assessor-{generated.pk}@example.com"),
        assessed_at=timezone.now(),
    )

    completed = update_candidate_assessment(
        generated,
        status=CandidateAssessment.Status.COMPLETED,
    )

    assert completed.status == CandidateAssessment.Status.COMPLETED
    assert generated.items.get(item_code="OPTIONAL_COMPLETION_ITEM").result == (
        CandidateAssessmentItem.Result.NOT_ASSESSED
    )


def test_completed_assessment_is_immutable() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    generated = assessment(candidate=built)
    update_candidate_assessment(
        generated, status=CandidateAssessment.Status.IN_PROGRESS
    )
    generated.items.filter(required=True).update(
        result=CandidateAssessmentItem.Result.MET,
        assessor=user(f"inline-assessor-{generated.pk}@example.com"),
        assessed_at=timezone.now(),
    )
    completed = update_candidate_assessment(
        generated,
        status=CandidateAssessment.Status.COMPLETED,
    )

    with pytest.raises(ValidationError):
        update_candidate_assessment(completed, notes="Too late")
    completed_item = completed.items.first()
    assert completed_item is not None
    with pytest.raises(ValidationError):
        update_candidate_assessment_item(
            completed_item,
            result=CandidateAssessmentItem.Result.NOT_MET,
            assessor=user("too-late-assessor@example.com"),
        )


def test_assessment_item_result_updates_set_and_clear_assessor_metadata() -> None:
    generated = assessment(
        candidate=candidate(session=grading_session(status=GradingSession.Status.OPEN))
    )
    update_candidate_assessment(
        generated,
        status=CandidateAssessment.Status.IN_PROGRESS,
    )
    item = generated.items.first()
    assert item is not None
    assessor = user("item-assessor@example.com")

    updated = update_candidate_assessment_item(
        item,
        result=CandidateAssessmentItem.Result.MET,
        assessor_notes="Strong basics",
        assessor=assessor,
    )

    assert updated.result == CandidateAssessmentItem.Result.MET
    assert updated.assessor == assessor
    assert updated.assessed_at is not None
    assert updated.assessor_notes == "Strong basics"
    updated.assessment.refresh_from_db()
    assert updated.assessment.status == CandidateAssessment.Status.IN_PROGRESS

    reset = update_candidate_assessment_item(
        updated,
        result=CandidateAssessmentItem.Result.NOT_ASSESSED,
        assessor=assessor,
    )

    assert reset.assessor is None
    assert reset.assessed_at is None


def test_assessment_item_update_rejected_until_assessment_is_started() -> None:
    generated = assessment(
        candidate=candidate(session=grading_session(status=GradingSession.Status.OPEN))
    )
    item = generated.items.first()
    assert item is not None

    with pytest.raises(ValidationError):
        update_candidate_assessment_item(
            item,
            result=CandidateAssessmentItem.Result.MET,
            assessor_notes="Should not save",
            assessor=user("not-started-assessor@example.com"),
        )

    item.refresh_from_db()
    generated.refresh_from_db()
    assert item.result == CandidateAssessmentItem.Result.NOT_ASSESSED
    assert item.assessor is None
    assert item.assessed_at is None
    assert item.assessor_notes == ""
    assert generated.status == CandidateAssessment.Status.NOT_STARTED


def test_not_started_assessment_item_update_rejected_in_locked_session() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    GradingSession.objects.filter(pk=session.pk).update(
        status=GradingSession.Status.LOCKED,
    )
    session.refresh_from_db()
    item = generated.items.first()
    assert item is not None

    with pytest.raises(ValidationError):
        update_candidate_assessment_item(
            item,
            result=CandidateAssessmentItem.Result.MET,
            assessor=user("locked-not-started-assessor@example.com"),
        )

    generated.refresh_from_db()
    item.refresh_from_db()
    assert generated.status == CandidateAssessment.Status.NOT_STARTED
    assert item.result == CandidateAssessmentItem.Result.NOT_ASSESSED


def test_a_completed_assessment_can_be_reopened_while_the_session_is_open() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    complete_assessment(generated)
    item = generated.items.first()
    assert item is not None
    recorded = (item.result, item.assessor_id, item.assessed_at)

    response = auth_client("reopen-instructor@example.com").post(
        f"/api/gradings/assessments/{generated.pk}/reopen/",
    )

    assert response.status_code == 200
    assert response.json()["status"] == CandidateAssessment.Status.IN_PROGRESS
    generated.refresh_from_db()
    built.refresh_from_db()
    item.refresh_from_db()
    assert generated.completed_at is None
    assert built.status == GradingCandidate.Status.REGISTERED
    assert (item.result, item.assessor_id, item.assessed_at) == recorded
    assert AuditEvent.objects.filter(
        action=AuditAction.ASSESSMENT_REOPENED,
        entity_id=str(generated.pk),
    ).exists()


def test_reopening_is_refused_once_the_session_locks_or_before_completion() -> None:
    locked_built, locked_generated = locked_completed_candidate()
    open_session = grading_session(status=GradingSession.Status.OPEN)
    in_progress = assessment(candidate=candidate(session=open_session))
    start_assessment(in_progress)
    actor = user("reopen-refused@example.com")

    with pytest.raises(ValidationError) as locked_exc:
        reopen_candidate_assessment(locked_generated, actor)
    with pytest.raises(ValidationError) as in_progress_exc:
        reopen_candidate_assessment(in_progress, actor)

    assert "session is open" in str(locked_exc.value)
    assert "Only a completed assessment" in str(in_progress_exc.value)
    locked_generated.refresh_from_db()
    assert locked_generated.status == CandidateAssessment.Status.COMPLETED


def test_reopen_requires_the_change_assessment_permission() -> None:
    generated = assessment(
        candidate=candidate(session=grading_session(status=GradingSession.Status.OPEN)),
    )
    bare = user("no-perms@example.com")
    bare.groups.clear()
    client = APIClient()
    client.force_authenticate(user=User.objects.get(pk=bare.pk))

    response = client.post(f"/api/gradings/assessments/{generated.pk}/reopen/")

    assert response.status_code == 403


def test_the_model_refuses_a_candidate_created_in_any_status_but_registered() -> None:
    # Admin and the shell reach the model directly, not the serializer.
    built = build_candidate(
        session=grading_session(),
        student=student(wksa_id="REGWD003"),
        testing_for_rank=rank("YELLOW_STRIPE"),
    )
    built.status = GradingCandidate.Status.COMPLETED

    with pytest.raises(ValidationError) as exc_info:
        built.save()

    assert "status" in exc_info.value.message_dict


def test_item_results_cannot_change_once_the_session_locks() -> None:
    # Unreachable through the services, since a session cannot lock with an
    # assessment in progress - forced here so the guard itself is proven.
    session = grading_session(status=GradingSession.Status.OPEN)
    generated = assessment(candidate=candidate(session=session))
    start_assessment(generated)
    GradingSession.objects.filter(pk=session.pk).update(
        status=GradingSession.Status.LOCKED,
    )
    item = generated.items.first()
    assert item is not None

    with pytest.raises(ValidationError) as exc_info:
        update_candidate_assessment_item(
            item,
            result=CandidateAssessmentItem.Result.MET,
            assessor=user("locked-in-progress-assessor@example.com"),
        )

    assert "open session" in str(exc_info.value)


@pytest.mark.parametrize(
    "session_status",
    [
        GradingSession.Status.COMPLETED,
        GradingSession.Status.CANCELLED,
    ],
)
def test_assessment_item_update_rejected_in_terminal_sessions(
    session_status: str,
) -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    generated = assessment(candidate=candidate(session=session))
    update_candidate_assessment(
        generated,
        status=CandidateAssessment.Status.IN_PROGRESS,
    )
    GradingSession.objects.filter(pk=session.pk).update(status=session_status)
    item = generated.items.first()
    assert item is not None

    with pytest.raises(ValidationError):
        update_candidate_assessment_item(
            item,
            result=CandidateAssessmentItem.Result.MET,
            assessor=user(f"terminal-{session_status.lower()}@example.com"),
        )

    item.refresh_from_db()
    assert item.result == CandidateAssessmentItem.Result.NOT_ASSESSED


def test_assessment_item_result_update_rejected_in_draft_session() -> None:
    generated = assessment(
        candidate=candidate(session=grading_session(status=GradingSession.Status.DRAFT))
    )
    generated.status = CandidateAssessment.Status.IN_PROGRESS
    generated.started_at = timezone.now()
    generated.save()
    item = generated.items.first()
    assert item is not None

    with pytest.raises(ValidationError):
        update_candidate_assessment_item(
            item,
            result=CandidateAssessmentItem.Result.MET,
            assessor=user("draft-result@example.com"),
        )


def test_candidate_core_fields_cannot_change_after_assessment_generation() -> None:
    generated = assessment()
    built = generated.candidate
    built.student = student(wksa_id="CHANGEDCORE")

    with pytest.raises(ValidationError):
        built.save()


def test_candidate_deletion_allowed_only_for_draft_unstarted_assessment() -> None:
    draft_candidate = candidate(
        session=grading_session(status=GradingSession.Status.DRAFT)
    )
    assessment(candidate=draft_candidate)
    draft_candidate.delete()
    assert not GradingCandidate.objects.filter(pk=draft_candidate.pk).exists()

    open_candidate = candidate(
        session=grading_session(status=GradingSession.Status.OPEN)
    )
    open_assessment = assessment(candidate=open_candidate)
    update_candidate_assessment(
        open_assessment,
        status=CandidateAssessment.Status.IN_PROGRESS,
    )

    with pytest.raises(ValidationError):
        validate_candidate_can_be_deleted(open_candidate)


def test_session_lock_and_completion_require_assessments() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)

    with pytest.raises(ValidationError):
        validate_session_transition(
            GradingSession.Status.OPEN,
            GradingSession.Status.LOCKED,
            session=session,
        )

    generated = assessment(candidate=built)
    with pytest.raises(ValidationError):
        validate_session_transition(
            GradingSession.Status.OPEN,
            GradingSession.Status.LOCKED,
            session=session,
        )

    start_assessment(generated)
    with pytest.raises(ValidationError):
        validate_session_transition(
            GradingSession.Status.OPEN,
            GradingSession.Status.LOCKED,
            session=session,
        )

    complete_assessment(generated)
    session = transition_grading_session(session, GradingSession.Status.LOCKED)
    with pytest.raises(ValidationError):
        validate_session_transition(
            GradingSession.Status.LOCKED,
            GradingSession.Status.COMPLETED,
            session=session,
        )
    finalised_outcome(built)
    validate_session_transition(
        GradingSession.Status.LOCKED,
        GradingSession.Status.COMPLETED,
        session=session,
    )


def test_withdrawn_candidates_do_not_block_session_completion() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    built.status = GradingCandidate.Status.WITHDRAWN
    built.save()

    validate_session_transition(
        GradingSession.Status.OPEN,
        GradingSession.Status.LOCKED,
        session=session,
    )
    session = transition_grading_session(session, GradingSession.Status.LOCKED)
    validate_session_transition(
        GradingSession.Status.LOCKED,
        GradingSession.Status.COMPLETED,
        session=session,
    )


def test_direct_candidate_completed_spoofing_rejected_through_api() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    client = auth_client("candidate-complete-spoof@example.com")

    response = client.post(
        "/api/gradings/candidates/bulk-update-status/",
        {"candidates": [built.id], "status": GradingCandidate.Status.COMPLETED},
        format="json",
    )

    assert response.status_code == 200
    assert list(response.json()["errors"]) == ["0"]
    built.refresh_from_db()
    assert built.status == GradingCandidate.Status.REGISTERED


def test_assessment_api_generation_lists_and_filters() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    client = auth_client("assessment-api@example.com")

    unauthenticated = APIClient().post(
        f"/api/gradings/candidates/{built.id}/generate-assessment/",
    )
    generate_response = client.post(
        f"/api/gradings/candidates/{built.id}/generate-assessment/",
    )
    duplicate_response = client.post(
        f"/api/gradings/candidates/{built.id}/generate-assessment/",
    )

    assert unauthenticated.status_code == 403
    assert generate_response.status_code == 201
    assert duplicate_response.status_code == 400
    payload = generate_response.json()
    assert payload["candidate"] == built.id
    assert CandidateAssessmentItem.objects.filter(
        assessment_id=payload["id"],
    ).exists()
    assert "outcome" not in payload

    list_response = client.get(
        "/api/gradings/assessments/"
        f"?candidate={built.id}&session={session.id}"
        f"&student_wksa_id={built.student.wksa_id}"
        "&testing_for_rank_code=YELLOW_STRIPE"
        "&status=NOT_STARTED",
    )
    post_response = client.post("/api/gradings/assessments/", {}, format="json")

    assert list_response.status_code == 200
    assert [item["id"] for item in results(list_response)] == [payload["id"]]
    assert post_response.status_code == 405


def test_assessment_summary_is_served_while_the_assessment_is_in_progress() -> None:
    # The whole point of this endpoint: the outcome route is unreachable here,
    # because a CandidateOutcome needs a LOCKED session and a COMPLETED
    # assessment. See FDR-046.
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    generated = assessment(
        candidate=built,
        status=CandidateAssessment.Status.IN_PROGRESS,
    )
    items = list(generated.items.order_by("pk"))
    assert len(items) >= 2
    scored_at = timezone.now()
    assessor = user("assessment-summary-assessor@example.com")
    items[0].result = CandidateAssessmentItem.Result.MET
    items[0].assessor = assessor
    items[0].assessed_at = scored_at
    items[0].save()
    items[1].result = CandidateAssessmentItem.Result.NOT_MET
    items[1].assessor = assessor
    items[1].assessed_at = scored_at
    items[1].save()

    client = auth_client("assessment-summary@example.com")

    response = client.get(f"/api/gradings/assessments/{generated.id}/summary/")

    assert response.status_code == 200
    payload = response.json()
    assert payload == candidate_assessment_summary(generated)
    assert payload["overall"]["met"] == 1
    assert payload["overall"]["not_met"] == 1
    assert payload["overall"]["required_not_assessed"] == (
        generated.items.filter(
            required=True,
            result=CandidateAssessmentItem.Result.NOT_ASSESSED,
        ).count()
    )
    assert {category["category"] for category in payload["categories"]} == {
        item.category for item in generated.items.all()
    }


def test_assessment_list_serves_each_assessments_overall_counts() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    generated = assessment(
        candidate=candidate(session=session),
        status=CandidateAssessment.Status.IN_PROGRESS,
    )
    first = generated.items.order_by("pk").first()
    assert first is not None
    first.result = CandidateAssessmentItem.Result.NOT_MET
    first.assessor = user("assessment-list-assessor@example.com")
    first.assessed_at = timezone.now()
    first.save()
    client = auth_client("assessment-list-counts@example.com")

    response = client.get(f"/api/gradings/assessments/?session={session.id}")

    assert response.status_code == 200
    [served] = results(response)
    assert served["overall"] == candidate_assessment_summary(generated)["overall"]
    assert served["overall"]["not_met"] == 1


def test_assessment_list_query_count_does_not_grow_with_the_cohort() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    assessment(candidate=candidate(session=session))
    client = auth_client("assessment-list-queries@example.com")
    url = f"/api/gradings/assessments/?session={session.id}"
    client.get(url)

    with CaptureQueriesContext(connection) as one:
        client.get(url)
    for _ in range(3):
        assessment(candidate=candidate(session=session))
    with CaptureQueriesContext(connection) as four:
        response = client.get(url)

    assert len(results(response)) == 4
    assert len(four.captured_queries) == len(one.captured_queries)


def test_assessment_summary_requires_the_view_permission() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    generated = assessment(candidate=built)
    client = APIClient()

    response = client.get(f"/api/gradings/assessments/{generated.id}/summary/")

    assert response.status_code == 403


def test_assessment_summary_rejects_a_write() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    generated = assessment(candidate=built)
    client = auth_client("assessment-summary-readonly@example.com")

    response = client.post(
        f"/api/gradings/assessments/{generated.id}/summary/",
        {},
        format="json",
    )

    assert response.status_code == 405


def test_assessment_delete_requires_the_cleanup_permission() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    generated = assessment(candidate=built)
    client = auth_client("assessment-delete-forbidden@example.com")

    response = client.delete(f"/api/gradings/assessments/{generated.id}/")

    assert response.status_code == 403
    assert CandidateAssessment.objects.filter(pk=generated.pk).exists()


def test_administrator_can_delete_a_not_started_assessment() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    generated = assessment(candidate=built)
    admin = User.objects.create_user(
        email="assessment-delete-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    client = APIClient()
    client.force_authenticate(user=admin)

    response = client.delete(f"/api/gradings/assessments/{generated.id}/")

    assert response.status_code == 204
    assert not CandidateAssessment.objects.filter(pk=generated.pk).exists()


def test_deleting_completed_assessment_cascades_and_reverts_rank() -> None:
    built, generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    actor = promoter("assessment-cascade-delete@example.com")
    promotion = promote_candidate(outcome, actor)
    student = built.student
    student.refresh_from_db()
    assert student.current_rank == promotion.to_rank

    admin = User.objects.create_user(
        email="assessment-cascade-delete-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    events_before = AuditEvent.objects.count()

    delete_candidate_assessment(generated, admin)

    student.refresh_from_db()
    assert student.current_rank == promotion.from_rank
    assert not CandidateAssessment.objects.filter(pk=generated.pk).exists()
    assert not CandidateOutcome.objects.filter(pk=outcome.pk).exists()
    assert not Promotion.objects.filter(pk=promotion.pk).exists()
    cascade_event = AuditEvent.objects.filter(
        entity_type="CandidateAssessment",
        entity_id=str(generated.pk),
        action=AuditAction.ASSESSMENT_DELETED,
    ).get()
    assert cascade_event.metadata["had_outcome"] is True
    assert cascade_event.metadata["had_promotion"] is True
    assert cascade_event.metadata["reverted_student_rank"] == {
        "from": promotion.to_rank.code,
        "to": promotion.from_rank.code,
    }
    assert AuditEvent.objects.count() == events_before + 1


def test_deleting_an_assessment_is_refused_when_a_later_promotion_exists() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    actor = promoter("assessment-delete-later-promotion@example.com")
    promotion = promote_candidate(outcome, actor)

    # The student has since been promoted again through a second grading -
    # this promotion is no longer "the" record of the student's rank, so
    # reverting it would silently corrupt the student's current rank.
    student = built.student
    student.refresh_from_db()
    Student.objects.filter(pk=student.pk).update(current_rank=rank("YELLOW"))

    admin = User.objects.create_user(
        email="assessment-delete-later-promotion-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )

    with pytest.raises(ValidationError):
        delete_candidate_assessment(outcome.assessment, admin)

    assert Promotion.objects.filter(pk=promotion.pk).exists()


def test_assessment_api_lifecycle_patch_uses_service_rules() -> None:
    generated = assessment(
        candidate=candidate(session=grading_session(status=GradingSession.Status.OPEN))
    )
    client = auth_client("assessment-lifecycle-api@example.com")

    invalid_response = client.patch(
        f"/api/gradings/assessments/{generated.id}/",
        {"status": CandidateAssessment.Status.COMPLETED},
        format="json",
    )
    start_response = client.patch(
        f"/api/gradings/assessments/{generated.id}/",
        {"status": CandidateAssessment.Status.IN_PROGRESS, "notes": "Started"},
        format="json",
    )

    assert invalid_response.status_code == 400
    assert start_response.status_code == 200
    assert start_response.json()["status"] == CandidateAssessment.Status.IN_PROGRESS
    assert start_response.json()["notes"] == "Started"


def test_assessment_item_api_allows_only_result_fields_and_filters() -> None:
    generated = assessment(
        candidate=candidate(session=grading_session(status=GradingSession.Status.OPEN))
    )
    update_candidate_assessment(
        generated,
        status=CandidateAssessment.Status.IN_PROGRESS,
    )
    item = generated.items.first()
    assert item is not None
    original_name = item.item_name
    spoofed_assessor = user("spoofed-assessor@example.com")
    real_assessor = user("real-assessor@example.com")
    client = APIClient()
    client.force_authenticate(user=real_assessor)

    patch_response = client.patch(
        f"/api/gradings/assessment-items/{item.id}/",
        {
            "result": CandidateAssessmentItem.Result.NOT_MET,
            "assessor_notes": "Needs work",
            "item_name": "Client changed name",
            "assessor": spoofed_assessor.id,
            "assessed_at": "2030-01-01T00:00:00Z",
        },
        format="json",
    )
    item.refresh_from_db()
    list_response = client.get(
        f"/api/gradings/assessment-items/?assessment={generated.id}",
    )
    post_response = client.post("/api/gradings/assessment-items/", {}, format="json")
    delete_response = client.delete(f"/api/gradings/assessment-items/{item.id}/")

    assert patch_response.status_code == 200
    assert item.item_name == original_name
    assert item.result == CandidateAssessmentItem.Result.NOT_MET
    assert item.assessor == real_assessor
    assert item.assessed_at is not None
    assert item.assessor_notes == "Needs work"
    assert item.id in [payload["id"] for payload in results(list_response)]
    assert post_response.status_code == 405
    assert delete_response.status_code == 405


def test_assessment_item_api_lists_items_in_syllabus_order() -> None:
    built = candidate(
        student=student(
            date_of_birth=BORN_IN_BAND[AgeBand.AGE_18_AND_OVER],
            current_rank=rank("DAHN_BO"),
        ),
        testing_for_rank=rank("JKN"),
    )
    generated = assessment(candidate=built)

    response = auth_client("syllabus-order@example.com").get(
        "/api/gradings/assessment-items/",
        {"assessment": generated.id, "page_size": 200},
    )

    assert response.status_code == 200
    rows = results(response)
    assert [row["position"] for row in rows] == list(range(1, len(rows) + 1))
    assert "requirement_sequence" not in rows[0]
    # Core areas first and weapons last, as the chart runs; within a category
    # items keep the order they were introduced in, not alphabetical order.
    assert [row["category"] for row in rows[:6]] == [
        "ETIQUETTE",
        "FUNDAMENTALS",
        "HAND_TECHNIQUES",
        "KICKING",
        "FALLING",
        "BREAKING",
    ]
    assert [row["item_name"] for row in rows if row["category"] == "WEAPONS"] == [
        "Sword Techs",
        "Bohng Dol-li-ki",
    ]
    assert rows[-1]["category"] == "WEAPONS"
    techniques = [
        row["item_name"] for row in rows if row["category"] == "TECHNIQUE_SET"
    ]
    assert techniques[:3] == ["Sohn Ppae Ki", "Ki Bohn Soo", "Sohn Mohk Soo"]
    assert techniques[-2:] == ["Mohk Joh Leu Ki", "Bahng Too Ki"]


def locked_completed_candidate() -> tuple[GradingCandidate, CandidateAssessment]:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    complete_assessment(generated)
    transition_grading_session(session, GradingSession.Status.LOCKED)
    built.refresh_from_db()
    generated.refresh_from_db()
    return built, generated


def test_valid_draft_candidate_outcome_can_be_created() -> None:
    built, generated = locked_completed_candidate()

    outcome = create_candidate_outcome(built, user("outcome-creator@example.com"))

    assert outcome.candidate == built
    assert outcome.assessment == generated
    assert outcome.status == CandidateOutcome.Status.DRAFT
    assert outcome.proposed_outcome is None
    assert outcome.final_outcome is None


def test_candidate_outcome_database_constraints_are_enforced() -> None:
    built, generated = locked_completed_candidate()
    creator = user("outcome-db-creator@example.com")
    outcome = create_candidate_outcome(built, creator)

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [CandidateOutcome(candidate=built, assessment=generated)],
        )

    other_built, other_generated = locked_completed_candidate()
    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [CandidateOutcome(candidate=other_built, assessment=generated)],
        )
    assert other_generated.pk is not None

    # One consistent pair, so this exercises the status check constraint
    # rather than tripping the composite foreign key on a mismatched pair.
    status_built, status_generated = locked_completed_candidate()
    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [
                CandidateOutcome(
                    candidate=status_built,
                    assessment=status_generated,
                    status="INVALID",
                ),
            ],
        )

    proposer = user("outcome-db-proposer@example.com")
    now = timezone.now()
    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [
                CandidateOutcome(
                    candidate=locked_completed_candidate()[0],
                    assessment=locked_completed_candidate()[1],
                    status=CandidateOutcome.Status.PROPOSED,
                    proposed_outcome="INVALID",
                    proposed_by=proposer,
                    proposed_at=now,
                ),
            ],
        )

    decision_maker = master("outcome-db-master@example.com")
    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [
                CandidateOutcome(
                    candidate=locked_completed_candidate()[0],
                    assessment=locked_completed_candidate()[1],
                    status=CandidateOutcome.Status.FINALISED,
                    proposed_outcome=CandidateOutcome.Outcome.PASS,
                    proposed_by=proposer,
                    proposed_at=now,
                    final_outcome="INVALID",
                    decided_by=decision_maker,
                    decided_at=now,
                ),
            ],
        )

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [
                CandidateOutcome(
                    candidate=locked_completed_candidate()[0],
                    assessment=locked_completed_candidate()[1],
                    status=CandidateOutcome.Status.FINALISED,
                    proposed_outcome=CandidateOutcome.Outcome.CONDITIONAL,
                    proposed_by=proposer,
                    proposed_at=now,
                    final_outcome=CandidateOutcome.Outcome.CONDITIONAL,
                    decided_by=decision_maker,
                    decided_at=now,
                    conditional_requirements="",
                ),
            ],
        )

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [
                CandidateOutcome(
                    candidate=locked_completed_candidate()[0],
                    assessment=locked_completed_candidate()[1],
                    status=CandidateOutcome.Status.FINALISED,
                    proposed_outcome=CandidateOutcome.Outcome.PASS,
                    proposed_by=proposer,
                    proposed_at=now,
                    final_outcome=CandidateOutcome.Outcome.PASS,
                    decided_by=decision_maker,
                    decided_at=now,
                    conditional_requirements="stale text",
                ),
            ],
        )

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [
                CandidateOutcome(
                    candidate=locked_completed_candidate()[0],
                    assessment=locked_completed_candidate()[1],
                    status=CandidateOutcome.Status.PROPOSED,
                    proposed_outcome=CandidateOutcome.Outcome.PASS,
                    proposed_by=proposer,
                    proposed_at=None,
                ),
            ],
        )

    assert CandidateOutcome.objects.filter(pk=outcome.pk).exists()


def test_candidate_assessment_mismatch_rejected_by_model_validation() -> None:
    built, _generated = locked_completed_candidate()
    _other_built, other_generated = locked_completed_candidate()
    outcome = CandidateOutcome(candidate=built, assessment=other_generated)

    with pytest.raises(ValidationError) as exc_info:
        outcome.full_clean()

    assert "assessment" in exc_info.value.message_dict


def test_outcome_creation_rules_and_duplicate_protection() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    with pytest.raises(ValidationError):
        create_candidate_outcome(built, user("outcome-no-assessment@example.com"))

    generated = assessment(candidate=built)
    start_assessment(generated)
    with pytest.raises(ValidationError):
        create_candidate_outcome(built, user("outcome-incomplete@example.com"))

    complete_assessment(generated)
    with pytest.raises(ValidationError):
        create_candidate_outcome(built, user("outcome-open@example.com"))

    transition_grading_session(built.session, GradingSession.Status.LOCKED)
    outcome = create_candidate_outcome(built, user("outcome-valid@example.com"))
    assert outcome.pk is not None
    with pytest.raises(ValidationError):
        create_candidate_outcome(built, user("outcome-duplicate@example.com"))

    completed_built, _completed_assessment = locked_completed_candidate()
    GradingSession.objects.filter(pk=completed_built.session_id).update(
        status=GradingSession.Status.COMPLETED,
    )
    with pytest.raises(ValidationError):
        create_candidate_outcome(
            completed_built,
            user("outcome-completed-session@example.com"),
        )

    cancelled_built, _cancelled_assessment = locked_completed_candidate()
    GradingSession.objects.filter(pk=cancelled_built.session_id).update(
        status=GradingSession.Status.CANCELLED,
    )
    with pytest.raises(ValidationError):
        create_candidate_outcome(
            cancelled_built,
            user("outcome-cancelled-session@example.com"),
        )


def test_proposal_workflow_allows_revision_and_blocks_finalised_reproposal() -> None:
    built, _generated = locked_completed_candidate()
    outcome = create_candidate_outcome(built, user("proposal-creator@example.com"))
    proposer = user("proposal-actor@example.com")

    proposed = propose_candidate_outcome(
        outcome,
        CandidateOutcome.Outcome.PASS,
        "Initial proposal",
        proposer,
    )
    first_timestamp = proposed.proposed_at
    revised = propose_candidate_outcome(
        proposed,
        CandidateOutcome.Outcome.FAIL,
        "Revised proposal",
        user("proposal-reviser@example.com"),
    )

    assert revised.status == CandidateOutcome.Status.PROPOSED
    assert revised.proposed_outcome == CandidateOutcome.Outcome.FAIL
    assert revised.proposal_notes == "Revised proposal"
    assert revised.proposed_at is not None
    assert first_timestamp is not None and revised.proposed_at >= first_timestamp
    assert revised.final_outcome is None

    with pytest.raises(ValidationError):
        propose_candidate_outcome(
            revised,
            "INVALID",
            "",
            user("proposal-invalid@example.com"),
        )

    finalised = finalise_candidate_outcome(
        revised,
        CandidateOutcome.Outcome.PASS,
        "Override accepted.",
        "",
        master("proposal-master@example.com"),
    )
    with pytest.raises(ValidationError):
        propose_candidate_outcome(
            finalised,
            CandidateOutcome.Outcome.PASS,
            "Too late",
            user("proposal-too-late@example.com"),
        )


def test_finalisation_rules_permissions_and_conditional_policy() -> None:
    built, _generated = locked_completed_candidate()
    draft = create_candidate_outcome(built, user("finalise-draft-creator@example.com"))
    with pytest.raises(ValidationError):
        finalise_candidate_outcome(
            draft,
            CandidateOutcome.Outcome.PASS,
            "",
            "",
            master("finalise-draft-master@example.com"),
        )

    proposed = propose_candidate_outcome(
        draft,
        CandidateOutcome.Outcome.PASS,
        "",
        user("finalise-proposer@example.com"),
    )
    with pytest.raises(ValidationError):
        finalise_candidate_outcome(
            proposed,
            CandidateOutcome.Outcome.PASS,
            "",
            "",
            user("finalise-not-master@example.com"),
        )
    with pytest.raises(ValidationError):
        finalise_candidate_outcome(
            proposed,
            CandidateOutcome.Outcome.PASS,
            "",
            "",
            user(
                "finalise-legacy-boolean@example.com",
            ),
        )
    with pytest.raises(ValidationError):
        finalise_candidate_outcome(
            proposed,
            CandidateOutcome.Outcome.CONDITIONAL,
            "",
            "   ",
            master("finalise-blank-conditional@example.com"),
        )
    with pytest.raises(ValidationError):
        finalise_candidate_outcome(
            proposed,
            CandidateOutcome.Outcome.PASS,
            "",
            "stale condition",
            master("finalise-stale-pass@example.com"),
        )

    finalised = finalise_candidate_outcome(
        proposed,
        CandidateOutcome.Outcome.CONDITIONAL,
        "",
        "Attend one focused basics review.",
        master("finalise-conditional-master@example.com"),
    )

    assert finalised.status == CandidateOutcome.Status.FINALISED
    assert finalised.final_outcome == CandidateOutcome.Outcome.CONDITIONAL
    assert finalised.decided_by is not None
    assert finalised.decided_at is not None
    assert finalised.conditional_requirements == "Attend one focused basics review."

    with pytest.raises(ValidationError):
        finalise_candidate_outcome(
            finalised,
            CandidateOutcome.Outcome.PASS,
            "",
            "",
            master("finalise-repeat-master@example.com"),
        )


def test_superuser_can_finalise_through_django_permission_conventions() -> None:
    built, _generated = locked_completed_candidate()
    outcome = create_candidate_outcome(
        built,
        user("finalise-superuser-creator@example.com"),
    )
    proposed = propose_candidate_outcome(
        outcome,
        CandidateOutcome.Outcome.PASS,
        "",
        user("finalise-superuser-proposer@example.com"),
    )
    decision_maker = User.objects.create_superuser(
        email="finalise-superuser@example.com",
    )

    finalised = finalise_candidate_outcome(
        proposed,
        CandidateOutcome.Outcome.PASS,
        "",
        "",
        decision_maker,
    )

    assert finalised.decided_by == decision_maker
    assert finalised.status == CandidateOutcome.Status.FINALISED


def test_finalisation_only_allowed_while_session_locked() -> None:
    built, _generated = locked_completed_candidate()
    outcome = create_candidate_outcome(
        built,
        user("finalise-session-creator@example.com"),
    )
    proposed = propose_candidate_outcome(
        outcome,
        CandidateOutcome.Outcome.PASS,
        "",
        user("finalise-session-proposer@example.com"),
    )
    GradingSession.objects.filter(pk=built.session_id).update(
        status=GradingSession.Status.COMPLETED,
    )

    with pytest.raises(ValidationError):
        finalise_candidate_outcome(
            proposed,
            CandidateOutcome.Outcome.PASS,
            "",
            "",
            master("finalise-session-master@example.com"),
        )


def test_finalised_outcome_is_immutable_and_protects_deletion() -> None:
    built, generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    original_rank = built.student.current_rank

    outcome.decision_notes = "Changed after finalisation"
    with pytest.raises(ValidationError):
        outcome.save()
    with pytest.raises(ValidationError):
        outcome.delete()
    with pytest.raises(ValidationError):
        CandidateOutcome.objects.filter(pk=outcome.pk).update(
            decision_notes="Bulk-changed",
        )
    outcome.refresh_from_db()
    assert outcome.decision_notes != "Bulk-changed"
    with pytest.raises(ProtectedError):
        generated.delete()
    with pytest.raises(ValidationError):
        validate_candidate_can_be_deleted(built)
    built.status = GradingCandidate.Status.WITHDRAWN
    with pytest.raises(ValidationError):
        built.save()

    built.student.refresh_from_db()
    assert built.student.current_rank == original_rank


def test_direct_outcome_status_spoofing_rejected() -> None:
    built, _generated = locked_completed_candidate()
    outcome = create_candidate_outcome(built, user("status-spoof-creator@example.com"))
    outcome.status = CandidateOutcome.Status.FINALISED
    outcome.proposed_outcome = CandidateOutcome.Outcome.PASS
    outcome.proposed_by = user("status-spoof-proposer@example.com")
    outcome.proposed_at = timezone.now()
    outcome.final_outcome = CandidateOutcome.Outcome.PASS
    outcome.decided_by = master("status-spoof-master@example.com")
    outcome.decided_at = timezone.now()

    with pytest.raises(ValidationError) as exc_info:
        outcome.save()

    assert "workflow services" in str(exc_info.value)


def test_candidate_assessment_summary_uses_snapshot_categories_and_counts() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    optional_item = SyllabusItem.objects.create(
        code="SUMMARY_OPTIONAL",
        name="Summary Optional",
        category=SyllabusItem.Category.WEAPONS,
    )
    optional_requirement = SyllabusRequirement.objects.create(
        rank=built.testing_for_rank,
        item=optional_item,
        age_band=built.age_band,
        required=False,
        sequence=999,
    )
    generated = assessment(candidate=built)
    start_assessment(generated)
    required_items = list(generated.items.filter(required=True).order_by("pk"))
    required_items[0].result = CandidateAssessmentItem.Result.NOT_MET
    required_items[0].assessor = user(f"not-met-assessor-{generated.pk}@example.com")
    required_items[0].assessed_at = timezone.now()
    required_items[0].save()
    generated.items.filter(required=True).exclude(pk=required_items[0].pk).update(
        result=CandidateAssessmentItem.Result.MET,
        assessor=user(f"summary-assessor-{generated.pk}@example.com"),
        assessed_at=timezone.now(),
    )
    optional_snapshot = generated.items.get(source_requirement=optional_requirement)
    source_item = optional_snapshot.source_item
    assert source_item is not None
    original_category = optional_snapshot.category
    source_item.category = SyllabusItem.Category.OTHER
    source_item.save()

    summary = candidate_assessment_summary(generated)

    assert "final_outcome" not in summary
    assert summary["overall"]["total"] == generated.items.count()
    assert (
        summary["overall"]["required"]
        == generated.items.filter(
            required=True,
        ).count()
    )
    assert summary["overall"]["not_met"] == 1
    assert summary["overall"]["not_assessed"] == 1
    assert summary["overall"]["required_not_assessed"] == 0
    # Regression coverage for the missing overall["required_met"] bug: it
    # was tracked per-category but never rolled up to the overall summary,
    # which the Cohort Adjudication Board reads directly to show "X of Y
    # met" - silently NaN before this fix.
    assert (
        summary["overall"]["required_met"]
        == generated.items.filter(
            required=True,
            result=CandidateAssessmentItem.Result.MET,
        ).count()
    )
    assert summary["overall"]["all_required_assessed"] is True
    categories = summary["categories"]
    assert [category["category"] for category in categories] == sorted(
        [category["category"] for category in categories],
        key=lambda value: {
            choice: index
            for index, (choice, _label) in enumerate(SyllabusItem.Category.choices)
        }[value],
    )
    weapons_summary = next(
        category for category in categories if category["category"] == original_category
    )
    assert weapons_summary["total"] == 1
    assert weapons_summary["required"] == 0
    assert weapons_summary["not_assessed"] == 1


def test_session_completion_requires_finalised_outcomes_for_active_candidates() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    first = candidate(session=session)
    second = candidate(session=session)
    withdrawn = candidate(session=session, status=GradingCandidate.Status.WITHDRAWN)
    first_assessment = assessment(candidate=first)
    second_assessment = assessment(candidate=second)
    start_assessment(first_assessment)
    start_assessment(second_assessment)
    complete_assessment(first_assessment)
    complete_assessment(second_assessment)
    transition_grading_session(session, GradingSession.Status.LOCKED)
    first_outcome = create_candidate_outcome(
        first,
        user("session-outcome-first@example.com"),
    )

    with pytest.raises(ValidationError):
        transition_grading_session(session, GradingSession.Status.COMPLETED)

    proposed_first = propose_candidate_outcome(
        first_outcome,
        CandidateOutcome.Outcome.PASS,
        "",
        user("session-outcome-first-proposer@example.com"),
    )
    with pytest.raises(ValidationError):
        transition_grading_session(session, GradingSession.Status.COMPLETED)

    finalise_candidate_outcome(
        proposed_first,
        CandidateOutcome.Outcome.PASS,
        "",
        "",
        master("session-outcome-first-master@example.com"),
    )
    finalised_outcome(
        second,
        proposed=CandidateOutcome.Outcome.FAIL,
        final=CandidateOutcome.Outcome.CONDITIONAL,
        conditional_requirements="Retest forms before promotion is considered.",
    )
    completed = transition_grading_session(session, GradingSession.Status.COMPLETED)

    assert completed.status == GradingSession.Status.COMPLETED
    assert not hasattr(withdrawn, "outcome")


def test_candidate_outcome_api_workflow_and_filters() -> None:
    built, _generated = locked_completed_candidate()
    actor = user("outcome-api-actor@example.com")
    master_user = master("outcome-api-master@example.com")
    client = APIClient()
    client.force_authenticate(user=actor)

    unauthenticated = APIClient().post(
        f"/api/gradings/candidates/{built.id}/create-outcome/",
    )
    create_response = client.post(
        f"/api/gradings/candidates/{built.id}/create-outcome/",
    )
    arbitrary_post = client.post("/api/gradings/outcomes/", {}, format="json")

    assert unauthenticated.status_code == 403
    assert create_response.status_code == 201
    assert arbitrary_post.status_code == 405
    payload = create_response.json()
    outcome_id = payload["id"]
    assert payload["candidate"] == built.id

    direct_patch = client.patch(
        f"/api/gradings/outcomes/{outcome_id}/",
        {"status": CandidateOutcome.Status.FINALISED},
        format="json",
    )
    propose_response = client.patch(
        f"/api/gradings/outcomes/{outcome_id}/propose/",
        {
            "proposed_outcome": CandidateOutcome.Outcome.FAIL,
            "proposal_notes": "Evidence indicates a fail.",
            "proposed_by": master_user.id,
            "proposed_at": "2030-01-01T00:00:00Z",
        },
        format="json",
    )
    forbidden_finalise = client.patch(
        f"/api/gradings/outcomes/{outcome_id}/finalise/",
        {"final_outcome": CandidateOutcome.Outcome.PASS},
        format="json",
    )
    client.force_authenticate(user=master_user)
    finalise_response = client.patch(
        f"/api/gradings/outcomes/{outcome_id}/finalise/",
        {
            "final_outcome": CandidateOutcome.Outcome.PASS,
            "decision_notes": "Master override.",
            "decided_by": actor.id,
            "decided_at": "2030-01-01T00:00:00Z",
            "conditional_requirements": "",
        },
        format="json",
    )
    list_response = client.get(
        f"/api/gradings/outcomes/?session={built.session_id}",
    )
    delete_response = client.delete(f"/api/gradings/outcomes/{outcome_id}/")
    finalised_patch = client.patch(
        f"/api/gradings/outcomes/{outcome_id}/",
        {"decision_notes": "Changed"},
        format="json",
    )

    # No detail route: an outcome is written only through propose/finalise.
    assert direct_patch.status_code == 404
    assert propose_response.status_code == 200
    assert propose_response.json()["proposed_by_name"] == actor.get_full_name()
    assert forbidden_finalise.status_code == 403
    assert finalise_response.status_code == 200
    assert finalise_response.json()["decided_by_name"] == master_user.get_full_name()
    assert finalise_response.json()["final_outcome"] == CandidateOutcome.Outcome.PASS
    assert [item["id"] for item in results(list_response)] == [outcome_id]
    assert delete_response.status_code == 404
    assert finalised_patch.status_code == 404


def test_candidate_outcome_admin_is_read_only_and_has_no_bulk_finalisation() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    model_admin = CandidateOutcomeAdmin(CandidateOutcome, admin.site)
    request = admin_request("outcome-admin@example.com")
    outcome.decision_notes = "Unsafe admin edit"
    form = cast("ModelForm[Any]", SimpleNamespace(changed_data=["decision_notes"]))

    assert model_admin.has_add_permission(request) is False
    assert model_admin.has_delete_permission(request, outcome) is False
    assert model_admin.actions == ()
    with pytest.raises(ValidationError):
        model_admin.save_model(request, outcome, form, True)


def test_valid_promotion_updates_student_rank_and_records_history() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    actor = promoter("promotion-valid@example.com")
    student_before = Student.objects.values().get(pk=built.student_id)

    promotion = promote_candidate(outcome, actor, notes="Promoted at grading.")

    built.student.refresh_from_db()
    student_after = Student.objects.values().get(pk=built.student_id)

    assert promotion.student == built.student
    assert promotion.outcome == outcome
    assert promotion.grading_candidate == built
    assert promotion.from_rank.code == "WHITE"
    assert promotion.to_rank.code == "YELLOW_STRIPE"
    assert promotion.promoted_by == actor
    assert promotion.promoted_at is not None
    assert promotion.effective_date == built.session.grading_date
    assert promotion.notes == "Promoted at grading."
    assert built.student.current_rank == promotion.to_rank
    assert student_after["current_rank_id"] != student_before["current_rank_id"]
    assert student_after["wksa_id"] == student_before["wksa_id"]
    assert student_after["first_name"] == student_before["first_name"]
    assert student_after["last_name"] == student_before["last_name"]
    assert student_after["date_of_birth"] == student_before["date_of_birth"]
    assert student_after["status"] == student_before["status"]
    assert student_after["created_at"] == student_before["created_at"]
    assert student_after["updated_at"] == student_before["updated_at"]
    assert str(promotion) == (
        f"{built.student} promoted from {promotion.from_rank} to {promotion.to_rank}"
    )


def test_candidate_records_the_rank_held_at_registration() -> None:
    built = candidate(
        student=student(current_rank=rank("YELLOW_STRIPE")),
        testing_for_rank=rank("YELLOW"),
    )

    assert built.from_rank.code == "YELLOW_STRIPE"


def test_candidate_from_rank_does_not_move_when_the_student_is_promoted() -> None:
    built, _generated = locked_completed_candidate()
    promote_candidate(finalised_outcome(built), promoter("from-rank@example.com"))

    built.refresh_from_db()
    built.student.refresh_from_db()
    response = auth_client("from-rank-api@example.com").get(
        f"/api/gradings/candidates/{built.pk}/",
    )

    assert built.student.current_rank.code == "YELLOW_STRIPE"
    assert built.from_rank.code == "WHITE"
    assert response.status_code == 200
    assert response.data["from_rank_name"] == "White"


def test_from_rank_backfill_reconstructs_the_rank_at_registration() -> None:
    backfill = importlib.import_module(
        "gradings.migrations.0009_candidate_from_rank_and_delete_any_permission",
    ).backfill_from_rank
    promoted, _generated = locked_completed_candidate()
    promote_candidate(finalised_outcome(promoted), promoter("backfill@example.com"))
    # A later registration for the same, now promoted, student that was never
    # itself promoted: its rank is the one the earlier promotion reached.
    later = candidate(
        session=grading_session(grading_date=date(2028, 3, 20)),
        student=promoted.student,
        testing_for_rank=rank("YELLOW"),
    )
    never_promoted = candidate()
    GradingCandidate.objects.update(from_rank=rank("BROWN"))

    backfill(apps, None)

    assert GradingCandidate.objects.get(pk=promoted.pk).from_rank.code == "WHITE"
    assert GradingCandidate.objects.get(pk=later.pk).from_rank.code == ("YELLOW_STRIPE")
    assert GradingCandidate.objects.get(pk=never_promoted.pk).from_rank.code == (
        "WHITE"
    )


def test_promotion_database_constraints_and_model_validation() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    actor = promoter("promotion-db@example.com")
    promotion = promote_candidate(outcome, actor)

    with pytest.raises(ValidationError):
        promote_candidate(outcome, actor)

    with pytest.raises(IntegrityError), transaction.atomic():
        Promotion.objects.bulk_create(
            [
                Promotion(
                    student=promotion.student,
                    outcome=promotion.outcome,
                    grading_candidate=promotion.grading_candidate,
                    from_rank=promotion.from_rank,
                    to_rank=promotion.to_rank,
                    promoted_by=actor,
                    effective_date=promotion.effective_date,
                ),
            ],
        )

    other_built, _other_generated = locked_completed_candidate()
    other_outcome = finalised_outcome(other_built)
    with pytest.raises(IntegrityError), transaction.atomic():
        Promotion.objects.bulk_create(
            [
                Promotion(
                    student=other_built.student,
                    outcome=other_outcome,
                    grading_candidate=other_built,
                    from_rank=rank("WHITE"),
                    to_rank=rank("WHITE"),
                    promoted_by=actor,
                    effective_date=other_built.session.grading_date,
                ),
            ],
        )

    mismatch = Promotion(
        student=other_built.student,
        outcome=outcome,
        grading_candidate=other_built,
        from_rank=rank("WHITE"),
        to_rank=rank("YELLOW_STRIPE"),
        promoted_by=actor,
        effective_date=other_built.session.grading_date,
    )
    with pytest.raises(ValidationError) as exc_info:
        mismatch.full_clean()
    assert "outcome" in exc_info.value.message_dict

    # Attaching an outcome to another candidate's assessment used to be
    # possible through QuerySet.update(), which bypasses model validation.
    # The composite foreign key now refuses the write itself, so the
    # mismatched state this once set up can no longer exist (KG-010). Not
    # finalised: that would hit the separate immutable-outcome guard first
    # and never reach the constraint this is testing.
    assessment_mismatch_built, _assessment_mismatch_generated = (
        locked_completed_candidate()
    )
    assessment_mismatch_outcome = create_candidate_outcome(
        assessment_mismatch_built,
        user("assessment-mismatch-creator@example.com"),
    )
    _foreign_built, foreign_generated = locked_completed_candidate()
    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.filter(pk=assessment_mismatch_outcome.pk).update(
            assessment=foreign_generated,
        )

    wrong_student = student(wksa_id="PROMO-WRONG-STUDENT")
    mismatch_student = Promotion(
        student=wrong_student,
        outcome=other_outcome,
        grading_candidate=other_built,
        from_rank=rank("WHITE"),
        to_rank=rank("YELLOW_STRIPE"),
        promoted_by=actor,
        effective_date=other_built.session.grading_date,
    )
    with pytest.raises(ValidationError) as student_exc:
        mismatch_student.full_clean()
    assert "student" in student_exc.value.message_dict

    missing_effective_date = Promotion(
        student=other_built.student,
        outcome=other_outcome,
        grading_candidate=other_built,
        from_rank=rank("WHITE"),
        to_rank=rank("YELLOW_STRIPE"),
        promoted_by=actor,
    )
    with pytest.raises(ValidationError) as date_exc:
        missing_effective_date.full_clean()
    assert "effective_date" in date_exc.value.message_dict


def test_promotion_permission_is_separate_from_final_decision_authority() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)

    with pytest.raises(ValidationError):
        promote_candidate(outcome, user("promotion-ordinary@example.com"))
    with pytest.raises(ValidationError):
        promote_candidate(
            outcome,
            user(
                "promotion-legacy-boolean@example.com",
            ),
        )
    with pytest.raises(ValidationError):
        promote_candidate(outcome, master("promotion-final-only@example.com"))

    actor = promoter("promotion-authorised@example.com")
    promotion = promote_candidate(outcome, actor)
    assert promotion.promoted_by == actor

    second_built, _second_generated = locked_completed_candidate()
    second_outcome = finalised_outcome(second_built)
    superuser = User.objects.create_superuser(email="promotion-superuser@example.com")
    second_promotion = promote_candidate(second_outcome, superuser)
    assert second_promotion.promoted_by == superuser


@pytest.mark.parametrize(
    ("status", "final_outcome"),
    [
        (CandidateOutcome.Status.DRAFT, None),
        (CandidateOutcome.Status.PROPOSED, None),
        (CandidateOutcome.Status.FINALISED, CandidateOutcome.Outcome.FAIL),
        (CandidateOutcome.Status.FINALISED, CandidateOutcome.Outcome.CONDITIONAL),
    ],
)
def test_promotion_rejects_ineligible_outcome_states(
    status: str,
    final_outcome: str | None,
) -> None:
    built, _generated = locked_completed_candidate()
    outcome = create_candidate_outcome(built, user(f"promotion-state-{status}@x.com"))
    if status == CandidateOutcome.Status.PROPOSED:
        outcome = propose_candidate_outcome(
            outcome,
            CandidateOutcome.Outcome.PASS,
            "",
            user("promotion-state-proposer@example.com"),
        )
    elif status == CandidateOutcome.Status.FINALISED:
        proposed = propose_candidate_outcome(
            outcome,
            CandidateOutcome.Outcome.PASS,
            "",
            user(f"promotion-state-proposer-{final_outcome}@example.com"),
        )
        outcome = finalise_candidate_outcome(
            proposed,
            cast(str, final_outcome),
            "",
            (
                "Additional review required."
                if final_outcome == CandidateOutcome.Outcome.CONDITIONAL
                else ""
            ),
            master(f"promotion-state-master-{final_outcome}@example.com"),
        )

    with pytest.raises(ValidationError):
        promote_candidate(outcome, promoter(f"promotion-state-{status}-actor@x.com"))


def test_promotion_rejects_invalid_candidate_assessment_and_session_states() -> None:
    open_candidate = candidate(
        session=grading_session(status=GradingSession.Status.OPEN)
    )
    open_assessment = assessment(candidate=open_candidate)
    start_assessment(open_assessment)
    complete_assessment(open_assessment)
    transition_grading_session(open_candidate.session, GradingSession.Status.LOCKED)
    outcome = finalised_outcome(open_candidate)
    GradingSession.objects.filter(pk=open_candidate.session_id).update(
        status=GradingSession.Status.CANCELLED,
    )
    with pytest.raises(ValidationError):
        promote_candidate(outcome, promoter("promotion-cancelled@example.com"))

    built, generated = locked_completed_candidate()
    second_outcome = finalised_outcome(built)
    CandidateAssessment.objects.filter(pk=generated.pk).update(
        status=CandidateAssessment.Status.IN_PROGRESS,
        completed_at=None,
    )
    with pytest.raises(ValidationError):
        promote_candidate(second_outcome, promoter("promotion-assessment@example.com"))

    # The service still validates this, but the state is now unreachable:
    # the database refuses to create it. See KG-010. Not finalised, so the
    # write reaches the constraint rather than the immutable-outcome guard.
    mismatch_built, _mismatch_generated = locked_completed_candidate()
    mismatch_outcome = create_candidate_outcome(
        mismatch_built,
        user("promotion-mismatch-creator@example.com"),
    )
    _foreign_built, foreign_generated = locked_completed_candidate()
    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.filter(pk=mismatch_outcome.pk).update(
            assessment=foreign_generated,
        )

    withdrawn, _withdrawn_assessment = locked_completed_candidate()
    withdrawn_outcome = finalised_outcome(withdrawn)
    GradingCandidate.objects.filter(pk=withdrawn.pk).update(
        status=GradingCandidate.Status.WITHDRAWN,
    )
    with pytest.raises(ValidationError):
        promote_candidate(
            withdrawn_outcome, promoter("promotion-withdrawn@example.com")
        )


def test_promotion_rejects_rank_progression_drift() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    Student.objects.filter(pk=built.student_id).update(current_rank=rank("YELLOW"))

    with pytest.raises(ValidationError):
        promote_candidate(outcome, promoter("promotion-rank-changed@example.com"))

    skipped_built, _skipped_generated = locked_completed_candidate()
    skipped_outcome = finalised_outcome(skipped_built)
    GradingCandidate.objects.filter(pk=skipped_built.pk).update(
        testing_for_rank=rank("YELLOW"),
    )
    with pytest.raises(ValidationError):
        promote_candidate(skipped_outcome, promoter("promotion-skipped@example.com"))

    inactive_built, _inactive_generated = locked_completed_candidate()
    inactive_outcome = finalised_outcome(inactive_built)
    Rank.objects.filter(code="YELLOW_STRIPE").update(active=False)
    with pytest.raises(ValidationError):
        promote_candidate(inactive_outcome, promoter("promotion-inactive@example.com"))


def test_promotion_is_always_dated_the_grading_it_came_from() -> None:
    # There is no effective_date parameter: a promotion belongs to its
    # grading, and the caller has no say in the date.
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)

    promotion = promote_candidate(outcome, promoter("promotion-date@example.com"))

    assert promotion.effective_date == built.session.grading_date


def test_promotion_records_are_immutable_and_protected() -> None:
    built, _generated = locked_completed_candidate()
    promotion = promote_candidate(
        finalised_outcome(built),
        promoter("promotion-immutable@example.com"),
    )

    promotion.notes = "Changed"
    with pytest.raises(ValidationError):
        promotion.save()
    with pytest.raises(ValidationError):
        promotion.delete()
    with pytest.raises(ValidationError):
        Promotion.objects.filter(pk=promotion.pk).delete()
    with pytest.raises(ValidationError):
        Promotion.objects.filter(pk=promotion.pk).update(notes="Bulk-changed")
    promotion.refresh_from_db()
    assert promotion.notes != "Bulk-changed"

    built.student.current_rank = rank("YELLOW")
    with pytest.raises(ValidationError):
        built.student.save()


def test_promotion_api_workflow_filters_and_rank_history() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    actor = promoter("promotion-api@example.com")
    client = APIClient()

    unauthenticated = client.post(f"/api/gradings/outcomes/{outcome.id}/promote/")
    client.force_authenticate(user=user("promotion-api-ordinary@example.com"))
    forbidden = client.post(f"/api/gradings/outcomes/{outcome.id}/promote/")
    client.force_authenticate(user=actor)
    spoofed = client.post(
        f"/api/gradings/outcomes/{outcome.id}/promote/",
        {
            "effective_date": "2030-01-01",
            "promoted_by": str(user("promotion-spoof@example.com").id),
        },
        format="json",
    )
    promote_response = client.post(
        f"/api/gradings/outcomes/{outcome.id}/promote/",
        {"notes": "API promotion."},
        format="json",
    )
    duplicate = client.post(f"/api/gradings/outcomes/{outcome.id}/promote/")
    arbitrary_post = client.post("/api/gradings/promotions/", {}, format="json")

    promotion_id = promote_response.json()["id"]
    list_response = client.get(
        f"/api/gradings/promotions/?session={built.session_id}",
    )
    rank_history_response = client.get(
        f"/api/students/{built.student_id}/rank-history/",
    )
    patch_response = client.patch(
        f"/api/gradings/promotions/{promotion_id}/",
        {"notes": "Changed"},
        format="json",
    )
    delete_response = client.delete(f"/api/gradings/promotions/{promotion_id}/")

    assert unauthenticated.status_code == 403
    assert forbidden.status_code == 403
    assert spoofed.status_code == 400
    assert promote_response.status_code == 201
    assert promote_response.json()["effective_date"] == str(built.session.grading_date)
    stored_promotion = Promotion.objects.get(pk=promotion_id)
    assert stored_promotion.promoted_by == actor
    assert stored_promotion.student == built.student
    built.student.refresh_from_db()
    assert built.student.current_rank.code == "YELLOW_STRIPE"
    assert duplicate.status_code == 400
    assert arbitrary_post.status_code == 405
    assert [item["id"] for item in results(list_response)] == [promotion_id]
    assert rank_history_response.status_code == 200
    assert [item["id"] for item in rank_history_response.json()["promotions"]] == [
        promotion_id,
    ]
    # No detail route: a promotion is immutable and undeletable.
    assert patch_response.status_code == 404
    assert delete_response.status_code == 404


def test_bulk_promote_promotes_every_eligible_outcome_in_one_request() -> None:
    first_candidate, _first_assessment = locked_completed_candidate()
    second_candidate, _second_assessment = locked_completed_candidate()
    first_outcome = finalised_outcome(first_candidate)
    second_outcome = finalised_outcome(second_candidate)
    actor = promoter("bulk-promote@example.com")
    client = APIClient()
    client.force_authenticate(user=actor)

    response = client.post(
        "/api/gradings/outcomes/bulk-promote/",
        {"outcomes": [first_outcome.id, second_outcome.id]},
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["errors"] == {}
    assert {item["grading_candidate"] for item in payload["promoted"]} == {
        first_candidate.id,
        second_candidate.id,
    }
    first_candidate.student.refresh_from_db()
    second_candidate.student.refresh_from_db()
    assert first_candidate.student.current_rank.code == "YELLOW_STRIPE"
    assert second_candidate.student.current_rank.code == "YELLOW_STRIPE"
    assert (
        Promotion.objects.filter(
            outcome_id__in=[first_outcome.id, second_outcome.id],
        ).count()
        == 2
    )


def test_bulk_promote_is_independent_per_row() -> None:
    eligible_candidate, _eligible_assessment = locked_completed_candidate()
    ineligible_candidate, _ineligible_assessment = locked_completed_candidate()
    eligible_outcome = finalised_outcome(eligible_candidate)
    # A finalised FAIL is not promotable - this row must fail independently
    # of the eligible one.
    ineligible_outcome = finalised_outcome(
        ineligible_candidate,
        proposed=CandidateOutcome.Outcome.FAIL,
        final=CandidateOutcome.Outcome.FAIL,
    )
    actor = promoter("bulk-promote-partial@example.com")
    client = APIClient()
    client.force_authenticate(user=actor)

    response = client.post(
        "/api/gradings/outcomes/bulk-promote/",
        {"outcomes": [eligible_outcome.id, ineligible_outcome.id]},
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["grading_candidate"] for item in payload["promoted"]] == [
        eligible_outcome.candidate_id,
    ]
    assert list(payload["errors"].keys()) == ["1"]
    assert Promotion.objects.filter(outcome=eligible_outcome).exists()
    assert not Promotion.objects.filter(outcome=ineligible_outcome).exists()


def test_bulk_promote_requires_promotion_authority() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    client = APIClient()

    unauthenticated = client.post(
        "/api/gradings/outcomes/bulk-promote/",
        {"outcomes": [outcome.id]},
        format="json",
    )
    client.force_authenticate(user=user("bulk-promote-ordinary@example.com"))
    forbidden = client.post(
        "/api/gradings/outcomes/bulk-promote/",
        {"outcomes": [outcome.id]},
        format="json",
    )

    assert unauthenticated.status_code == 403
    assert forbidden.status_code == 403
    assert not Promotion.objects.filter(outcome=outcome).exists()


def test_end_to_end_http_grading_workflow_uses_only_response_data() -> None:
    """One grading, start to finish, entirely over HTTP.

    Every identifier a later step needs is taken from an earlier response,
    never from the ORM objects backing it - that contract is what a real
    frontend depends on, and nothing else in the suite exercises the full
    sequence in order. Two personas, exactly as the workflow requires: an
    instructor for everything up to propose, a Master for finalise and
    promote.
    """
    password = "StrongPass123!"
    instructor_user = User.objects.create_user(
        email="e2e-instructor@example.com",
        password=password,
        role=User.Role.INSTRUCTOR,
    )
    master_user = User.objects.create_user(
        email="e2e-master@example.com",
        password=password,
        role=User.Role.INSTRUCTOR,
    )
    grant_permission(master_user, FINAL_GRADING_DECISION_PERMISSION)
    grant_permission(master_user, PROMOTE_STUDENT_PERMISSION)

    instructor = APIClient()
    login_response = instructor.post(
        "/api/auth/login/",
        {"email": instructor_user.email, "password": password},
        format="json",
    )
    assert login_response.status_code == 200
    assert login_response.json()["email"] == instructor_user.email

    ranks_by_code = {row["code"]: row for row in results(instructor.get("/api/ranks/"))}
    white_rank_id = ranks_by_code["WHITE"]["id"]
    next_rank_id = ranks_by_code["YELLOW_STRIPE"]["id"]

    student_response = instructor.post(
        "/api/students/",
        {
            "wksa_id": "WKSAE2E01",
            "first_name": "Riley",
            "last_name": "Endo",
            "date_of_birth": "2015-04-01",
            "current_rank": white_rank_id,
        },
        format="json",
    )
    assert student_response.status_code == 201
    student_id = student_response.json()["id"]

    session_response = instructor.post(
        "/api/gradings/sessions/",
        {
            "title": "End-to-end HTTP Grading",
            "grading_date": "2027-06-01",
            "location": "Colchester Dojang",
        },
        format="json",
    )
    assert session_response.status_code == 201
    session_body = session_response.json()
    session_id = session_body["id"]
    assert session_body["status"] == GradingSession.Status.DRAFT

    candidate_response = instructor.post(
        "/api/gradings/candidates/bulk-register/",
        {
            "session": session_id,
            "candidates": [{"student": student_id, "testing_for_rank": next_rank_id}],
        },
        format="json",
    )
    assert candidate_response.status_code == 200
    candidate_body = candidate_response.json()["created"][0]["candidate"]
    candidate_id = candidate_body["id"]
    assert candidate_body["age_band_display"]

    open_response = instructor.patch(
        f"/api/gradings/sessions/{session_id}/",
        {"status": GradingSession.Status.OPEN},
        format="json",
    )
    assert open_response.status_code == 200
    assert open_response.json()["status"] == GradingSession.Status.OPEN

    generate_response = instructor.post(
        f"/api/gradings/candidates/{candidate_id}/generate-assessment/",
    )
    assert generate_response.status_code == 201
    assessment_body = generate_response.json()
    assessment_id = assessment_body["id"]
    assert assessment_body["status"] == CandidateAssessment.Status.NOT_STARTED
    assert CandidateAssessmentItem.objects.filter(
        assessment_id=assessment_id,
        required=True,
    ).exists()

    start_response = instructor.patch(
        f"/api/gradings/assessments/{assessment_id}/",
        {"status": CandidateAssessment.Status.IN_PROGRESS},
        format="json",
    )
    assert start_response.status_code == 200
    assert start_response.json()["status"] == CandidateAssessment.Status.IN_PROGRESS

    required_items = results(
        instructor.get(
            f"/api/gradings/assessment-items/?assessment={assessment_id}&required=true",
        ),
    )
    assert required_items

    for item in required_items:
        item_response = instructor.patch(
            f"/api/gradings/assessment-items/{item['id']}/",
            {
                "result": CandidateAssessmentItem.Result.MET,
                "assessor_notes": "Clean technique, recorded end to end.",
            },
            format="json",
        )
        assert item_response.status_code == 200
        item_body = item_response.json()
        assert item_body["result"] == CandidateAssessmentItem.Result.MET
        assert item_body["assessor_email"] == instructor_user.email

    # Every assessment is completed while the session is open; locking then
    # ends grading and opens the decision stage.
    complete_response = instructor.patch(
        f"/api/gradings/assessments/{assessment_id}/",
        {"status": CandidateAssessment.Status.COMPLETED},
        format="json",
    )
    assert complete_response.status_code == 200
    assert complete_response.json()["status"] == CandidateAssessment.Status.COMPLETED

    lock_response = instructor.patch(
        f"/api/gradings/sessions/{session_id}/",
        {"status": GradingSession.Status.LOCKED},
        format="json",
    )
    assert lock_response.status_code == 200
    assert lock_response.json()["status"] == GradingSession.Status.LOCKED

    outcome_response = instructor.post(
        f"/api/gradings/candidates/{candidate_id}/create-outcome/",
    )
    assert outcome_response.status_code == 201
    outcome_body = outcome_response.json()
    outcome_id = outcome_body["id"]
    assert outcome_body["status"] == CandidateOutcome.Status.DRAFT

    propose_response = instructor.patch(
        f"/api/gradings/outcomes/{outcome_id}/propose/",
        {
            "proposed_outcome": CandidateOutcome.Outcome.PASS,
            "proposal_notes": "Recommended for promotion.",
        },
        format="json",
    )
    assert propose_response.status_code == 200
    propose_body = propose_response.json()
    assert propose_body["status"] == CandidateOutcome.Status.PROPOSED
    assert propose_body["proposed_outcome"] == CandidateOutcome.Outcome.PASS

    master_client = APIClient()
    master_login = master_client.post(
        "/api/auth/login/",
        {"email": master_user.email, "password": password},
        format="json",
    )
    assert master_login.status_code == 200

    finalise_response = master_client.patch(
        f"/api/gradings/outcomes/{outcome_id}/finalise/",
        {
            "final_outcome": CandidateOutcome.Outcome.PASS,
            "decision_notes": "Confirmed end to end.",
        },
        format="json",
    )
    assert finalise_response.status_code == 200
    finalise_body = finalise_response.json()
    assert finalise_body["status"] == CandidateOutcome.Status.FINALISED
    assert finalise_body["final_outcome"] == CandidateOutcome.Outcome.PASS

    promote_response = master_client.post(
        f"/api/gradings/outcomes/{outcome_id}/promote/",
        {"notes": "Promoted end to end."},
        format="json",
    )
    assert promote_response.status_code == 201
    promote_body = promote_response.json()
    assert promote_body["grading_candidate"] == candidate_id
    assert promote_body["to_rank_name"] == "Yellow Stripe"

    rank_history_response = master_client.get(
        f"/api/students/{student_id}/rank-history/",
    )
    assert rank_history_response.status_code == 200
    rank_history_body = rank_history_response.json()
    assert [promotion["id"] for promotion in rank_history_body["promotions"]] == [
        promote_body["id"]
    ]


def test_student_rank_timeline_ordering_is_deterministic() -> None:
    first_built, _first_generated = locked_completed_candidate()
    timeline_student = first_built.student
    first = promote_candidate(
        finalised_outcome(first_built),
        promoter("promotion-timeline-first@example.com"),
    )
    timeline_student.refresh_from_db()
    second_session = grading_session(status=GradingSession.Status.OPEN)
    second_built = candidate(
        session=second_session,
        student=timeline_student,
        testing_for_rank=rank("YELLOW"),
    )
    second_generated = assessment(candidate=second_built)
    start_assessment(second_generated)
    complete_assessment(second_generated)
    transition_grading_session(second_session, GradingSession.Status.LOCKED)
    second = promote_candidate(
        finalised_outcome(second_built),
        promoter("promotion-timeline-second@example.com"),
    )

    timeline = student_rank_timeline(timeline_student)

    assert [promotion.pk for promotion in timeline["promotions"]] == [
        second.pk,
        first.pk,
    ]


def test_promotion_admin_is_read_only_and_has_no_bulk_actions() -> None:
    built, _generated = locked_completed_candidate()
    promotion = promote_candidate(
        finalised_outcome(built),
        promoter("promotion-admin@example.com"),
    )
    model_admin = PromotionAdmin(Promotion, admin.site)
    request = admin_request("promotion-admin-request@example.com")
    promotion.notes = "Unsafe admin edit"
    form = cast(
        "ModelForm[Any]", SimpleNamespace(changed_data=["notes"], cleaned_data={})
    )

    assert model_admin.has_add_permission(request) is False
    assert model_admin.has_delete_permission(request, promotion) is False
    assert model_admin.actions == ()
    with pytest.raises(ValidationError):
        model_admin.save_model(request, promotion, form, True)


def test_assessment_database_constraints_are_enforced() -> None:
    generated = assessment()

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateAssessment.objects.bulk_create(
            [
                CandidateAssessment(
                    candidate=candidate(),
                    generated_by=user("invalid-assessment-status@example.com"),
                    status="INVALID",
                ),
            ],
        )

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateAssessmentItem.objects.bulk_create(
            [
                CandidateAssessmentItem(
                    assessment=generated,
                    source_age_band="INVALID",
                    item_code="BAD_AGE",
                    item_name="Bad Age",
                    category=SyllabusItem.Category.OTHER,
                    requirement_sequence=1,
                    position=1000,
                ),
            ],
        )

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateAssessmentItem.objects.bulk_create(
            [
                CandidateAssessmentItem(
                    assessment=generated,
                    source_age_band=AgeBand.AGE_9_TO_12,
                    item_code="BAD_RANGE",
                    item_name="Bad Range",
                    category=SyllabusItem.Category.OTHER,
                    requirement_sequence=1,
                    position=1000,
                    start_number=5,
                    end_number=1,
                ),
            ],
        )

    # An item's place is its own: never zero, never shared within one
    # assessment.
    first = generated.items.get(position=1)
    for position in (0, 2):
        with pytest.raises(IntegrityError), transaction.atomic():
            CandidateAssessmentItem.objects.filter(pk=first.pk).update(
                position=position,
            )
    first.position = 0
    with pytest.raises(ValidationError) as exc_info:
        first.full_clean()
    assert exc_info.value.message_dict["position"] == ["Position must be positive."]


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_grading_migrations_apply_from_zero_and_constraints_exist() -> None:
    assert connection.vendor == "postgresql"
    executor = MigrationExecutor(connection)
    final_targets = executor.loader.graph.leaf_nodes()

    try:
        executor.migrate([("gradings", None)])
        executor = MigrationExecutor(connection)
        executor.migrate([("gradings", "0004_promotion")])
        state_apps = executor.loader.project_state(
            [("gradings", "0004_promotion")],
        ).apps
        HistoricalSession = state_apps.get_model("gradings", "GradingSession")
        HistoricalCandidate = state_apps.get_model("gradings", "GradingCandidate")
        HistoricalAssessment = state_apps.get_model("gradings", "CandidateAssessment")
        HistoricalItem = state_apps.get_model("gradings", "CandidateAssessmentItem")
        HistoricalOutcome = state_apps.get_model("gradings", "CandidateOutcome")
        HistoricalPromotion = state_apps.get_model("gradings", "Promotion")

        session_constraints = {
            constraint.name for constraint in HistoricalSession._meta.constraints
        }
        candidate_constraints = {
            constraint.name for constraint in HistoricalCandidate._meta.constraints
        }
        assessment_constraints = {
            constraint.name for constraint in HistoricalAssessment._meta.constraints
        }
        item_constraints = {
            constraint.name for constraint in HistoricalItem._meta.constraints
        }
        outcome_constraints = {
            constraint.name for constraint in HistoricalOutcome._meta.constraints
        }
        promotion_constraints = {
            constraint.name for constraint in HistoricalPromotion._meta.constraints
        }

        assert "grading_session_title_not_blank" in session_constraints
        assert "grading_session_status_valid" in session_constraints
        assert {index.name for index in HistoricalSession._meta.indexes} == {
            "grad_session_status_date_idx",
            "grad_session_date_idx",
        }
        assert "unique_grading_candidate_session_student" in candidate_constraints
        assert "grading_candidate_age_band_valid" in candidate_constraints
        assert "grading_candidate_status_valid" in candidate_constraints
        assert "candidate_assessment_status_valid" in assessment_constraints
        assert "candidate_assessment_timestamps_valid" in assessment_constraints
        assert "candidate_item_age_band_valid" in item_constraints
        assert "candidate_item_category_valid" in item_constraints
        assert "candidate_item_result_valid" in item_constraints
        assert "candidate_item_sequence_positive" in item_constraints
        assert "candidate_item_range_complete" in item_constraints
        assert "unique_assessment_source_requirement" in item_constraints
        assert "unique_assessment_item_snapshot" in item_constraints
        assert "candidate_outcome_status_valid" in outcome_constraints
        assert "candidate_outcome_proposed_valid" in outcome_constraints
        assert "candidate_outcome_final_valid" in outcome_constraints
        assert "candidate_outcome_status_fields_valid" in outcome_constraints
        assert "candidate_outcome_conditions_valid" in outcome_constraints
        assert {index.name for index in HistoricalOutcome._meta.indexes} == {
            "cand_outcome_status_idx",
            "cand_outcome_proposed_idx",
            "cand_outcome_final_idx",
            "cand_outcome_decided_idx",
        }
        assert "promotion_from_to_rank_distinct" in promotion_constraints
        assert {index.name for index in HistoricalPromotion._meta.indexes} == {
            "promotion_student_history_idx",
            "promotion_effective_idx",
            "promotion_promoted_idx",
        }
        assert (
            "can_make_final_grading_decision",
            "Can make final grading decision",
        ) in HistoricalOutcome._meta.permissions
        assert (
            "can_promote_student",
            "Can promote student",
        ) in HistoricalPromotion._meta.permissions
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_registered_in_error_withdrawals_become_other_and_roll_back() -> None:
    withdrawn = candidate(status=GradingCandidate.Status.WITHDRAWN)
    old_target = [("gradings", "0009_candidate_from_rank_and_delete_any_permission")]
    executor = MigrationExecutor(connection)
    final_targets = executor.loader.graph.leaf_nodes()

    def stored() -> tuple[str, str]:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT withdrawal_reason, withdrawal_note"
                " FROM gradings_gradingcandidate WHERE id = %s",
                [withdrawn.pk],
            )
            row = cursor.fetchone()
        assert row is not None
        return (row[0], row[1])

    try:
        executor.migrate(old_target)
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE gradings_gradingcandidate"
                " SET withdrawal_reason = 'ADMIN_ERROR',"
                " withdrawal_note = 'Wrong student'"
                " WHERE id = %s",
                [withdrawn.pk],
            )

        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)
        assert stored() == ("OTHER", "Registered in error. Wrong student")

        executor = MigrationExecutor(connection)
        executor.migrate(old_target)
        assert stored() == ("ADMIN_ERROR", "Registered in error. Wrong student")
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_existing_assessment_items_keep_the_order_they_were_listed_in() -> None:
    generated = assessment()
    old_target = [("gradings", "0010_withdrawal_reason_other")]
    executor = MigrationExecutor(connection)
    final_targets = executor.loader.graph.leaf_nodes()

    def query(columns: str, order_by: str) -> list[tuple[Any, ...]]:
        with connection.cursor() as cursor:
            cursor.execute(
                f"SELECT {columns} FROM gradings_candidateassessmentitem"
                f" WHERE assessment_id = %s ORDER BY {order_by}",
                [generated.pk],
            )
            return list(cursor.fetchall())

    untouched = "id, item_code, requirement_sequence, result, updated_at"

    try:
        executor.migrate(old_target)
        # Before positions existed, items were listed by copied sequence, then
        # name, then id. Equal sequences leave the name to decide.
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE gradings_candidateassessmentitem"
                " SET requirement_sequence = 1 WHERE assessment_id = %s",
                [generated.pk],
            )
        listed = query("id", "requirement_sequence, item_name, id")
        before = query(untouched, "id")

        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)

        assert query("id", "position") == listed
        assert [row[0] for row in query("position", "position")] == list(
            range(1, len(listed) + 1),
        )
        assert query(untouched, "id") == before
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)


def test_all_new_tests_use_postgresql_backend() -> None:
    assert connection.vendor == "postgresql"
    assert apps.is_installed("gradings")


# ---------------------------------------------------------------------------
# Deletion rules hold from every path, not just the API (KG-009)
# ---------------------------------------------------------------------------


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
    # request.user is threaded into the validator (KG-036-class fix,
    # 2026-09-23), so this must use a non-admin to still exercise the gate.
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


# ---------------------------------------------------------------------------
# A locked session always has an honest way out (KG-008)
# ---------------------------------------------------------------------------


def override_master(email: str) -> User:
    actor = user(email)
    actor.user_permissions.add(
        Permission.objects.get(
            codename="can_override_locked_session",
            content_type=ContentType.objects.get_for_model(GradingSession),
        ),
    )
    return User.objects.get(pk=actor.pk)


def locked_session_with_undecided_candidate() -> tuple[
    GradingSession, GradingCandidate
]:
    # Graded but with no decision yet - the only state a candidate can be in
    # once a session locks, since locking requires every assessment complete.
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    complete_assessment(generated)
    transition_grading_session(session, GradingSession.Status.LOCKED)
    session.refresh_from_db()
    built.refresh_from_db()
    return session, built


def test_a_candidate_withdrawn_after_lock_no_longer_blocks_completion() -> None:
    # Without this a candidate who could not receive a decision (registered in
    # error, or unable to continue) could only be cleared by finalising an
    # outcome nobody actually decided.
    session, built = locked_session_with_undecided_candidate()
    master_user = override_master("override-master@example.com")

    withdrawn = withdraw_locked_candidate(
        built,
        reason=GradingCandidate.WithdrawalReason.INJURY,
        note="Ankle injury during breaking.",
        actor=master_user,
    )

    assert withdrawn.status == GradingCandidate.Status.WITHDRAWN
    assert withdrawn.withdrawal_reason == GradingCandidate.WithdrawalReason.INJURY
    assert withdrawn.withdrawn_by == master_user
    assert withdrawn.withdrawn_at is not None

    # And the session can now complete, since withdrawn candidates do not block.
    completed = transition_grading_session(
        session,
        GradingSession.Status.COMPLETED,
    )
    assert completed.status == GradingSession.Status.COMPLETED


def test_withdrawal_keeps_the_assessment_exactly_as_recorded() -> None:
    session, built = locked_session_with_undecided_candidate()
    generated = built.assessment
    item = generated.items.first()
    assert item is not None
    result_before = item.result

    withdraw_locked_candidate(
        built,
        reason=GradingCandidate.WithdrawalReason.INJURY,
        note="",
        actor=override_master("keeps-partial@example.com"),
    )

    item.refresh_from_db()
    generated.refresh_from_db()
    assert item.result == result_before
    assert generated.status == CandidateAssessment.Status.COMPLETED


def test_locked_withdrawal_requires_authority() -> None:
    _session, built = locked_session_with_undecided_candidate()

    with pytest.raises(ValidationError):
        withdraw_locked_candidate(
            built,
            reason=GradingCandidate.WithdrawalReason.INJURY,
            note="",
            actor=user("no-override-authority@example.com"),
        )

    built.refresh_from_db()
    assert built.status == GradingCandidate.Status.COMPLETED


def test_locked_withdrawal_is_refused_once_the_outcome_is_finalised() -> None:
    built, _generated = locked_completed_candidate()
    finalised_outcome(built)

    with pytest.raises(ValidationError) as exc_info:
        withdraw_locked_candidate(
            built,
            reason=GradingCandidate.WithdrawalReason.WITHDREW,
            note="",
            actor=override_master("too-late@example.com"),
        )

    assert "finalised outcome" in str(exc_info.value)


def test_locked_withdrawal_clears_an_undecided_outcome() -> None:
    built, _generated = locked_completed_candidate()
    proposer = user("proposer-before-withdrawal@example.com")
    outcome = create_candidate_outcome(built, user("draft-outcome@example.com"))
    propose_candidate_outcome(
        outcome,
        proposed_outcome=CandidateOutcome.Outcome.PASS,
        proposal_notes="Strong performance, recommend a pass.",
        actor=proposer,
    )

    withdrawn = withdraw_locked_candidate(
        built,
        reason=GradingCandidate.WithdrawalReason.OTHER,
        note="Registered against the wrong session.",
        actor=override_master("clears-proposal@example.com"),
    )

    # A proposal was never a decision; leaving it attached to a withdrawn
    # candidate would misrepresent the record.
    assert not CandidateOutcome.objects.filter(pk=outcome.pk).exists()

    # But discarding it silently would erase that someone proposed PASS -
    # captured into the withdrawal event before the delete (KG-041).
    event = AuditEvent.objects.filter(
        action=AuditAction.CANDIDATE_WITHDRAWN,
        entity_id=str(withdrawn.pk),
    ).latest("occurred_at")
    discarded = event.metadata["discarded_proposal"]
    assert discarded["status"] == CandidateOutcome.Status.PROPOSED
    assert discarded["proposed_outcome"] == CandidateOutcome.Outcome.PASS
    assert discarded["proposal_notes"] == "Strong performance, recommend a pass."
    assert discarded["proposed_by"] == str(proposer.pk)


def test_locked_withdrawal_rejects_an_unknown_reason() -> None:
    _session, built = locked_session_with_undecided_candidate()

    with pytest.raises(ValidationError):
        withdraw_locked_candidate(
            built,
            reason="BECAUSE",
            note="",
            actor=override_master("bad-reason@example.com"),
        )


def test_cancelling_a_locked_session_requires_authority_and_a_reason() -> None:
    session, _built = locked_session_with_undecided_candidate()

    with pytest.raises(ValidationError):
        transition_grading_session(
            session,
            GradingSession.Status.CANCELLED,
            actor=user("cannot-cancel-locked@example.com"),
        )

    with pytest.raises(ValidationError) as exc_info:
        transition_grading_session(
            session,
            GradingSession.Status.CANCELLED,
            actor=override_master("no-reason-given@example.com"),
            reason="   ",
        )
    assert "reason is required" in str(exc_info.value)

    session.refresh_from_db()
    assert session.status == GradingSession.Status.LOCKED


def test_admin_session_form_accepts_a_cancellation_reason() -> None:
    # The regression this actually guards against: driving save_model with a
    # stub form (as the test below does) never exercises Meta.fields at all,
    # so it would pass even with the field missing from the real form. Only
    # binding real POST-shaped data through GradingSessionAdminForm proves
    # the field is there to submit in the first place (KG-050).
    session, _built = locked_session_with_undecided_candidate()

    form = GradingSessionAdminForm(
        data={
            "title": session.title,
            "grading_date": session.grading_date,
            "status": GradingSession.Status.CANCELLED,
            "location": session.location,
            "notes": session.notes,
            "cancellation_reason": "Venue lost power; grading abandoned.",
            "created_by": session.created_by_id,
        },
        instance=session,
    )

    assert form.is_valid(), form.errors
    saved = form.save(commit=False)
    assert saved.cancellation_reason == "Venue lost power; grading abandoned."


def test_admin_can_cancel_a_locked_session_with_a_reason() -> None:
    # Complements the form-binding test above: once the reason reaches the
    # object, save_model must actually thread it through to
    # transition_grading_session rather than dropping it.
    session, _built = locked_session_with_undecided_candidate()
    model_admin = GradingSessionAdmin(GradingSession, admin.site)
    master_user = override_master("admin-cancel-master@example.com")
    session.status = GradingSession.Status.CANCELLED
    session.cancellation_reason = "Venue lost power; grading abandoned."
    form = cast(
        "ModelForm[Any]",
        SimpleNamespace(changed_data=["status", "cancellation_reason"]),
    )
    request = cast(HttpRequest, RequestFactory().post("/admin/"))
    request.user = master_user

    model_admin.save_model(request, session, form, True)

    session.refresh_from_db()
    assert session.status == GradingSession.Status.CANCELLED
    assert session.cancellation_reason == "Venue lost power; grading abandoned."


def test_cancelling_a_locked_session_records_the_reason() -> None:
    session, _built = locked_session_with_undecided_candidate()

    cancelled = transition_grading_session(
        session,
        GradingSession.Status.CANCELLED,
        actor=override_master("cancels-locked@example.com"),
        reason="Venue lost; grading abandoned.",
    )

    assert cancelled.status == GradingSession.Status.CANCELLED
    assert cancelled.cancellation_reason == "Venue lost; grading abandoned."


def test_api_accepts_the_cancellation_reason_but_never_serves_it() -> None:
    session, _built = locked_session_with_undecided_candidate()
    canceller = user("api-cancel-locked@example.com", role=User.Role.ADMINISTRATOR)
    canceller.user_permissions.add(
        Permission.objects.get(
            codename="can_override_locked_session",
            content_type=ContentType.objects.get_for_model(GradingSession),
        ),
    )
    client = APIClient()
    client.force_authenticate(user=User.objects.get(pk=canceller.pk))
    url = f"/api/gradings/sessions/{session.id}/"

    refused = client.patch(url, {"status": "CANCELLED"}, format="json")
    assert refused.status_code == 400
    assert "reason is required" in refused.json()["error"]["message"]
    session.refresh_from_db()
    assert session.status == GradingSession.Status.LOCKED

    accepted = client.patch(
        url,
        {
            "status": "CANCELLED",
            "cancellation_reason": "Venue lost; grading abandoned.",
        },
        format="json",
    )
    assert accepted.status_code == 200, accepted.json()
    assert accepted.json()["status"] == "CANCELLED"
    assert "cancellation_reason" not in accepted.json()
    assert "cancellation_reason" not in client.get(url).json()
    session.refresh_from_db()
    assert session.cancellation_reason == "Venue lost; grading abandoned."


def test_cancelling_a_draft_session_still_needs_no_reason() -> None:
    session = grading_session(status=GradingSession.Status.DRAFT)

    cancelled = transition_grading_session(session, GradingSession.Status.CANCELLED)

    assert cancelled.status == GradingSession.Status.CANCELLED
    assert cancelled.cancellation_reason == ""


def test_withdrawal_attribution_is_a_database_constraint() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            GradingCandidate.objects.filter(pk=built.pk).update(
                withdrawal_reason=GradingCandidate.WithdrawalReason.INJURY,
                withdrawn_by=None,
                withdrawn_at=None,
            )


def test_withdraw_api_requires_override_authority() -> None:
    _session, built = locked_session_with_undecided_candidate()
    client = auth_client("withdraw-api-plain@example.com")

    response = client.post(
        f"/api/gradings/candidates/{built.id}/withdraw/",
        {"withdrawal_reason": GradingCandidate.WithdrawalReason.INJURY},
        format="json",
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


def test_withdraw_api_records_the_withdrawal() -> None:
    _session, built = locked_session_with_undecided_candidate()
    master_user = override_master("withdraw-api-master@example.com")
    client = APIClient()
    client.force_authenticate(user=master_user)

    response = client.post(
        f"/api/gradings/candidates/{built.id}/withdraw/",
        {
            "withdrawal_reason": GradingCandidate.WithdrawalReason.ABSENT,
            "withdrawal_note": "Did not arrive.",
        },
        format="json",
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == GradingCandidate.Status.WITHDRAWN
    assert (
        payload["student_display_name"]
        == (f"{built.student.first_name} {built.student.last_name}").strip()
    )
    assert payload["withdrawal_reason"] == GradingCandidate.WithdrawalReason.ABSENT
    assert payload["withdrawal_reason_display"] == "Did not attend"
    assert payload["withdrawal_note"] == "Did not arrive."
    built.refresh_from_db()
    assert built.withdrawn_by == master_user
    assert built.withdrawn_at is not None


# ---------------------------------------------------------------------------
# Integrity guaranteed by the database, not only the model (KG-010, KG-011)
# ---------------------------------------------------------------------------


def test_outcome_cannot_be_attached_to_another_candidates_assessment() -> None:
    built, _generated = locked_completed_candidate()
    outcome = create_candidate_outcome(
        built,
        user("outcome-reattach-creator@example.com"),
    )
    _other_built, other_generated = locked_completed_candidate()

    # QuerySet.update() bypasses model validation entirely; before the
    # composite foreign key this silently succeeded. Not finalised, so this
    # reaches the constraint rather than the separate immutable-outcome
    # guard on QuerySet.update() (KG-044).
    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.filter(pk=outcome.pk).update(
            assessment=other_generated,
        )


def test_notes_only_item_change_is_recorded() -> None:
    # Previously only a result change recorded anything, so the written
    # judgement about a candidate - the part a dispute would turn on -
    # could be silently rewritten with no trace (KG-037).
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    item = generated.items.first()
    assert item is not None
    assessor = user("notes-only-assessor@example.com")
    before = AuditEvent.objects.filter(action=AuditAction.ITEM_RESULT_RECORDED).count()

    updated = update_candidate_assessment_item(
        item,
        assessor_notes="Clean technique on the first attempt.",
        assessor=assessor,
    )

    after = AuditEvent.objects.filter(action=AuditAction.ITEM_RESULT_RECORDED).count()
    assert after == before + 1
    event = AuditEvent.objects.filter(
        action=AuditAction.ITEM_RESULT_RECORDED,
        entity_id=str(updated.pk),
    ).latest("occurred_at")
    assert event.metadata["before"]["assessor_notes"] == ""
    assert (
        event.metadata["after"]["assessor_notes"]
        == "Clean technique on the first attempt."
    )
    assert event.actor == assessor


def test_repeating_the_same_item_notes_records_nothing() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    item = generated.items.first()
    assert item is not None
    update_candidate_assessment_item(
        item,
        assessor_notes="Already recorded.",
        assessor=user("repeat-notes-assessor@example.com"),
    )
    before = AuditEvent.objects.filter(action=AuditAction.ITEM_RESULT_RECORDED).count()

    update_candidate_assessment_item(
        item,
        assessor_notes="Already recorded.",
        assessor=user("repeat-notes-assessor-2@example.com"),
    )

    after = AuditEvent.objects.filter(action=AuditAction.ITEM_RESULT_RECORDED).count()
    assert after == before


def test_assessed_item_cannot_lose_its_assessor() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    item = generated.items.first()
    assert item is not None
    update_candidate_assessment_item(
        item,
        result=CandidateAssessmentItem.Result.MET,
        assessor=user("keeps-attribution@example.com"),
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateAssessmentItem.objects.filter(pk=item.pk).update(
            assessor=None,
            assessed_at=None,
        )


def test_unassessed_item_cannot_claim_an_assessor() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    item = generated.items.first()
    assert item is not None

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateAssessmentItem.objects.filter(pk=item.pk).update(
            assessor=user("phantom-assessor@example.com"),
            assessed_at=timezone.now(),
        )


def test_deleting_an_assessor_is_blocked_rather_than_erasing_attribution() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    item = generated.items.first()
    assert item is not None
    judge = user("protected-assessor@example.com")
    update_candidate_assessment_item(
        item,
        result=CandidateAssessmentItem.Result.MET,
        assessor=judge,
    )

    # Previously SET_NULL, which would have erased who judged the item and
    # violated the attribution constraint. Now consistent with generated_by,
    # proposed_by, decided_by and promoted_by.
    with pytest.raises(ProtectedError):
        judge.delete()


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


def test_a_student_who_has_left_cannot_be_registered_for_a_grading() -> None:
    session = grading_session(status=GradingSession.Status.DRAFT)
    learner = student(wksa_id="LEFT-001")
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
    learner = student(wksa_id="BREAK-001")
    learner.status = Student.Status.INACTIVE
    learner.save()

    built = build_candidate(
        session=session,
        student=learner,
        testing_for_rank=rank("YELLOW_STRIPE"),
    )
    built.save()

    assert built.pk is not None


def test_withdrawal_reasons_are_served_with_which_needs_a_note() -> None:
    response = auth_client("withdrawal-reasons@example.com").get(
        "/api/gradings/withdrawal-reasons/",
    )

    assert response.status_code == 200
    assert results(response) == [
        {"code": "INJURY", "name": "Injured during grading", "note_required": False},
        {"code": "WITHDREW", "name": "Withdrew voluntarily", "note_required": False},
        {"code": "ABSENT", "name": "Did not attend", "note_required": False},
        {"code": "OTHER", "name": "Other", "note_required": True},
    ]


def test_an_other_withdrawal_needs_a_note() -> None:
    built = candidate(session=grading_session(status=GradingSession.Status.OPEN))
    client = auth_client("other-withdrawal@example.com")
    url = "/api/gradings/candidates/bulk-update-status/"

    refused = client.post(
        url,
        {
            "candidates": [built.pk],
            "status": "WITHDRAWN",
            "withdrawal_reason": "OTHER",
            "withdrawal_note": "  ",
        },
        format="json",
    )
    accepted = client.post(
        url,
        {
            "candidates": [built.pk],
            "status": "WITHDRAWN",
            "withdrawal_reason": "OTHER",
            "withdrawal_note": "Family emergency",
        },
        format="json",
    )

    assert refused.status_code == 200
    assert refused.json()["errors"]["0"] == ["Say what the other reason is."]
    assert accepted.status_code == 200
    assert accepted.json()["errors"] == {}
    built.refresh_from_db()
    assert built.withdrawal_note == "Family emergency"


def test_a_locked_other_withdrawal_needs_a_note() -> None:
    built, _generated = locked_completed_candidate()

    with pytest.raises(ValidationError) as exc_info:
        withdraw_locked_candidate(
            built,
            reason=GradingCandidate.WithdrawalReason.OTHER,
            note="",
            actor=override_master("other-locked@example.com"),
        )

    assert "withdrawal_note" in exc_info.value.message_dict


# ---------------------------------------------------------------------------
# KG-A11/KG-A12: expected constraint races, stale callers and no-op writes
# ---------------------------------------------------------------------------


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
    # instead of an IntegrityError (KG-A11).
    source = grading_session(status=GradingSession.Status.OPEN, title="Source")
    target = grading_session(status=GradingSession.Status.OPEN, title="Target")
    both = student()
    moving = candidate(session=source, student=both)
    candidate(session=target, student=both)

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


# ---------------------------------------------------------------------------
# Session detail and assessment notes edits are audited (KG-A14)
# ---------------------------------------------------------------------------


def test_editing_a_sessions_details_is_audited_and_a_resend_is_not() -> None:
    session = grading_session(title="Spring grading", location="Hall A")
    client = auth_client("session-detail-editor@example.com")
    url = f"/api/gradings/sessions/{session.pk}/"

    first = client.patch(url, {"title": "Spring grading", "location": "Hall B"})
    resent = client.patch(url, {"title": "Spring grading", "location": "Hall B"})

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


def test_an_admin_session_edit_records_the_same_event() -> None:
    session = grading_session(notes="Bring belts")
    session.notes = "Bring belts and water"
    admin_user = user("session-admin-editor@example.com")
    request = cast(HttpRequest, RequestFactory().post("/admin/"))
    request.user = admin_user

    GradingSessionAdmin(GradingSession, admin.site).save_model(
        request,
        session,
        cast("ModelForm[Any]", SimpleNamespace(changed_data=["notes"])),
        True,
    )

    event = AuditEvent.objects.get(action=AuditAction.SESSION_UPDATED)
    assert event.actor == admin_user
    assert event.metadata["after"] == {"notes": "Bring belts and water"}


def test_editing_assessment_notes_is_audited_with_both_versions() -> None:
    generated = start_assessment(
        assessment(
            candidate=candidate(
                session=grading_session(status=GradingSession.Status.OPEN),
            ),
        ),
    )
    actor = user("assessment-notes-editor@example.com")

    update_candidate_assessment(generated, notes="Strong stances", actor=actor)
    update_candidate_assessment(generated, notes="Strong stances", actor=actor)

    [event] = AuditEvent.objects.filter(action=AuditAction.ASSESSMENT_UPDATED)
    assert event.actor == actor
    assert event.metadata == {
        "before": {"notes": ""},
        "after": {"notes": "Strong stances"},
    }
