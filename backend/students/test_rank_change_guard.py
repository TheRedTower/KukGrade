"""A rank cannot be edited while the student has a grading still to reach its result."""

from __future__ import annotations

import pytest
from django.core.exceptions import ValidationError

from gradings.models import GradingCandidate
from gradings.testing import auth_client, candidate, rank, student
from students.services import update_student

pytestmark = pytest.mark.django_db


def test_a_rank_change_is_refused_while_a_registration_is_unsettled() -> None:
    built = candidate()
    before = built.student.current_rank_id

    with pytest.raises(ValidationError) as exc_info:
        update_student(built.student, current_rank=rank("YELLOW"))

    assert "Withdraw them from it first" in str(exc_info.value)
    built.student.refresh_from_db()
    assert built.student.current_rank_id == before


def test_a_rank_change_is_allowed_with_no_registration() -> None:
    person = student()

    updated = update_student(person, current_rank=rank("YELLOW"))

    assert updated.current_rank == rank("YELLOW")


def test_resending_the_same_rank_is_not_a_change() -> None:
    built = candidate()

    update_student(built.student, current_rank=built.student.current_rank)


def test_a_rank_change_is_allowed_once_the_registration_is_withdrawn() -> None:
    built = candidate(status=GradingCandidate.Status.WITHDRAWN)

    updated = update_student(built.student, current_rank=rank("YELLOW"))

    assert updated.current_rank == rank("YELLOW")


def test_the_api_refuses_a_rank_change_while_registered() -> None:
    built = candidate()

    response = auth_client("rank-guard@example.com").patch(
        f"/api/students/{built.student_id}/",
        {"current_rank": rank("YELLOW").pk},
        format="json",
    )

    assert response.status_code == 400
    assert "Withdraw them from it first" in response.json()["error"]["message"]
