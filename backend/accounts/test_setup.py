"""A new deployment's first administrator, from the setup page (2026-10-20)."""

from __future__ import annotations

import logging
from datetime import timedelta
from io import StringIO
from typing import Any
from unittest.mock import patch

import pytest
from django.core.cache import cache as django_cache
from django.core.management import call_command
from django.db import close_old_connections
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from accounts.models import SetupCode, User
from accounts.setup import complete_setup, issue_setup_code
from audit.models import AuditAction, AuditEvent
from kukgrade.testing import interleave

pytestmark = pytest.mark.django_db

CHOSEN = "First-Admin-Pass-2026!"


def details(code: str, **overrides: Any) -> dict[str, Any]:
    return {
        "code": code,
        "email": "Owner@Example.com",
        "first_name": "Ada",
        "last_name": "Owner",
        "password": CHOSEN,
        **overrides,
    }


def submit(client: APIClient, body: dict[str, Any]) -> Any:
    return client.post("/api/setup/", body, format="json")


def test_setup_is_needed_until_an_administrator_exists() -> None:
    client = APIClient()

    assert client.get("/api/setup/").json() == {"setup_needed": True}
    User.objects.create_superuser(email="root@example.com")
    assert client.get("/api/setup/").json() == {"setup_needed": False}


def test_the_code_is_kept_only_as_a_hash_and_a_restart_replaces_it() -> None:
    first = issue_setup_code()
    second = issue_setup_code()

    assert first is not None and second is not None
    assert len(first) == 14 and first.count("-") == 2
    [stored] = SetupCode.objects.all()
    assert first.replace("-", "") not in stored.code_hash
    assert second.replace("-", "") not in stored.code_hash
    assert submit(APIClient(), details(first)).status_code == 400


def test_the_startup_command_writes_the_code_to_the_log_until_set_up() -> None:
    needed = StringIO()
    call_command("issue_setup_code", stdout=needed)
    User.objects.create_superuser(email="root@example.com")
    done = StringIO()
    call_command("issue_setup_code", stdout=done)

    assert "enter this setup code:" in needed.getvalue()
    assert done.getvalue() == ""
    assert not SetupCode.objects.exists()


def test_the_code_creates_the_first_administrator_and_signs_them_in() -> None:
    code = issue_setup_code()
    assert code is not None
    client = APIClient()

    # Typed in lower case, without the hyphens: still the code.
    response = submit(client, details(code.replace("-", "").lower()))

    assert response.status_code == 201, response.json()
    owner = User.objects.get(email="owner@example.com")
    assert owner.is_superuser and owner.is_staff and owner.is_active
    assert owner.role == User.Role.ADMINISTRATOR
    assert owner.check_password(CHOSEN)
    assert owner.must_change_password is False
    assert owner.temporary_password_expires_at is None
    assert client.get("/api/auth/me/").json()["email"] == "owner@example.com"
    assert not SetupCode.objects.exists()
    event = AuditEvent.objects.get(entity_id=str(owner.pk))
    assert event.action == AuditAction.USER_CREATED
    assert event.actor is None
    for secret in (CHOSEN, code, code.replace("-", "")):
        assert secret not in event.summary and secret not in str(event.metadata)


def test_it_works_once() -> None:
    code = issue_setup_code()
    assert code is not None
    assert submit(APIClient(), details(code)).status_code == 201

    again = submit(APIClient(), details(code, email="second@example.com"))

    assert again.status_code == 400
    assert again.json()["error"]["fields"]["code"] == [
        "KukGrade is already set up. Add further accounts from the Users screen.",
    ]
    assert User.objects.filter(is_superuser=True).count() == 1
    assert issue_setup_code() is None


@pytest.mark.parametrize("issued", [True, False], ids=["wrong", "none-issued"])
def test_a_wrong_code_creates_nothing_and_is_logged(
    issued: bool,
    caplog: pytest.LogCaptureFixture,
) -> None:
    if issued:
        issue_setup_code()

    with caplog.at_level(logging.WARNING, logger="kukgrade.security"):
        response = submit(APIClient(), details("AAAA-AAAA-AAAA"))

    assert response.status_code == 400
    assert response.json()["error"]["fields"]["code"] == [
        "That setup code is not right. Use the one in the server's log.",
    ]
    assert not User.objects.filter(email="owner@example.com").exists()
    assert "Failed setup attempt for Owner@Example.com" in caplog.text
    assert CHOSEN not in caplog.text


def test_an_expired_code_is_refused() -> None:
    code = issue_setup_code()
    assert code is not None
    SetupCode.objects.update(expires_at=timezone.now() - timedelta(seconds=1))

    response = submit(APIClient(), details(code))

    assert response.status_code == 400
    assert response.json()["error"]["fields"]["code"] == [
        "That setup code has expired. Restart KukGrade for a new one in its log.",
    ]
    assert not User.objects.filter(is_superuser=True).exists()


@pytest.mark.parametrize(
    ("password", "message"),
    [
        ("short", "Use at least 16 characters."),
        ("owner@example.com-1A", "The password is too similar to the email."),
    ],
)
def test_the_password_policy_holds(password: str, message: str) -> None:
    code = issue_setup_code()
    assert code is not None

    response = submit(APIClient(), details(code, password=password))

    assert response.status_code == 400
    assert message in response.json()["error"]["fields"]["password"]
    assert not User.objects.filter(is_superuser=True).exists()
    # The code is not spent on a refused password.
    assert submit(APIClient(), details(code)).status_code == 201


def test_setup_checks_the_csrf_token() -> None:
    code = issue_setup_code()
    assert code is not None
    client = APIClient(enforce_csrf_checks=True)

    refused = submit(client, details(code))
    client.get("/api/setup/")
    token = client.cookies["csrftoken"].value
    accepted = client.post(
        "/api/setup/",
        details(code),
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )

    assert refused.status_code == 403
    assert accepted.status_code == 201


def test_guessing_the_code_is_rate_limited() -> None:
    issue_setup_code()
    client = APIClient()
    django_cache.clear()
    try:
        with patch.object(ScopedRateThrottle, "THROTTLE_RATES", {"setup": "2/min"}):
            guesses = [submit(client, details("AAAA-AAAA-AAAA")) for _ in range(3)]
            asking = client.get("/api/setup/")
    finally:
        django_cache.clear()

    assert [r.status_code for r in guesses] == [400, 400, 429]
    assert asking.status_code == 200


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_two_submissions_of_one_code_create_one_administrator() -> None:
    code = issue_setup_code()
    assert code is not None

    def attempt(email: str) -> object:
        try:
            return complete_setup(
                code=code,
                email=email,
                password=CHOSEN,
            )
        finally:
            close_old_connections()

    first, second = interleave(
        lambda: attempt("first@example.com"),
        lambda: attempt("second@example.com"),
        pause_first_at="accounts.setup.record",
    )

    assert isinstance(first, User)
    assert isinstance(second, Exception)
    assert list(User.objects.filter(is_superuser=True).values_list("email")) == [
        ("first@example.com",),
    ]
