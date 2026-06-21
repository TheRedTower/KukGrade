from __future__ import annotations

from datetime import timedelta

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from students.models import Student

pytestmark = pytest.mark.django_db


def student_kwargs(**overrides: object) -> dict[str, object]:
    data: dict[str, object] = {
        "wksa_id": "000123",
        "first_name": "Alex",
        "last_name": "Kim",
        "date_of_birth": timezone.localdate().replace(year=2012),
    }
    data.update(overrides)
    return data


def test_valid_student_can_be_created() -> None:
    student = Student.objects.create(**student_kwargs())

    assert student.pk is not None
    assert student.wksa_id == "000123"
    assert student.first_name == "Alex"
    assert student.last_name == "Kim"
    assert student.is_active is True
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
