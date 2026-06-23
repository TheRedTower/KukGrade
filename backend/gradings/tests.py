from __future__ import annotations

from datetime import date
from types import SimpleNamespace
from typing import Any, cast

import pytest
from django.apps import apps
from django.contrib import admin
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.db.models.deletion import ProtectedError
from django.forms import ModelForm
from django.http import HttpRequest
from django.test import RequestFactory
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from accounts.permissions import FINAL_GRADING_DECISION_PERMISSION
from gradings.admin import (
    CandidateOutcomeAdmin,
    GradingSessionAdmin,
    GradingSessionAdminForm,
)
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
)
from gradings.services import (
    applicable_syllabus_requirements,
    build_candidate,
    candidate_assessment_summary,
    create_candidate_outcome,
    finalise_candidate_outcome,
    generate_candidate_assessment,
    propose_candidate_outcome,
    resolve_age_band,
    transition_grading_session,
    update_candidate_assessment,
    update_candidate_assessment_item,
    validate_candidate_can_be_deleted,
    validate_session_transition,
)
from ranks.models import Rank
from students.models import Student
from syllabus.models import AgeBand, SyllabusItem, SyllabusRequirement

pytestmark = pytest.mark.django_db


def user(email: str = "grading-user@example.com", **overrides: Any) -> User:
    return User.objects.create_user(email=email, **overrides)


def rank(code: str) -> Rank:
    return Rank.objects.get(code=code)


def grading_session(**overrides: object) -> GradingSession:
    status = cast(str, overrides.pop("status", GradingSession.Status.DRAFT))
    data: dict[str, object] = {
        "title": "March 2027 Colchester Grading",
        "grading_date": date(2027, 3, 20),
        "created_by": user(f"creator-{GradingSession.objects.count()}@example.com"),
    }
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
    built = build_candidate(
        session=cast(GradingSession, session),
        student=cast(Student, candidate_student),
        testing_for_rank=cast(Rank, testing_for_rank),
        status=cast(
            str,
            overrides.pop("status", GradingCandidate.Status.REGISTERED),
        ),
        notes=cast(str, overrides.pop("notes", "")),
    )
    for key, value in overrides.items():
        setattr(built, key, value)
    built.save()
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


def complete_assessment(assessment: CandidateAssessment) -> CandidateAssessment:
    assessment.refresh_from_db()
    if assessment.status == CandidateAssessment.Status.NOT_STARTED:
        assessment = start_assessment(assessment)
    assessment.items.filter(required=True).update(
        result=CandidateAssessmentItem.Result.MET,
    )
    return update_candidate_assessment(
        assessment,
        status=CandidateAssessment.Status.COMPLETED,
    )


def master(email: str = "master@example.com") -> User:
    finaliser = user(email)
    grant_final_decision_permission(finaliser)
    return finaliser


def grant_final_decision_permission(finaliser: User) -> None:
    app_label, codename = FINAL_GRADING_DECISION_PERMISSION.split(".")
    permission = Permission.objects.get(
        codename=codename,
        content_type=ContentType.objects.get(
            app_label=app_label,
            model="candidateoutcome",
        ),
    )
    finaliser.user_permissions.add(permission)


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
        (GradingSession.Status.LOCKED, GradingSession.Status.CANCELLED),
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
        (date(2012, 2, 29), date(2021, 2, 28), AgeBand.AGE_8_AND_UNDER),
        (date(2012, 2, 29), date(2021, 3, 1), AgeBand.AGE_9_TO_12),
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


