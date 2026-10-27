from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import patch

import pytest
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.db.models.deletion import ProtectedError
from django.forms import ModelForm
from django.test import RequestFactory
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from audit.models import AuditAction, AuditEvent
from ranks.models import Rank
from students.admin import StudentAdmin
from students.models import Student

pytestmark = pytest.mark.django_db


def white_rank() -> Rank:
    return Rank.objects.get(code="WHITE")


def student_kwargs(**overrides: object) -> dict[str, object]:
    data: dict[str, object] = {
        "wksa_id": "206-2-500",
        "first_name": "Alex",
        "last_name": "Kim",
        "date_of_birth": timezone.localdate().replace(year=2012),
        "current_rank": white_rank(),
    }
    data.update(overrides)
    return data


def test_valid_student_can_be_created() -> None:
    student = Student.objects.create(**student_kwargs())

    assert student.pk is not None
    assert student.wksa_id == "206-2-500"
    assert student.first_name == "Alex"
    assert student.last_name == "Kim"
    assert student.current_rank == white_rank()
    assert student.status == Student.Status.ACTIVE
    assert student.created_at is not None
    assert student.updated_at is not None
    assert str(student) == "Alex Kim (206-2-500)"


def test_duplicate_wksa_ids_are_rejected() -> None:
    Student.objects.create(**student_kwargs())

    with pytest.raises(ValidationError) as exc_info:
        Student.objects.create(
            **student_kwargs(
                first_name="Blair",
                last_name="Park",
            ),
        )

    assert "wksa_id" in exc_info.value.message_dict


def test_blank_wksa_id_is_rejected_by_validation() -> None:
    student = Student(**student_kwargs(wksa_id="   "))

    with pytest.raises(ValidationError) as exc_info:
        student.full_clean()

    assert "WKSA ID is required." in exc_info.value.message_dict["wksa_id"]


def test_missing_wksa_id_is_rejected_by_validation() -> None:
    student = Student(**student_kwargs(wksa_id=None))

    with pytest.raises(ValidationError) as exc_info:
        student.full_clean()

    assert "WKSA ID is required." in exc_info.value.message_dict["wksa_id"]


def test_blank_wksa_id_is_rejected_by_database_constraint() -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Student.objects.bulk_create([Student(**student_kwargs(wksa_id=""))])


def test_wksa_id_preserves_leading_zeros() -> None:
    Student.objects.create(**student_kwargs(wksa_id="206-2-007"))

    student = Student.objects.get(wksa_id="206-2-007")

    assert student.wksa_id == "206-2-007"


def test_age_band_turns_over_on_the_club_date_not_the_utc_date() -> None:
    # 23:30 UTC on 1 June is already 2 June in London, the configured time
    # zone: a student born on 2 June 2018 is nine there, not eight.
    student = Student.objects.create(**student_kwargs(date_of_birth=date(2018, 6, 2)))

    with patch(
        "django.utils.timezone.now",
        return_value=datetime(2027, 6, 1, 23, 30, tzinfo=UTC),
    ):
        assert student.age_band == "AGE_9_TO_12"
    with patch(
        "django.utils.timezone.now",
        return_value=datetime(2027, 6, 1, 22, 30, tzinfo=UTC),
    ):
        assert student.age_band == "AGE_8_AND_UNDER"


def test_future_date_of_birth_is_rejected() -> None:
    student = Student(
        **student_kwargs(date_of_birth=timezone.localdate() + timedelta(days=1)),
    )

    with pytest.raises(ValidationError) as exc_info:
        student.full_clean()

    assert exc_info.value.message_dict["date_of_birth"] == [
        "Date of birth cannot be in the future.",
    ]


def test_current_rank_points_to_expected_rank_record() -> None:
    student = Student.objects.create(**student_kwargs())

    assert student.current_rank.code == "WHITE"
    assert student.current_rank.name == "White"
    assert student.current_rank.order == 1


def test_deleting_referenced_rank_is_blocked() -> None:
    rank = white_rank()
    Student.objects.create(**student_kwargs(current_rank=rank))

    with pytest.raises(ProtectedError):
        rank.delete()


