from __future__ import annotations

from datetime import timedelta

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.db.models.deletion import ProtectedError
from django.utils import timezone

from ranks.models import Rank
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


@pytest.mark.django_db(transaction=True)
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