def test_applicable_syllabus_requirements_helper_returns_rank_age_rows_in_order() -> (
    None
):
    session = grading_session()
    candidate_student = student(date_of_birth=date(2017, 3, 20))
    built = candidate(session=session, student=candidate_student)

    first_item = SyllabusItem.objects.create(
        code="GRADING_HELPER_FIRST",
        name="A First Helper Item",
        category=SyllabusItem.Category.TECHNIQUE_SET,
    )
    second_item = SyllabusItem.objects.create(
        code="GRADING_HELPER_SECOND",
        name="B Second Helper Item",
        category=SyllabusItem.Category.TECHNIQUE_SET,
    )
    SyllabusRequirement.objects.create(
        rank=built.testing_for_rank,
        item=second_item,
        age_band=built.age_band,
        sequence=200,
    )
    SyllabusRequirement.objects.create(
        rank=built.testing_for_rank,
        item=first_item,
        age_band=built.age_band,
        sequence=100,
    )
    SyllabusRequirement.objects.create(
        rank=rank("YELLOW"),
        item=SyllabusItem.objects.create(
            code="GRADING_HELPER_OTHER_RANK",
            name="Other Rank Item",
            category=SyllabusItem.Category.TECHNIQUE_SET,
        ),
        age_band=built.age_band,
        sequence=50,
    )

    requirements = list(applicable_syllabus_requirements(built))
    helper_requirements = [
        requirement
        for requirement in requirements
        if requirement.item.code.startswith("GRADING_HELPER_")
    ]

    assert helper_requirements == list(
        SyllabusRequirement.objects.filter(
            item__code__in=["GRADING_HELPER_FIRST", "GRADING_HELPER_SECOND"],
        ).order_by("sequence", "item__name", "item__code"),
    )
    assert {requirement.rank for requirement in requirements} == {
        built.testing_for_rank
    }
    assert {requirement.age_band for requirement in requirements} == {built.age_band}
    assert [requirement.sequence for requirement in requirements] == sorted(
        requirement.sequence for requirement in requirements
    )


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
    assert payload["created_by"] == str(creator.id)

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
    assert [item["id"] for item in response.json()] == [draft.id]


def test_session_api_malformed_or_reversed_date_filters_return_empty_list() -> None:
    grading_session(title="Filtered", grading_date=date(2027, 4, 1))
    client = auth_client("session-filter-invalid@example.com")

    malformed_response = client.get("/api/gradings/sessions/?grading_date=not-a-date")
    reversed_response = client.get(
        "/api/gradings/sessions/"
        "?grading_date_from=2027-05-01&grading_date_to=2027-04-01",
    )

    assert malformed_response.status_code == 200
    assert malformed_response.json() == []
    assert reversed_response.status_code == 200
    assert reversed_response.json() == []


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
    start_assessment(assessment(candidate=built))
    allowed_response = client.patch(
        f"/api/gradings/sessions/{session.id}/",
        {"status": GradingSession.Status.LOCKED},
        format="json",
    )

    assert missing_response.status_code == 400
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
    assert "in progress or completed" in str(response.json())
    session.refresh_from_db()
    assert session.status == GradingSession.Status.OPEN


def test_session_api_enforces_assessment_completion_before_session_completion() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    transition_grading_session(session, GradingSession.Status.LOCKED)
    client = auth_client("session-complete-api@example.com")

    incomplete_response = client.patch(
        f"/api/gradings/sessions/{session.id}/",
        {"status": GradingSession.Status.COMPLETED},
        format="json",
    )
    complete_assessment(generated)
    finalised_outcome(built)
    complete_response = client.patch(
        f"/api/gradings/sessions/{session.id}/",
        {"status": GradingSession.Status.COMPLETED},
        format="json",
    )

    assert incomplete_response.status_code == 400
    assert complete_response.status_code == 200
    assert complete_response.json()["status"] == GradingSession.Status.COMPLETED


def test_session_api_rejects_locked_to_open_transition() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    start_assessment(assessment(candidate=built))
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
    assert "in progress or completed" in str(not_started_exc.value)

    start_assessment(generated)
    locked = transition_grading_session(session, GradingSession.Status.LOCKED)
    assert locked.status == GradingSession.Status.LOCKED

    with pytest.raises(ValidationError):
        transition_grading_session(locked, GradingSession.Status.OPEN)
    with pytest.raises(ValidationError):
        transition_grading_session(locked, GradingSession.Status.COMPLETED)

    complete_assessment(generated)
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

    assert "in progress or completed" in str(exc_info.value)
    session.refresh_from_db()
    generated.refresh_from_db()
    assert session.status == GradingSession.Status.OPEN
    assert generated.status == CandidateAssessment.Status.NOT_STARTED