def test_student_current_rank_can_be_changed() -> None:
    student = Student.objects.create(**student_kwargs())
    yellow = Rank.objects.get(code="YELLOW")

    student.current_rank = yellow
    student.save()

    student.refresh_from_db()
    assert student.current_rank == yellow


def test_student_does_not_duplicate_rank_data() -> None:
    field_names = {field.name for field in Student._meta.get_fields()}

    assert "current_rank" in field_names
    assert "rank_name" not in field_names
    assert "rank_order" not in field_names
    assert "rank_category" not in field_names
    assert "current_rank_name" not in field_names


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_existing_student_migration_path_assigns_white_rank() -> None:
    executor = MigrationExecutor(connection)
    final_targets = executor.loader.graph.leaf_nodes()
    old_targets = [
        ("ranks", "0002_seed_rank_catalogue"),
        ("students", "0001_initial"),
    ]

    try:
        executor.migrate(old_targets)
        old_apps = executor.loader.project_state(old_targets).apps
        OldStudent = old_apps.get_model("students", "Student")
        OldStudent.objects.create(
            wksa_id="206-2-502",
            first_name="Migration",
            last_name="Student",
            date_of_birth=date(2010, 3, 1),
            # The historical model at students/0001: `status` does not exist
            # yet, and 0005 is what converts this flag.
            is_active=True,
        )

        executor = MigrationExecutor(connection)
        executor.migrate([("students", "0004_require_current_rank")])
        new_apps = executor.loader.project_state(
            [("students", "0004_require_current_rank")],
        ).apps
        NewStudent = new_apps.get_model("students", "Student")

        student = NewStudent.objects.get(wksa_id="206-2-502")

        assert student.current_rank.code == "WHITE"
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)


def test_student_status_defaults_to_active() -> None:
    assert (
        Student.objects.create(**student_kwargs(wksa_id="206-2-503")).status
        == Student.Status.ACTIVE
    )


def test_inactive_students_can_still_be_graded() -> None:
    # A break - injury, exams, travel - blocks nothing.
    learner = Student.objects.create(**student_kwargs(wksa_id="206-2-504"))
    learner.status = Student.Status.INACTIVE
    learner.save()

    assert learner.can_be_graded is True


def test_a_student_who_has_left_cannot_be_graded() -> None:
    learner = Student.objects.create(**student_kwargs(wksa_id="206-2-505"))
    learner.status = Student.Status.LEFT
    learner.save()

    assert learner.can_be_graded is False


def test_leaving_is_reversible_and_keeps_history() -> None:
    learner = Student.objects.create(**student_kwargs(wksa_id="206-2-506"))
    original_rank = learner.current_rank

    learner.status = Student.Status.LEFT
    learner.save()
    learner.status = Student.Status.ACTIVE
    learner.save()

    learner.refresh_from_db()
    assert learner.can_be_graded is True
    assert learner.current_rank == original_rank


def test_invalid_student_status_is_rejected_by_the_database() -> None:
    learner = Student.objects.create(**student_kwargs(wksa_id="206-2-507"))

    with pytest.raises(IntegrityError), transaction.atomic():
        Student.objects.filter(pk=learner.pk).update(status="GONE_FISHING")


# ---------------------------------------------------------------------------
# The students API: list, retrieve, create, partial_update. No delete, no PUT.
# ---------------------------------------------------------------------------


def auth_client(email: str = "students-api@example.com") -> APIClient:
    client = APIClient()
    client.force_authenticate(user=User.objects.create_user(email=email))
    return client


def create_via_api(client: APIClient, **overrides: object) -> dict[str, Any]:
    payload: dict[str, object] = {
        "wksa_id": "206-2-508",
        "first_name": "Api",
        "last_name": "Student",
        "date_of_birth": "2010-06-15",
        "current_rank": white_rank().id,
    }
    payload.update(overrides)
    response = client.post("/api/students/", payload, format="json")
    assert response.status_code == 201, response.json()
    body: dict[str, Any] = response.json()
    return body


