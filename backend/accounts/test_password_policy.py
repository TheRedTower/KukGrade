"""The one password policy, on every path that sets a password (slice 2)."""

from __future__ import annotations

from typing import Any

import pytest
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from accounts.models import User

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
    # 16 characters, one of them four bytes in UTF-8 and two UTF-16 units in
    # a browser: the browser's checklist counts code points to agree.
    password = "Kukgrade-Strng9" + "\N{GRINNING FACE}"

    assert len(password) == 16
    assert messages(password) == []


def test_a_password_like_the_users_own_details_is_refused() -> None:
    user = User(email="riley.khanington@example.com", first_name="Rileyy")

    assert messages("Riley.Khanington9", user) == [
        "The password is too similar to the email."
    ]


def _target() -> User:
    return User.objects.create_user(
        email="policy-target@example.com",
        password="Original-Password-9",
    )


def _change_own(password: str) -> Any:
    client = APIClient()
    client.force_authenticate(user=_target())
    return client.post(
        "/api/auth/change-password/",
        {"current_password": "Original-Password-9", "new_password": password},
        format="json",
    )


# Changing your own password is the one API path that takes a typed password:
# every other is generated (test_temporary_passwords.py), and checked against
# the same policy before it is issued.
@pytest.mark.parametrize(
    ("password", "message"),
    [
        (TOO_SHORT, "Use at least 16 characters."),
        (TOO_LONG, "Use no more than 64 characters."),
        ("kukgrade-strong-9", "Include an uppercase letter."),
    ],
)
def test_changing_your_own_password_enforces_the_policy(
    password: str,
    message: str,
) -> None:
    response = _change_own(password)

    assert response.status_code == 400
    assert message in response.json()["error"]["fields"]["new_password"]


def test_changing_your_own_password_accepts_a_strong_one() -> None:
    assert _change_own(STRONG).status_code == 204


def test_a_password_is_kept_exactly_as_typed_spaces_and_all() -> None:
    # Sign-in never trims, so neither may changing it: a passphrase ending in
    # a space, saved trimmed, would never sign in again as typed.
    padded = " Kukgrade strong 9 "
    client = APIClient()
    client.force_authenticate(user=_target())

    response = client.post(
        "/api/auth/change-password/",
        {"current_password": "Original-Password-9", "new_password": padded},
        format="json",
    )

    assert response.status_code == 204
    signed_in = APIClient().post(
        "/api/auth/login/",
        {"email": "policy-target@example.com", "password": padded},
        format="json",
    )
    assert signed_in.status_code == 200


def test_a_current_password_with_spaces_is_checked_as_typed() -> None:
    user = User.objects.create_user(
        email="policy-padded@example.com",
        password=" Padded-Current-9 ",
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.post(
        "/api/auth/change-password/",
        {"current_password": " Padded-Current-9 ", "new_password": STRONG},
        format="json",
    )

    assert response.status_code == 204