def test_session_lock_allows_all_in_progress_assessments() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    start_assessment(assessment(candidate=candidate(session=session)))
    start_assessment(assessment(candidate=candidate(session=session)))

    locked = transition_grading_session(session, GradingSession.Status.LOCKED)

    assert locked.status == GradingSession.Status.LOCKED


def test_session_lock_allows_all_completed_assessments() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    complete_assessment(assessment(candidate=candidate(session=session)))
    complete_assessment(assessment(candidate=candidate(session=session)))

    locked = transition_grading_session(session, GradingSession.Status.LOCKED)

    assert locked.status == GradingSession.Status.LOCKED


def test_session_lock_allows_mixed_in_progress_and_completed_assessments() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    start_assessment(assessment(candidate=candidate(session=session)))
    complete_assessment(assessment(candidate=candidate(session=session)))

    locked = transition_grading_session(session, GradingSession.Status.LOCKED)

    assert locked.status == GradingSession.Status.LOCKED


def test_withdrawn_candidates_do_not_block_session_locking() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    active = candidate(session=session)
    withdrawn_without_assessment = candidate(
        session=session,
        status=GradingCandidate.Status.WITHDRAWN,
    )
    withdrawn_with_not_started_assessment = candidate(session=session)
    assessment(candidate=withdrawn_with_not_started_assessment)
    withdrawn_with_not_started_assessment.status = GradingCandidate.Status.WITHDRAWN
    withdrawn_with_not_started_assessment.save()
    start_assessment(assessment(candidate=active))

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
    assert "in progress or completed" in str(form.errors["status"])


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


def test_admin_session_save_uses_transition_service_for_status_changes() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    candidate(session=session)
    model_admin = GradingSessionAdmin(GradingSession, admin.site)
    session.status = GradingSession.Status.LOCKED
    form = cast(ModelForm, SimpleNamespace(changed_data=["status"]))

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
    start_assessment(assessment(candidate=candidate(session=session)))
    model_admin = GradingSessionAdmin(GradingSession, admin.site)
    session.status = GradingSession.Status.LOCKED
    session.location = "Main hall"
    form = cast(ModelForm, SimpleNamespace(changed_data=["status", "location"]))

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
    form = cast(ModelForm, SimpleNamespace(changed_data=["status", "location"]))

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
    form = cast(ModelForm, SimpleNamespace(changed_data=["status", "location"]))

    with pytest.raises(ValidationError) as exc_info:
        model_admin.save_model(
            admin_request("session-admin-not-started-mixed@example.com"),
            session,
            form,
            True,
        )

    assert "in progress or completed" in str(exc_info.value)
    session.refresh_from_db()
    assert session.status == GradingSession.Status.OPEN
    assert session.location == "Old hall"


def test_authenticated_candidate_crud_and_age_band_spoofing_rejected() -> None:
    session = grading_session()
    candidate_student = student(date_of_birth=date(2017, 3, 20))
    client = auth_client("candidate-crud@example.com")

    create_response = client.post(
        "/api/gradings/candidates/",
        {
            "session": session.id,
            "student": candidate_student.id,
            "testing_for_rank": rank("YELLOW_STRIPE").id,
            "age_band": AgeBand.AGE_18_AND_OVER,
            "notes": "Ready",
        },
        format="json",
    )

    assert create_response.status_code == 201
    payload = create_response.json()
    assert payload["age_band"] == AgeBand.AGE_9_TO_12
    assert payload["student_wksa_id"] == candidate_student.wksa_id
    assert payload["testing_for_rank_code"] == "YELLOW_STRIPE"

    detail_response = client.get(f"/api/gradings/candidates/{payload['id']}/")
    patch_response = client.patch(
        f"/api/gradings/candidates/{payload['id']}/",
        {"status": GradingCandidate.Status.WITHDRAWN},
        format="json",
    )
    delete_response = client.delete(f"/api/gradings/candidates/{payload['id']}/")

    assert detail_response.status_code == 200
    assert patch_response.status_code == 200
    assert delete_response.status_code == 204


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
        "/api/gradings/candidates/"
        f"?session={session.id}"
        "&student_wksa_id=FILTER001"
        "&testing_for_rank_code=YELLOW_STRIPE"
        f"&age_band={AgeBand.AGE_9_TO_12}"
        "&status=REGISTERED",
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [built.id]