def test_anonymous_cannot_read_or_write_students() -> None:
    client = APIClient()

    assert client.get("/api/students/").status_code == 403
    assert (
        client.post(
            "/api/students/",
            {"wksa_id": "X"},
            format="json",
        ).status_code
        == 403
    )


def test_list_excludes_date_of_birth_but_detail_includes_it() -> None:
    client = auth_client("list-vs-detail@example.com")
    created = create_via_api(client, wksa_id="206-2-509")

    listing = client.get("/api/students/").json()
    detail = client.get(f"/api/students/{created['id']}/").json()

    assert "date_of_birth" not in listing["results"][0]
    assert detail["date_of_birth"] == "2010-06-15"


def test_create_records_a_student_created_event() -> None:
    client = auth_client("create-audit@example.com")
    before = AuditEvent.objects.filter(action=AuditAction.STUDENT_CREATED).count()

    create_via_api(client, wksa_id="206-2-510")

    assert (
        AuditEvent.objects.filter(action=AuditAction.STUDENT_CREATED).count()
        == before + 1
    )


def test_duplicate_wksa_id_is_a_field_error_not_a_server_error() -> None:
    client = auth_client("duplicate-wksa@example.com")
    create_via_api(client, wksa_id="206-2-511")

    response = client.post(
        "/api/students/",
        {
            "wksa_id": "206-2-511",
            "first_name": "Second",
            "last_name": "Student",
            "date_of_birth": "2011-01-01",
            "current_rank": white_rank().id,
        },
        format="json",
    )

    assert response.status_code == 400
    assert "wksa_id" in response.json()["error"]["fields"]


def test_a_no_op_patch_writes_nothing() -> None:
    client = auth_client("no-op-patch@example.com")
    created = create_via_api(client, wksa_id="206-2-513")
    before = AuditEvent.objects.count()
    written_at = Student.objects.get(pk=created["id"]).updated_at

    response = client.patch(
        f"/api/students/{created['id']}/",
        {"first_name": created["first_name"]},
        format="json",
    )

    assert response.status_code == 200
    assert AuditEvent.objects.count() == before
    # Not just no event: no row update either.
    assert Student.objects.get(pk=created["id"]).updated_at == written_at


def test_a_status_change_alongside_other_edits_writes_exactly_one_event() -> None:
    # Not one generic STUDENT_UPDATED plus a separate STUDENT_STATUS_CHANGED
    # for what is a single PATCH - that would be recording the same edit twice.
    client = auth_client("combined-edit@example.com")
    created = create_via_api(client, wksa_id="206-2-514")
    before = AuditEvent.objects.count()

    response = client.patch(
        f"/api/students/{created['id']}/",
        {"status": Student.Status.INACTIVE, "last_name": "NewLastName"},
        format="json",
    )

    assert response.status_code == 200
    new_events = AuditEvent.objects.filter(
        entity_type="Student",
        entity_id=str(created["id"]),
    ).exclude(action=AuditAction.STUDENT_CREATED)
    assert new_events.count() == 1
    event = new_events.get()
    assert event.action == AuditAction.STUDENT_STATUS_CHANGED
    assert event.metadata["after"]["last_name"] == "NewLastName"
    assert event.metadata["after"]["status"] == Student.Status.INACTIVE
    assert AuditEvent.objects.count() == before + 1


def test_a_plain_field_edit_records_student_updated_not_status_changed() -> None:
    client = auth_client("plain-edit@example.com")
    created = create_via_api(client, wksa_id="206-2-515")

    client.patch(
        f"/api/students/{created['id']}/",
        {"last_name": "Different"},
        format="json",
    )

    event = AuditEvent.objects.filter(
        entity_type="Student",
        entity_id=str(created["id"]),
    ).latest("pk")
    assert event.action == AuditAction.STUDENT_UPDATED


