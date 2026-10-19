"""The one password policy, on every path that sets a password (slice 2)."""

from __future__ import annotations

from typing import Any

import pytest
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.test import Client
from rest_framework.test import APIClient

from accounts.admin import UserCreationForm
from accounts.models import User
from kukgrade.testing import render_admin_pages

pytestmark = pytest.mark.django_db

STRONG = "Kukgrade-Strong-9"  # 17 characters, every class
TOO_SHORT = "Kukgrade-Strng9"  # 15
TOO_LONG = "Kk9!" * 16 + "x"  # 65


def messages(password: str, user: User | None = None) -> list[str]:
    try:
        validate_password(password, user)
    except ValidationError as exc:
        return list(exc.messages)
    return []


@pytest.mark.parametrize(
    ("password", "expected"),
    [
        (STRONG, []),
        ("Kk9!" * 4, []),  # exactly 16
        ("Kk9!" * 16, []),  # exactly 64
        (TOO_SHORT, ["Use at least 16 characters."]),
        (TOO_LONG, ["Use no more than 64 characters."]),
        ("kukgrade-strong-9", ["Include an uppercase letter."]),
        ("KUKGRADE-STRONG-9", ["Include a lowercase letter."]),
        ("Kukgrade-Strong-x", ["Include a number."]),
        ("KukgradeStrong99x", ["Include a special character, such as ! or #."]),
        # A space is a special character: passphrases are allowed.
        ("Kukgrade strong 9", []),
        # Every missing rule is reported at once, not one per attempt.
        (
            "short",
            [
                "Use at least 16 characters.",
                "Include an uppercase letter.",
                "Include a number.",
                "Include a special character, such as ! or #.",
            ],
        ),
        # Passes every character rule, but is on Django's common list.
        ("John!20130605at1753", ["This password is too common."]),
    ],
)
def test_the_policy(password: str, expected: list[str]) -> None:
    assert messages(password) == expected


def test_length_counts_characters_not_bytes() -> None:
    # 16 characters, one of them two bytes in UTF-8 and two UTF-16 units in
    # a browser: the browser's checklist counts code points to agree.
    password = "Kukgrade-Strng9" + "\N{GRINNING FACE}"

    assert len(password) == 16
    assert messages(password) == []


def test_a_password_like_the_users_own_details_is_refused() -> None:
    user = User(email="riley.khanington@example.com", first_name="Rileyy")

    assert messages("Riley.Khanington9", user) == [
        "The password is too similar to the email."
    ]


def _admin_client() -> APIClient:
    admin = User.objects.create_user(
        email="policy-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


def _target() -> User:
    return User.objects.create_user(
        email="policy-target@example.com",
        password="Original-Password-9",
    )


def _create_user(password: str) -> Any:
    return _admin_client().post(
        "/api/users/",
        {
            "email": "policy-new@example.com",
            "password": password,
            "first_name": "New",
            "last_name": "User",
        },
        format="json",
    )


def _reset(password: str) -> Any:
    return _admin_client().post(
        f"/api/users/{_target().pk}/set-password/",
        {"password": password},
        format="json",
    )


def _change_own(password: str) -> Any:
    client = APIClient()
    client.force_authenticate(user=_target())
    return client.post(
        "/api/auth/change-password/",
        {"current_password": "Original-Password-9", "new_password": password},
        format="json",
    )


@pytest.mark.parametrize("send", [_create_user, _reset, _change_own])
@pytest.mark.parametrize(
    ("password", "message"),
    [
        (TOO_SHORT, "Use at least 16 characters."),
        (TOO_LONG, "Use no more than 64 characters."),
        ("kukgrade-strong-9", "Include an uppercase letter."),
    ],
)
def test_every_api_path_enforces_the_same_policy(
    send: Any,
    password: str,
    message: str,
) -> None:
    response = send(password)

    assert response.status_code == 400
    fields = response.json()["error"]["fields"]
    assert message in (fields.get("password") or fields.get("new_password"))


@pytest.mark.parametrize("send", [_create_user, _reset, _change_own])
def test_every_api_path_accepts_a_strong_password(send: Any) -> None:
    assert send(STRONG).status_code in {201, 204}


def test_django_admin_forms_enforce_the_same_policy(settings: Any) -> None:
    form = UserCreationForm(
        data={
            "email": "admin-form-new@example.com",
            "password1": TOO_SHORT,
            "password2": TOO_SHORT,
            "role": User.Role.INSTRUCTOR,
        },
    )
    assert not form.is_valid()
    assert "Use at least 16 characters." in str(form.errors)

    render_admin_pages(settings)
    superuser = User.objects.create_superuser(
        email="policy-superuser@example.com",
        password="Superuser-Pass-2026!",
    )
    target = _target()
    client = Client()
    client.force_login(superuser)
    response = client.post(
        f"/admin/accounts/user/{target.pk}/password/",
        {"password1": TOO_SHORT, "password2": TOO_SHORT},
    )

    assert response.status_code == 200  # the form, re-shown with its error
    assert "Use at least 16 characters." in response.content.decode()
    target.refresh_from_db()
    assert target.check_password("Original-Password-9")