def test_candidate_api_duplicate_returns_validation_error() -> None:
    session = grading_session()
    candidate_student = student()
    candidate(session=session, student=candidate_student)
    client = auth_client("candidate-duplicate@example.com")

    response = client.post(
        "/api/gradings/candidates/",
        {
            "session": session.id,
            "student": candidate_student.id,
            "testing_for_rank": rank("YELLOW_STRIPE").id,
        },
        format="json",
    )

    assert response.status_code == 400


def test_candidate_api_invalid_next_rank_returns_validation_error() -> None:
    client = auth_client("candidate-invalid-rank@example.com")

    response = client.post(
        "/api/gradings/candidates/",
        {
            "session": grading_session().id,
            "student": student().id,
            "testing_for_rank": rank("YELLOW").id,
        },
        format="json",
    )

    assert response.status_code == 400
    assert "testing_for_rank" in response.json()


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
        "/api/gradings/candidates/",
        {
            "session": session.id,
            "student": student().id,
            "testing_for_rank": rank("YELLOW_STRIPE").id,
        },
        format="json",
    )

    assert response.status_code == 400


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

    response = client.patch(
        f"/api/gradings/candidates/{built.id}/",
        {"status": GradingCandidate.Status.WITHDRAWN, "notes": "Changed"},
        format="json",
    )

    assert response.status_code == 400
    built.refresh_from_db()
    assert built.status == GradingCandidate.Status.REGISTERED
    assert built.notes == ""


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


def test_generate_candidate_assessment_creates_snapshot_items() -> None:
    built = candidate()
    generator = user("assessment-generator@example.com")
    requirements = list(applicable_syllabus_requirements(built))

    generated = generate_candidate_assessment(built, generator)

    assert generated.candidate == built
    assert generated.generated_by == generator
    assert generated.status == CandidateAssessment.Status.NOT_STARTED
    assert generated.generated_at is not None
    assert generated.items.count() == len(requirements)
    first_requirement = requirements[0]
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


def test_generate_candidate_assessment_rejects_no_applicable_requirements() -> None:
    current_rank = Rank.objects.create(
        code="NO_REQ_CURRENT",
        name="No Requirement Current",
        order=100,
        category=Rank.Category.COLOURED_BELT,
    )
    target_rank = Rank.objects.create(
        code="NO_REQ_TARGET",
        name="No Requirement Target",
        order=101,
        category=Rank.Category.COLOURED_BELT,
    )
    built = candidate(
        student=student(current_rank=current_rank),
        testing_for_rank=target_rank,
    )

    with pytest.raises(ValidationError) as exc_info:
        assessment(candidate=built)

    assert "No applicable syllabus requirements exist." in str(exc_info.value)


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


def test_generation_is_atomic_if_item_creation_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    built = candidate()

    def fail_bulk_create(*args: object, **kwargs: object) -> None:
        raise IntegrityError("forced item failure")

    monkeypatch.setattr(
        CandidateAssessmentItem.objects, "bulk_create", fail_bulk_create
    )

    with pytest.raises(ValidationError):
        assessment(candidate=built)

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