def test_put_is_not_allowed() -> None:
    client = auth_client("no-put@example.com")
    created = create_via_api(client, wksa_id="206-2-516")

    put_response = client.put(
        f"/api/students/{created['id']}/",
        {"first_name": "X"},
        format="json",
    )

    assert put_response.status_code == 405
    assert put_response.json()["error"]["code"] == "method_not_allowed"
    assert Student.objects.filter(pk=created["id"]).exists()


def test_delete_requires_the_students_delete_permission() -> None:
    client = auth_client("no-delete-permission@example.com")
    created = create_via_api(client, wksa_id="206-2-517")

    delete_response = client.delete(f"/api/students/{created['id']}/")

    assert delete_response.status_code == 403
    assert Student.objects.filter(pk=created["id"]).exists()


def test_status_filter_and_search_and_rank_filter_work() -> None:
    client = auth_client("filters@example.com")
    yellow_stripe = Rank.objects.get(code="YELLOW_STRIPE")
    create_via_api(client, wksa_id="206-2-518", first_name="Alex", last_name="Kim")
    left_student = create_via_api(
        client,
        wksa_id="206-2-519",
        first_name="Blair",
        last_name="Diaz",
        current_rank=yellow_stripe.id,
    )
    client.patch(
        f"/api/students/{left_student['id']}/",
        {"status": Student.Status.LEFT},
        format="json",
    )

    by_status = client.get(f"/api/students/?status={Student.Status.LEFT}").json()
    by_rank = client.get(
        f"/api/students/?current_rank_code={yellow_stripe.code}",
    ).json()
    by_search = client.get("/api/students/?search=kim").json()
    unknown_status = client.get("/api/students/?status=NONSENSE").json()

    assert {r["wksa_id"] for r in by_status["results"]} == {"206-2-519"}
    assert {r["wksa_id"] for r in by_rank["results"]} == {"206-2-519"}
    assert {r["wksa_id"] for r in by_search["results"]} == {"206-2-518"}
    assert unknown_status["count"] == 0


def test_can_be_graded_reflects_status_in_the_student_list() -> None:
    # The cohort builder reads eligibility from the list, so the rule is
    # stated once, on the model, rather than re-derived from status in React.
    client = auth_client("can-be-graded@example.com")
    created = create_via_api(client, wksa_id="206-2-520")

    def listed() -> bool:
        body = client.get("/api/students/?search=206-2-520").json()
        return bool(body["results"][0]["can_be_graded"])

    assert listed() is True
    client.patch(
        f"/api/students/{created['id']}/",
        {"status": Student.Status.LEFT},
        format="json",
    )
    assert listed() is False


def test_only_students_view_student_can_read() -> None:
    from django.contrib.auth.models import Permission

    reader = User.objects.create_user(email="perm-reader@example.com")
    reader.user_permissions.clear()
    client = APIClient()
    client.force_authenticate(user=reader)

    # An instructor without students.view_student (removed explicitly here,
    # rather than assuming group membership) must be refused.
    reader.groups.clear()
    assert client.get("/api/students/").status_code == 403

    reader.user_permissions.add(
        Permission.objects.get(
            codename="view_student",
            content_type__app_label="students",
        ),
    )
    # force_authenticate reuses the same in-memory user object across
    # requests, and Django caches computed permissions on that object once
    # checked. Re-fetching and re-authenticating is what makes the newly
    # granted permission actually visible, exactly as in
    # accounts/tests.py::test_me_capabilities_are_computed_from_permissions.
    reader = User.objects.get(pk=reader.pk)
    client.force_authenticate(user=reader)
    assert client.get("/api/students/").status_code == 200
    assert client.post("/api/students/", {}, format="json").status_code == 403


# ---------------------------------------------------------------------------
# Admin routes through the same services the API uses
# ---------------------------------------------------------------------------


def admin_request(email: str) -> Any:
    request = RequestFactory().post("/admin/")
    request.user = User.objects.create_user(email=email)
    return request


