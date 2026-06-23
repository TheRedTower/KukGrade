from __future__ import annotations

from datetime import date
from typing import cast

import pytest
from django.apps import apps
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.db.models.deletion import ProtectedError
from rest_framework.test import APIClient

from accounts.models import User
from gradings.models import GradingCandidate, GradingSession
from gradings.services import (
    applicable_syllabus_requirements,
    build_candidate,
    resolve_age_band,
    validate_session_transition,
)
from ranks.models import Rank
from students.models import Student
from syllabus.models import AgeBand, SyllabusItem, SyllabusRequirement

pytestmark = pytest.mark.django_db


def user(email: str = "grading-user@example.com") -> User:
    return User.objects.create_user(email=email)


def rank(code: str) -> Rank:
    return Rank.objects.get(code=code)


def grading_session(**overrides: object) -> GradingSession:
    data: dict[str, object] = {
        "title": "March 2027 Colchester Grading",
        "grading_date": date(2027, 3, 20),
        "created_by": user(f"creator-{GradingSession.objects.count()}@example.com"),
    }
    data.update(overrides)
    return GradingSession.objects.create(**data)


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


def auth_client(email: str = "grading-api@example.com") -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user(email))
    return client


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
        (GradingSession.Status.LOCKED, GradingSession.Status.OPEN),
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
    built.session.status = session_status
    built.session.save()
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
    built.session.status = session_status
    built.session.save()
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
    locked_candidate.session.status = GradingSession.Status.LOCKED
    locked_candidate.session.save()
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


@pytest.mark.django_db(transaction=True)
def test_grading_migrations_apply_from_zero_and_constraints_exist() -> None:
    assert connection.vendor == "postgresql"
    executor = MigrationExecutor(connection)
    final_targets = executor.loader.graph.leaf_nodes()

    try:
        executor.migrate([("gradings", None)])
        executor = MigrationExecutor(connection)
        executor.migrate([("gradings", "0001_initial")])
        state_apps = executor.loader.project_state(
            [("gradings", "0001_initial")],
        ).apps
        HistoricalSession = state_apps.get_model("gradings", "GradingSession")
        HistoricalCandidate = state_apps.get_model("gradings", "GradingCandidate")

        session_constraints = {
            constraint.name for constraint in HistoricalSession._meta.constraints
        }
        candidate_constraints = {
            constraint.name for constraint in HistoricalCandidate._meta.constraints
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
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)


def test_all_new_tests_use_postgresql_backend() -> None:
    assert connection.vendor == "postgresql"
    assert apps.is_installed("gradings")