def test_in_progress_assessment_item_update_allowed_in_locked_session() -> None:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    update_candidate_assessment(
        generated,
        status=CandidateAssessment.Status.IN_PROGRESS,
    )
    transition_grading_session(session, GradingSession.Status.LOCKED)
    item = generated.items.first()
    assert item is not None
    assessor = user("locked-in-progress-assessor@example.com")

    updated = update_candidate_assessment_item(
        item,
        result=CandidateAssessmentItem.Result.MET,
        assessor=assessor,
    )

    assert updated.result == CandidateAssessmentItem.Result.MET
    assert updated.assessor == assessor


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
    session = transition_grading_session(session, GradingSession.Status.LOCKED)

    with pytest.raises(ValidationError):
        validate_session_transition(
            GradingSession.Status.LOCKED,
            GradingSession.Status.COMPLETED,
            session=session,
        )

    complete_assessment(generated)
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

    response = client.patch(
        f"/api/gradings/candidates/{built.id}/",
        {"status": GradingCandidate.Status.COMPLETED},
        format="json",
    )

    assert response.status_code == 400
    built.refresh_from_db()
    assert built.status == GradingCandidate.Status.REGISTERED


def test_assessment_api_generation_lists_filters_counts_and_rejects_delete() -> None:
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
    assert (
        payload["item_counts"]["total"]
        == CandidateAssessmentItem.objects.filter(
            assessment_id=payload["id"],
        ).count()
    )
    assert "outcome" not in payload

    list_response = client.get(
        "/api/gradings/assessments/"
        f"?candidate={built.id}&session={session.id}"
        f"&student_wksa_id={built.student.wksa_id}"
        "&testing_for_rank_code=YELLOW_STRIPE"
        "&status=NOT_STARTED",
    )
    detail_response = client.get(f"/api/gradings/assessments/{payload['id']}/")
    post_response = client.post("/api/gradings/assessments/", {}, format="json")
    delete_response = client.delete(f"/api/gradings/assessments/{payload['id']}/")

    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [payload["id"]]
    assert detail_response.status_code == 200
    assert post_response.status_code == 405
    assert delete_response.status_code == 405


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
        "/api/gradings/assessment-items/"
        f"?assessment={generated.id}&candidate={generated.candidate_id}"
        f"&session={generated.candidate.session_id}&item_code={item.item_code}"
        f"&category={item.category}&result=NOT_MET&required=true",
    )
    post_response = client.post("/api/gradings/assessment-items/", {}, format="json")
    delete_response = client.delete(f"/api/gradings/assessment-items/{item.id}/")

    assert patch_response.status_code == 200
    assert item.item_name == original_name
    assert item.result == CandidateAssessmentItem.Result.NOT_MET
    assert item.assessor == real_assessor
    assert item.assessed_at is not None
    assert item.assessor_notes == "Needs work"
    assert [payload["id"] for payload in list_response.json()] == [item.id]
    assert post_response.status_code == 405
    assert delete_response.status_code == 405