def test_admin_created_student_is_persisted_and_audited() -> None:
    obj = Student(**student_kwargs(wksa_id="206-2-521"))
    model_admin = StudentAdmin(Student, admin.site)
    request = admin_request("admin-student-creator@example.com")
    before = AuditEvent.objects.filter(action=AuditAction.STUDENT_CREATED).count()

    model_admin.save_model(
        request,
        obj,
        cast(ModelForm, SimpleNamespace(changed_data=[])),
        False,
    )

    assert obj.pk is not None
    assert Student.objects.filter(pk=obj.pk).exists()
    after = AuditEvent.objects.filter(action=AuditAction.STUDENT_CREATED).count()
    assert after == before + 1
    event = AuditEvent.objects.filter(
        action=AuditAction.STUDENT_CREATED,
        entity_id=str(obj.pk),
    ).latest("occurred_at")
    assert event.actor == request.user


def test_admin_student_update_is_audited() -> None:
    learner = Student.objects.create(**student_kwargs(wksa_id="206-2-522"))
    model_admin = StudentAdmin(Student, admin.site)
    learner.first_name = "Changed"
    request = admin_request("admin-student-updater@example.com")
    before = AuditEvent.objects.filter(action=AuditAction.STUDENT_UPDATED).count()

    model_admin.save_model(
        request,
        learner,
        cast(ModelForm, SimpleNamespace(changed_data=["first_name"])),
        True,
    )

    learner.refresh_from_db()
    assert learner.first_name == "Changed"
    after = AuditEvent.objects.filter(action=AuditAction.STUDENT_UPDATED).count()
    assert after == before + 1


def test_admin_can_correct_any_id() -> None:
    # Either form can be corrected if mistyped; the rules are Student.clean()'s.
    black_belt = Student.objects.create(**student_kwargs(wksa_id="A-20819"))
    model_admin = StudentAdmin(Student, admin.site)

    assert "wksa_id" not in model_admin.get_readonly_fields(
        admin_request("admin-wksa-guard@example.com"),
        black_belt,
    )


# ---------------------------------------------------------------------------
# Roster filters the cohort builder relies on.
# ---------------------------------------------------------------------------


def roster_names(client: APIClient, query: str) -> list[str]:
    response = client.get(f"/api/students/?{query}&page_size=200")
    assert response.status_code == 200
    return [row["wksa_id"] for row in response.json()["results"]]


def test_students_filter_by_several_statuses_a_rank_and_a_search_term() -> None:
    yellow = Rank.objects.get(code="YELLOW")
    kept = Student.objects.create(
        **student_kwargs(wksa_id="206-2-524", first_name="Mina")
    )
    Student.objects.create(**student_kwargs(wksa_id="206-2-525", status="INACTIVE"))
    Student.objects.create(**student_kwargs(wksa_id="206-2-526", status="LEFT"))
    Student.objects.create(**student_kwargs(wksa_id="206-2-527", current_rank=yellow))
    client = auth_client("roster-filters@example.com")

    assert sorted(roster_names(client, "status=ACTIVE,INACTIVE")) == [
        "206-2-524",
        "206-2-525",
        "206-2-527",
    ]
    assert roster_names(client, "status=LEFT") == ["206-2-526"]
    assert roster_names(client, "status=ACTIVE,NOPE") == []
    assert sorted(roster_names(client, f"current_rank={yellow.pk}")) == ["206-2-527"]
    assert roster_names(client, "current_rank=abc") == []
    assert roster_names(client, "search=mina") == [kept.wksa_id]


def test_students_filter_by_age_band_agrees_with_the_age_band_they_are_served() -> None:
    today = timezone.localdate()
    born = {
        "AGE_8_AND_UNDER": today - timedelta(days=365 * 5),
        "AGE_9_TO_12": today - timedelta(days=365 * 11),
        "AGE_13_TO_17": today - timedelta(days=365 * 15),
        "AGE_18_AND_OVER": today - timedelta(days=365 * 40),
    }
    for index, dob in enumerate(born.values()):
        Student.objects.create(
            **student_kwargs(wksa_id=f"206-2-{610 + index:03d}", date_of_birth=dob),
        )
    nine_today = date(today.year - 9, today.month, min(today.day, 28))
    Student.objects.create(
        **student_kwargs(wksa_id="206-2-528", date_of_birth=nine_today)
    )
    client = auth_client("roster-age-band@example.com")
    served = {
        row["wksa_id"]: row["age_band"]
        for row in client.get("/api/students/?page_size=200").json()["results"]
    }

    for band in born:
        expected = sorted(
            wksa for wksa, served_band in served.items() if served_band == band
        )
        assert expected
        assert sorted(roster_names(client, f"age_band={band}")) == expected
    assert roster_names(client, "age_band=NOPE") == []


