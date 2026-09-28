from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from typing import Any, cast

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
        "wksa_id": "000123",
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
    assert student.wksa_id == "000123"
    assert student.first_name == "Alex"
    assert student.last_name == "Kim"
    assert student.current_rank == white_rank()
    assert student.status == Student.Status.ACTIVE
    assert student.created_at is not None
    assert student.updated_at is not None
    assert str(student) == "Alex Kim (000123)"


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
    Student.objects.create(**student_kwargs(wksa_id="000045"))

    student = Student.objects.get(wksa_id="000045")

    assert student.wksa_id == "000045"


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
            wksa_id="MIG001",
            first_name="Migration",
            last_name="Student",
            date_of_birth=timezone.localdate().replace(year=2010),
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

        student = NewStudent.objects.get(wksa_id="MIG001")

        assert student.current_rank.code == "WHITE"
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)


def test_student_status_defaults_to_active() -> None:
    assert (
        Student.objects.create(**student_kwargs(wksa_id="ST-005")).status
        == Student.Status.ACTIVE
    )


def test_inactive_students_can_still_be_graded() -> None:
    # A break - injury, exams, travel - blocks nothing.
    learner = Student.objects.create(**student_kwargs(wksa_id="ST-006"))
    learner.status = Student.Status.INACTIVE
    learner.save()

    assert learner.can_be_graded is True


def test_a_student_who_has_left_cannot_be_graded() -> None:
    learner = Student.objects.create(**student_kwargs(wksa_id="ST-007"))
    learner.status = Student.Status.LEFT
    learner.save()

    assert learner.can_be_graded is False


def test_leaving_is_reversible_and_keeps_history() -> None:
    learner = Student.objects.create(**student_kwargs(wksa_id="ST-008"))
    original_rank = learner.current_rank

    learner.status = Student.Status.LEFT
    learner.save()
    learner.status = Student.Status.ACTIVE
    learner.save()

    learner.refresh_from_db()
    assert learner.can_be_graded is True
    assert learner.current_rank == original_rank


def test_invalid_student_status_is_rejected_by_the_database() -> None:
    learner = Student.objects.create(**student_kwargs(wksa_id="ST-009"))

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
        "wksa_id": "API-001",
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
    created = create_via_api(client, wksa_id="LIST-001")

    listing = client.get("/api/students/").json()
    detail = client.get(f"/api/students/{created['id']}/").json()

    assert "date_of_birth" not in listing["results"][0]
    assert detail["date_of_birth"] == "2010-06-15"


def test_create_records_a_student_created_event() -> None:
    client = auth_client("create-audit@example.com")
    before = AuditEvent.objects.filter(action=AuditAction.STUDENT_CREATED).count()

    create_via_api(client, wksa_id="AUDIT-CREATE")

    assert (
        AuditEvent.objects.filter(action=AuditAction.STUDENT_CREATED).count()
        == before + 1
    )


def test_duplicate_wksa_id_is_a_field_error_not_a_server_error() -> None:
    client = auth_client("duplicate-wksa@example.com")
    create_via_api(client, wksa_id="DUP-001")

    response = client.post(
        "/api/students/",
        {
            "wksa_id": "DUP-001",
            "first_name": "Second",
            "last_name": "Student",
            "date_of_birth": "2011-01-01",
            "current_rank": white_rank().id,
        },
        format="json",
    )

    assert response.status_code == 400
    assert "wksa_id" in response.json()["error"]["fields"]


def test_wksa_id_cannot_be_changed_after_creation() -> None:
    client = auth_client("immutable-wksa@example.com")
    created = create_via_api(client, wksa_id="IMMUTABLE-001")

    response = client.patch(
        f"/api/students/{created['id']}/",
        {"wksa_id": "HACKED", "first_name": "Changed"},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["wksa_id"] == "IMMUTABLE-001"
    assert response.json()["first_name"] == "Changed"
    student = Student.objects.get(pk=created["id"])
    assert student.wksa_id == "IMMUTABLE-001"


def test_a_no_op_patch_writes_no_audit_event() -> None:
    client = auth_client("no-op-patch@example.com")
    created = create_via_api(client, wksa_id="NOOP-001")
    before = AuditEvent.objects.count()

    response = client.patch(
        f"/api/students/{created['id']}/",
        {"first_name": created["first_name"]},
        format="json",
    )

    assert response.status_code == 200
    assert AuditEvent.objects.count() == before


def test_a_status_change_alongside_other_edits_writes_exactly_one_event() -> None:
    # Not one generic STUDENT_UPDATED plus a separate STUDENT_STATUS_CHANGED
    # for what is a single PATCH - that would be recording the same edit twice.
    client = auth_client("combined-edit@example.com")
    created = create_via_api(client, wksa_id="COMBINED-001")
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
    created = create_via_api(client, wksa_id="PLAIN-001")

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
    created = create_via_api(client, wksa_id="NOMETHOD-001")

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
    created = create_via_api(client, wksa_id="NODELETE-001")

    delete_response = client.delete(f"/api/students/{created['id']}/")

    assert delete_response.status_code == 403
    assert Student.objects.filter(pk=created["id"]).exists()


def test_status_filter_and_search_and_rank_filter_work() -> None:
    client = auth_client("filters@example.com")
    yellow_stripe = Rank.objects.get(code="YELLOW_STRIPE")
    create_via_api(client, wksa_id="FILTER-A", first_name="Alex", last_name="Kim")
    left_student = create_via_api(
        client,
        wksa_id="FILTER-B",
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

    assert {r["wksa_id"] for r in by_status["results"]} == {"FILTER-B"}
    assert {r["wksa_id"] for r in by_rank["results"]} == {"FILTER-B"}
    assert {r["wksa_id"] for r in by_search["results"]} == {"FILTER-A"}
    assert unknown_status["count"] == 0


def test_can_be_graded_reflects_status_in_the_student_list() -> None:
    # The cohort builder reads eligibility from the list, so the rule is
    # stated once, on the model, rather than re-derived from status in React.
    client = auth_client("can-be-graded@example.com")
    created = create_via_api(client, wksa_id="GRADABLE-001")

    def listed() -> bool:
        body = client.get("/api/students/?search=GRADABLE-001").json()
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
# Admin routes through the same services the API uses (KG-036)
# ---------------------------------------------------------------------------


def admin_request(email: str) -> Any:
    request = RequestFactory().post("/admin/")
    request.user = User.objects.create_user(email=email)
    return request


def test_admin_created_student_is_persisted_and_audited() -> None:
    obj = Student(**student_kwargs(wksa_id="ADMIN-CREATE-01"))
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
    learner = Student.objects.create(**student_kwargs(wksa_id="ADMIN-UPDATE-01"))
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


def test_admin_cannot_change_wksa_id_after_creation() -> None:

    learner = Student.objects.create(**student_kwargs(wksa_id="ADMIN-WKSA-LOCK"))
    model_admin = StudentAdmin(Student, admin.site)

    assert "wksa_id" in model_admin.get_readonly_fields(
        admin_request("admin-wksa-guard@example.com"),
        learner,
    )
    assert (
        model_admin.get_readonly_fields(
            admin_request("admin-wksa-guard-add@example.com"),
            None,
        )
        == ()
    )