def locked_completed_candidate() -> tuple[GradingCandidate, CandidateAssessment]:
    session = grading_session(status=GradingSession.Status.OPEN)
    built = candidate(session=session)
    generated = assessment(candidate=built)
    start_assessment(generated)
    transition_grading_session(session, GradingSession.Status.LOCKED)
    complete_assessment(generated)
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

    with pytest.raises(IntegrityError), transaction.atomic():
        CandidateOutcome.objects.bulk_create(
            [
                CandidateOutcome(
                    candidate=locked_completed_candidate()[0],
                    assessment=locked_completed_candidate()[1],
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
                can_make_final_grading_decision=True,
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
    required_items[0].save()
    generated.items.filter(required=True).exclude(pk=required_items[0].pk).update(
        result=CandidateAssessmentItem.Result.MET,
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
    assert summary["overall"]["required_not_met"] == 1
    assert summary["overall"]["required_not_assessed"] == 0
    assert summary["overall"]["all_required_assessed"] is True
    assert summary["overall"]["all_required_met"] is False
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
    transition_grading_session(session, GradingSession.Status.LOCKED)
    complete_assessment(first_assessment)
    complete_assessment(second_assessment)
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


def test_candidate_outcome_api_workflow_filters_and_summary() -> None:
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
    assert payload["student_wksa_id"] == built.student.wksa_id
    assert payload["testing_for_rank_code"] == "YELLOW_STRIPE"

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
    summary_response = client.get(f"/api/gradings/outcomes/{outcome_id}/summary/")
    list_response = client.get(
        "/api/gradings/outcomes/"
        f"?session={built.session_id}&candidate={built.id}"
        f"&student_wksa_id={built.student.wksa_id}"
        "&testing_for_rank_code=YELLOW_STRIPE"
        "&status=FINALISED"
        "&proposed_outcome=FAIL"
        "&final_outcome=PASS"
        f"&proposed_by={actor.id}"
        f"&decided_by={master_user.id}",
    )
    delete_response = client.delete(f"/api/gradings/outcomes/{outcome_id}/")
    finalised_patch = client.patch(
        f"/api/gradings/outcomes/{outcome_id}/",
        {"decision_notes": "Changed"},
        format="json",
    )

    assert direct_patch.status_code == 400
    assert propose_response.status_code == 200
    assert propose_response.json()["proposed_by"] == str(actor.id)
    assert forbidden_finalise.status_code == 403
    assert finalise_response.status_code == 200
    assert finalise_response.json()["decided_by"] == str(master_user.id)
    assert finalise_response.json()["final_outcome"] == CandidateOutcome.Outcome.PASS
    assert summary_response.status_code == 200
    assert "final_outcome" not in summary_response.json()
    assert [item["id"] for item in list_response.json()] == [outcome_id]
    assert delete_response.status_code == 405
    assert finalised_patch.status_code == 400


def test_candidate_outcome_admin_is_read_only_and_has_no_bulk_finalisation() -> None:
    built, _generated = locked_completed_candidate()
    outcome = finalised_outcome(built)
    model_admin = CandidateOutcomeAdmin(CandidateOutcome, admin.site)
    request = admin_request("outcome-admin@example.com")
    outcome.decision_notes = "Unsafe admin edit"
    form = cast(ModelForm, SimpleNamespace(changed_data=["decision_notes"]))

    assert model_admin.has_add_permission(request) is False
    assert model_admin.has_delete_permission(request, outcome) is False
    assert model_admin.actions == ()
    with pytest.raises(ValidationError):
        model_admin.save_model(request, outcome, form, True)


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
                    start_number=5,
                    end_number=1,
                ),
            ],
        )


@pytest.mark.django_db(transaction=True)
def test_grading_migrations_apply_from_zero_and_constraints_exist() -> None:
    assert connection.vendor == "postgresql"
    executor = MigrationExecutor(connection)
    final_targets = executor.loader.graph.leaf_nodes()

    try:
        executor.migrate([("gradings", None)])
        executor = MigrationExecutor(connection)
        executor.migrate([("gradings", "0003_candidateoutcome")])
        state_apps = executor.loader.project_state(
            [("gradings", "0003_candidateoutcome")],
        ).apps
        HistoricalSession = state_apps.get_model("gradings", "GradingSession")
        HistoricalCandidate = state_apps.get_model("gradings", "GradingCandidate")
        HistoricalAssessment = state_apps.get_model("gradings", "CandidateAssessment")
        HistoricalItem = state_apps.get_model("gradings", "CandidateAssessmentItem")
        HistoricalOutcome = state_apps.get_model("gradings", "CandidateOutcome")

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
        assert (
            "can_make_final_grading_decision",
            "Can make final grading decision",
        ) in HistoricalOutcome._meta.permissions
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)


def test_all_new_tests_use_postgresql_backend() -> None:
    assert connection.vendor == "postgresql"
    assert apps.is_installed("gradings")