def test_age_band_filter_keeps_the_leap_day_rule_of_calculate_age_on() -> None:
    from gradings.age import calculate_age_on, with_age_band_on

    Student.objects.create(
        **student_kwargs(wksa_id="206-2-529", date_of_birth=date(2016, 2, 29))
    )

    for on_date, band in (
        (date(2025, 2, 28), "AGE_8_AND_UNDER"),
        (date(2025, 3, 1), "AGE_9_TO_12"),
    ):
        assert calculate_age_on(date(2016, 2, 29), on_date) == (
            8 if on_date.month == 2 else 9
        )
        banded = with_age_band_on(Student.objects.all(), on_date)
        # Keyword by dict: the stubs cannot see an annotation added in a helper.
        assert banded.filter(**{"age_band_on_date": band}).count() == 1
        assert banded.count() == 1


def test_a_session_list_bands_students_by_age_on_its_grading_date() -> None:
    # Registration bands a student by their age on the grading date; the
    # cohort builder's list must agree, or a birthday in between shows the
    # wrong band and filters the student out (audit F-33).
    from gradings.testing import grading_session

    today = timezone.localdate()
    session = grading_session(status="OPEN", grading_date=today + timedelta(days=30))
    # Turns 13 ten days from now: 12 today, 13 on the grading date.
    birthday = today + timedelta(days=10)
    born = date(birthday.year - 13, birthday.month, min(birthday.day, 28))
    Student.objects.create(**student_kwargs(wksa_id="206-2-530", date_of_birth=born))
    client = auth_client("grading-date-band@example.com")

    def served(query: str) -> str:
        response = client.get(f"/api/students/?{query}")
        assert response.status_code == 200
        row = response.json()["results"][0]
        assert row["age_band_display"]
        return str(row["age_band"])

    assert served("search=206-2-530") == "AGE_9_TO_12"
    assert served(f"eligible_for_session={session.pk}") == "AGE_13_TO_17"
    assert roster_names(
        client, f"eligible_for_session={session.pk}&age_band=AGE_13_TO_17"
    ) == ["206-2-530"]
    assert (
        roster_names(client, f"eligible_for_session={session.pk}&age_band=AGE_9_TO_12")
        == []
    )


