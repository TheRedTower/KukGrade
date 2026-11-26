"""The served choice lists: every value a control offers, with its name."""

from __future__ import annotations

from typing import Any

import pytest
from django.db import models
from rest_framework.test import APIClient

from accounts.models import User
from accounts.permissions import AUTHORITY_PERMISSIONS
from data_imports.models import ImportBatch, ImportRowOutcome
from gradings.models import (
    CandidateAssessmentStatus,
    GradingCandidateStatus,
    GradingSessionStatus,
    ItemResult,
)
from students.models import STUDENT_STATUS_MEANINGS, StudentStatus

pytestmark = pytest.mark.django_db


def _served() -> dict[str, list[dict[str, Any]]]:
    client = APIClient()
    client.force_authenticate(
        user=User.objects.create_user(email="choices@example.com")
    )
    response = client.get("/api/choices/")
    assert response.status_code == 200
    body: dict[str, list[dict[str, Any]]] = response.json()
    return body


def _pairs(choices: type[models.TextChoices]) -> list[tuple[str, str]]:
    return [(str(value), str(label)) for value, label in choices.choices]


def _as_pairs(served: list[dict[str, Any]]) -> list[tuple[str, str]]:
    return [(choice["value"], choice["label"]) for choice in served]


def test_choices_need_a_signed_in_user() -> None:
    assert APIClient().get("/api/choices/").status_code in {401, 403}


def test_each_list_is_the_models_own_choices() -> None:
    served = _served()

    assert _as_pairs(served["session_statuses"]) == _pairs(GradingSessionStatus)
    assert _as_pairs(served["student_statuses"]) == _pairs(StudentStatus)
    assert _as_pairs(served["candidate_statuses"]) == _pairs(GradingCandidateStatus)
    assert _as_pairs(served["assessment_statuses"]) == _pairs(CandidateAssessmentStatus)
    assert _as_pairs(served["item_results"]) == _pairs(ItemResult)
    assert _as_pairs(served["import_kinds"]) == _pairs(ImportBatch.Kind)
    assert _as_pairs(served["import_row_outcomes"]) == _pairs(ImportRowOutcome)
    assert _as_pairs(served["roles"]) == _pairs(User.Role)


def test_the_outcomes_come_in_the_order_the_controls_offer_them() -> None:
    assert [choice["value"] for choice in _served()["outcomes"]] == [
        "PASS",
        "CONDITIONAL",
        "FAIL",
    ]


def test_the_finished_import_states_leave_out_the_open_one() -> None:
    values = [choice["value"] for choice in _served()["finished_import_statuses"]]

    assert values == ["COMMITTED", "CANCELLED", "EXPIRED"]


def test_the_withdrawal_reasons_say_which_needs_a_note() -> None:
    assert _served()["withdrawal_reasons"] == [
        {"value": "INJURY", "label": "Injured during grading", "note_required": False},
        {"value": "WITHDREW", "label": "Withdrew voluntarily", "note_required": False},
        {"value": "ABSENT", "label": "Did not attend", "note_required": False},
        {"value": "OTHER", "label": "Other", "note_required": True},
    ]


def test_the_not_a_student_reasons_say_which_needs_a_note() -> None:
    assert _served()["not_a_student_reasons"] == [
        {"value": "INSTRUCTOR", "label": "An instructor", "note_required": False},
        {"value": "LEFT", "label": "Left before KukGrade", "note_required": False},
        {"value": "NOT_REAL", "label": "Not a real entry", "note_required": False},
        {"value": "OTHER", "label": "Other", "note_required": True},
    ]


def test_every_authority_is_named_and_described_once() -> None:
    authorities = _served()["authorities"]

    assert [choice["value"] for choice in authorities] == list(AUTHORITY_PERMISSIONS)
    assert all(choice["label"] and choice["description"] for choice in authorities)


def test_each_student_status_says_what_it_means() -> None:
    served = _served()["student_statuses"]

    assert {choice["value"]: choice["description"] for choice in served} == {
        str(status): meaning for status, meaning in STUDENT_STATUS_MEANINGS.items()
    }


def test_the_served_rank_rule_is_the_one_the_services_apply() -> None:
    from django.core.exceptions import ValidationError

    from accounts.services import create_platform_user

    for index, role in enumerate(_served()["roles"]):
        try:
            create_platform_user(
                email=f"rankless-{index}@example.com",
                first_name="Robin",
                last_name="Rankless",
                role=role["value"],
                rank=None,
            )
        except ValidationError as refused:
            assert "rank" in refused.message_dict
            refused_without_rank = True
        else:
            refused_without_rank = False
        assert refused_without_rank is role["rank_required"], role["value"]


def test_the_served_authority_roles_are_the_ones_the_services_allow() -> None:
    from django.core.exceptions import ValidationError

    from accounts.services import set_user_authority
    from ranks.models import Rank

    actor = User.objects.create_user(
        email="grants@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    rank = Rank.objects.staff().first()
    for authority in _served()["authorities"]:
        for role in User.Role.values:
            target = User.objects.create_user(
                email=f"{authority['value']}-{role}@example.com",
                role=role,
                rank=rank if User.role_holds_rank(role) else None,
            )
            try:
                set_user_authority(target, actor, **{authority["value"]: True})
            except ValidationError:
                granted = False
            else:
                granted = True
            assert granted is (role in authority["grantable_to"]), (
                authority["value"],
                role,
            )


def test_every_authority_is_held_to_its_served_roles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Not only final decisions: whatever the table says, the grant, the role
    change and the screens follow it."""
    from django.core.exceptions import ValidationError

    from accounts import permissions
    from accounts.services import set_user_authority, update_platform_user
    from ranks.models import Rank

    monkeypatch.setitem(
        permissions.AUTHORITY_ROLES,
        "can_override_locked_session",
        frozenset({User.Role.INSTRUCTOR}),
    )
    served = {a["value"]: a for a in _served()["authorities"]}
    assert served["can_override_locked_session"]["grantable_to"] == ["instructor"]

    actor = User.objects.create_user(
        email="table-actor@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    administrator = User.objects.create_user(
        email="table-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    with pytest.raises(ValidationError) as granting:
        set_user_authority(administrator, actor, can_override_locked_session=True)
    assert "can_override_locked_session" in granting.value.message_dict

    instructor = User.objects.create_user(
        email="table-instructor@example.com",
        rank=Rank.objects.staff().first(),
    )
    set_user_authority(instructor, actor, can_override_locked_session=True)
    with pytest.raises(ValidationError) as changing:
        update_platform_user(instructor, role=User.Role.ADMINISTRATOR, actor=actor)
    assert changing.value.message_dict["role"] == [
        "This user holds the authority to override locked sessions, so cannot "
        "take the Administrator role. Revoke that authority first.",
    ]