def test_student_list_shows_each_students_current_grading_and_its_stage() -> None:
    # Replaces the old "Next action" guess with the registration the student
    # actually has, worked out from its assessment and outcome (audit F-29).
    from gradings.models import CandidateOutcome, GradingCandidate, GradingSession
    from gradings.outcome_services import (
        create_candidate_outcome,
        promote_candidate,
        propose_candidate_outcome,
    )
    from gradings.services import transition_grading_session
    from gradings.testing import (
        assessment,
        candidate,
        complete_assessment,
        finalised_outcome,
        grading_session,
        locked_completed_candidate,
        promoter,
        start_assessment,
        user,
    )

    # Each student is given an ID, and the rows read back by a name for it.
    names: dict[str, str] = {}

    def named(built: GradingCandidate, name: str) -> GradingCandidate:
        wksa_id = f"206-2-{600 + len(names):03d}"
        names[wksa_id] = name
        Student.objects.filter(pk=built.student_id).update(wksa_id=wksa_id)
        return built

    session = grading_session(status=GradingSession.Status.OPEN, title="Spring")
    named(candidate(session=session), "REGISTERED")
    named(
        start_assessment(assessment(candidate=candidate(session=session))).candidate,
        "BEING",
    )
    named(
        complete_assessment(assessment(candidate=candidate(session=session))).candidate,
        "ASSESSED",
    )

    proposed, _ = locked_completed_candidate()
    named(proposed, "DECIDING")
    propose_candidate_outcome(
        create_candidate_outcome(proposed, user("stage-creator@example.com")),
        CandidateOutcome.Outcome.PASS,
        "Ready.",
        user("stage-proposer@example.com"),
    )
    passed, _ = locked_completed_candidate()
    named(passed, "PASSED")
    finalised_outcome(passed)

    # Settled registrations show nothing: promoted, failed, withdrawn,
    # cancelled - and a student never registered.
    promoted, _ = locked_completed_candidate()
    named(promoted, "PROMOTED")
    promote_candidate(
        finalised_outcome(promoted), promoter("stage-promoter@example.com")
    )
    failed, _ = locked_completed_candidate()
    named(failed, "FAILED")
    finalised_outcome(
        failed,
        proposed=CandidateOutcome.Outcome.FAIL,
        final=CandidateOutcome.Outcome.FAIL,
    )
    named(
        candidate(session=session, status=GradingCandidate.Status.WITHDRAWN),
        "206-2-537",
    )
    cancelled = grading_session(status=GradingSession.Status.OPEN, title="Cancelled")
    named(candidate(session=cancelled), "CANCELLED")
    transition_grading_session(
        cancelled,
        GradingSession.Status.CANCELLED,
        actor=user("stage-canceller@example.com"),
    )
    Student.objects.create(**student_kwargs(wksa_id="206-2-531"))

    response = auth_client("current-grading@example.com").get(
        "/api/students/?page_size=200",
    )

    assert response.status_code == 200
    by_id = {
        names.get(row["wksa_id"], row["wksa_id"]): row["current_grading"]
        for row in response.json()["results"]
    }
    assert by_id["REGISTERED"] == {
        "session": session.pk,
        "session_title": "Spring",
        "stage": "REGISTERED",
        "stage_display": "Registered",
    }
    assert by_id["BEING"]["stage"] == "BEING_ASSESSED"
    assert by_id["ASSESSED"]["stage"] == "ASSESSED"
    assert by_id["DECIDING"]["stage"] == "AWAITING_DECISION"
    assert by_id["PASSED"]["stage"] == "AWAITING_PROMOTION"
    for settled in ("PROMOTED", "FAILED", "206-2-537", "CANCELLED", "206-2-531"):
        assert by_id[settled] is None, settled


def test_eligible_for_session_leaves_out_left_and_already_registered_students() -> None:
    from gradings.testing import candidate, grading_session

    session = grading_session(status="OPEN")
    other_session = grading_session(title="Another", status="OPEN")
    Student.objects.create(**student_kwargs(wksa_id="206-2-532"))
    Student.objects.create(**student_kwargs(wksa_id="206-2-533", status="INACTIVE"))
    Student.objects.create(**student_kwargs(wksa_id="206-2-534", status="LEFT"))
    registered = Student.objects.create(**student_kwargs(wksa_id="206-2-535"))
    elsewhere = Student.objects.create(**student_kwargs(wksa_id="206-2-536"))
    withdrew = Student.objects.create(**student_kwargs(wksa_id="206-2-537"))
    candidate(session=session, student=registered)
    # One grading at a time: an unsettled registration elsewhere excludes the
    # student; a withdrawn one does not.
    candidate(session=other_session, student=elsewhere)
    candidate(session=other_session, student=withdrew, status="WITHDRAWN")
    client = auth_client("roster-eligible@example.com")

    mine = {
        "206-2-532",
        "206-2-533",
        "206-2-534",
        "206-2-535",
        "206-2-536",
        "206-2-537",
    }
    eligible = set(roster_names(client, f"eligible_for_session={session.pk}"))
    assert eligible & mine == {"206-2-532", "206-2-533", "206-2-537"}
    assert roster_names(client, "eligible_for_session=abc") == []
