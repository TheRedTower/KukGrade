"""Generated temporary passwords: issued once, expiring, replaceable (slice 3)."""

from __future__ import annotations

import importlib
import logging
from datetime import timedelta
from typing import Any
from unittest.mock import patch

import pytest
from django.apps import apps as django_apps
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.test import Client
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from accounts.password_policy import (
    MIN_LENGTH,
    TEMPORARY_PASSWORD_ALPHABET,
    generate_temporary_password,
)
from accounts.services import create_platform_user
from audit.models import AuditAction, AuditEvent
from kukgrade.testing import render_admin_pages

pytestmark = pytest.mark.django_db

LOOK_ALIKES = "0Oo1Il|5Ss2Zz8B"


# ---------------------------------------------------------------------------
# The generator
# ---------------------------------------------------------------------------


def test_generated_passwords_pass_the_policy_and_avoid_look_alikes() -> None:
    user = User(email="generator@example.com", first_name="Gen")

    for _ in range(200):
        password = generate_temporary_password(user)

        validate_password(password, user)
        assert len(password) == MIN_LENGTH
        assert set(password) <= set(TEMPORARY_PASSWORD_ALPHABET)
        assert not set(password) & set(LOOK_ALIKES)


def test_a_candidate_django_refuses_is_drawn_again() -> None:
    calls: list[str] = []

    def refuse_first(password: str, user: object = None) -> None:
        calls.append(password)
        if len(calls) == 1:
            raise ValidationError("too similar")

    with patch("accounts.password_policy.validate_password", refuse_first):
        password = generate_temporary_password()

    assert len(calls) == 2
    assert password == calls[1]


def test_the_generator_gives_up_rather_than_issue_a_failing_password() -> None:
    with (
        patch(
            "accounts.password_policy.validate_password",
            side_effect=ValidationError("no"),
        ),
        pytest.raises(RuntimeError),
    ):
        generate_temporary_password()


# ---------------------------------------------------------------------------
# Issuing one: creating a user, and an administrator's reset
# ---------------------------------------------------------------------------


def admin_client() -> tuple[APIClient, User]:
    admin = User.objects.create_user(
        email="temp-admin@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    client = APIClient()
    client.force_authenticate(user=admin)
    return client, admin


def create(client: APIClient, **extra: object) -> Any:
    return client.post(
        "/api/users/",
        {"email": "temp-new@example.com", "first_name": "Temp", **extra},
        format="json",
    )


def assert_issued_once(response: Any, user: User) -> str:
    """The response carries a working temporary password, uncached, and the
    server keeps only its hash."""
    password: str = response.json()["temporary_password"]
    validate_password(password, user)
    assert "no-store" in response["Cache-Control"]
    assert user.password != password
    assert password not in user.password
    assert user.check_password(password)
    return password


@pytest.mark.parametrize("hours", [24, 6])
def test_creating_a_user_issues_a_temporary_password(settings: Any, hours: int) -> None:
    settings.TEMPORARY_PASSWORD_LIFETIME = timedelta(hours=hours)
    client, _admin = admin_client()
    before = timezone.now()

    response = create(client)

    assert response.status_code == 201
    user = User.objects.get(email="temp-new@example.com")
    assert_issued_once(response, user)
    assert user.must_change_password is True
    assert user.temporary_password_expires_at is not None
    lifetime = user.temporary_password_expires_at - before
    assert timedelta(hours=hours) <= lifetime < timedelta(hours=hours, minutes=1)
    assert response.json()["temporary_password_expires_at"] is not None


def test_a_password_sent_when_creating_a_user_is_ignored() -> None:
    client, _admin = admin_client()

    response = create(client, password="Chosen-By-Admin-2026!")

    assert response.status_code == 201
    user = User.objects.get(email="temp-new@example.com")
    assert not user.check_password("Chosen-By-Admin-2026!")
    assert user.check_password(response.json()["temporary_password"])


def test_the_temporary_password_is_never_served_again() -> None:
    client, _admin = admin_client()
    user_id = create(client).json()["id"]

    detail = client.get(f"/api/users/{user_id}/").json()
    listing = client.get("/api/users/").json()["results"]

    assert "temporary_password" not in detail
    assert all("temporary_password" not in row for row in listing)


def test_a_reset_issues_a_new_temporary_password_and_ends_the_old_one() -> None:
    client, _admin = admin_client()
    created = create(client).json()
    target = User.objects.get(pk=created["id"])
    target.set_password("Owner-Chosen-Pass-9!")
    target.must_change_password = False
    target.temporary_password_expires_at = None
    target.save()

    response = client.post(f"/api/users/{target.pk}/set-password/")

    assert response.status_code == 200
    target = User.objects.get(pk=target.pk)
    issued = assert_issued_once(response, target)
    assert issued != created["temporary_password"]
    assert not target.check_password("Owner-Chosen-Pass-9!")
    assert target.must_change_password is True
    assert target.temporary_password_expires_at is not None
    assert response.json()["must_change_password"] is True


def test_issuing_again_replaces_an_expired_temporary_password() -> None:
    client, _admin = admin_client()
    created = create(client).json()
    User.objects.filter(pk=created["id"]).update(
        temporary_password_expires_at=timezone.now() - timedelta(minutes=1),
    )

    issued = client.post(f"/api/users/{created['id']}/set-password/").json()

    assert sign_in("temp-new@example.com", created["temporary_password"]) == 400
    assert sign_in("temp-new@example.com", issued["temporary_password"]) == 200


def test_issuing_is_audited_without_the_password() -> None:
    client, admin = admin_client()
    created = create(client).json()
    issued = client.post(f"/api/users/{created['id']}/set-password/").json()

    events = AuditEvent.objects.filter(entity_id=created["id"]).order_by("pk")
    assert [event.action for event in events] == [
        AuditAction.USER_CREATED,
        AuditAction.USER_UPDATED,
    ]
    for event, sent in zip(events, (created, issued), strict=True):
        assert event.actor == admin
        assert event.metadata["temporary_password_expires_at"]
        assert sent["temporary_password"] not in str(event.metadata)
        assert sent["temporary_password"] not in event.summary


def test_only_user_managers_can_issue_one() -> None:
    target = User.objects.create_user(
        email="temp-target@example.com",
        password="Owner-Chosen-Pass-9!",
    )
    client = APIClient()
    client.force_authenticate(
        user=User.objects.create_user(email="temp-instructor@example.com"),
    )

    assert client.post("/api/users/", {"email": "x@example.com"}).status_code == 403
    assert client.post(f"/api/users/{target.pk}/set-password/").status_code == 403
    target.refresh_from_db()
    assert target.check_password("Owner-Chosen-Pass-9!")
    assert target.must_change_password is False


@pytest.mark.parametrize("access", ["is_staff", "is_superuser"])
def test_only_a_superuser_can_reset_an_account_with_admin_site_access(
    access: str,
) -> None:
    # The temporary password signs in as that account, so a reset by anyone
    # less would hand out the admin site, which this API never grants.
    target = User.objects.create_user(
        email="temp-admin-site@example.com",
        password="Owner-Chosen-Pass-9!",
        **{access: True},
    )
    client, _admin = admin_client()

    refused = client.post(f"/api/users/{target.pk}/set-password/")

    assert refused.status_code == 400
    assert refused.json()["error"]["message"] == (
        "Only a superuser can reset this account's password."
    )
    target.refresh_from_db()
    assert target.check_password("Owner-Chosen-Pass-9!")
    superuser = APIClient()
    superuser.force_authenticate(
        user=User.objects.create_superuser(email="temp-root@example.com"),
    )
    assert superuser.post(f"/api/users/{target.pk}/set-password/").status_code == 200


# ---------------------------------------------------------------------------
# Expiry, wherever sign-in is checked
# ---------------------------------------------------------------------------


def sign_in(email: str, password: str) -> int:
    response = APIClient().post(
        "/api/auth/login/",
        {"email": email, "password": password},
        format="json",
    )
    status: int = response.status_code
    return status


def temporary_account(*, expired: bool, **extra: Any) -> User:
    offset = timedelta(minutes=-1 if expired else 60)
    return User.objects.create_user(
        email="temp-holder@example.com",
        password="Temporary-Pass-2026!",
        must_change_password=True,
        temporary_password_expires_at=timezone.now() + offset,
        **extra,
    )


def test_a_temporary_password_signs_in_until_it_expires() -> None:
    temporary_account(expired=False)

    assert sign_in("temp-holder@example.com", "Temporary-Pass-2026!") == 200


def test_an_expired_temporary_password_is_refused_like_a_wrong_one() -> None:
    temporary_account(expired=True)
    client = APIClient()

    expired = client.post(
        "/api/auth/login/",
        {"email": "temp-holder@example.com", "password": "Temporary-Pass-2026!"},
        format="json",
    )
    wrong = client.post(
        "/api/auth/login/",
        {"email": "temp-holder@example.com", "password": "Wrong-Password-2026!"},
        format="json",
    )

    assert expired.status_code == wrong.status_code == 400
    assert expired.json() == wrong.json()


def test_an_expired_temporary_password_cannot_sign_in_to_the_admin_site(
    settings: Any,
) -> None:
    render_admin_pages(settings)
    temporary_account(expired=True, is_staff=True, is_superuser=True)
    client = Client()

    response = client.post(
        "/admin/login/",
        {"username": "temp-holder@example.com", "password": "Temporary-Pass-2026!"},
    )

    assert response.status_code == 200  # the form again, not a redirect in
    assert "_auth_user_id" not in client.session


def test_a_session_opened_before_expiry_ends_with_it() -> None:
    user = temporary_account(expired=False)
    client = APIClient()
    client.post(
        "/api/auth/login/",
        {"email": "temp-holder@example.com", "password": "Temporary-Pass-2026!"},
        format="json",
    )
    assert client.get("/api/auth/me/").status_code == 200

    User.objects.filter(pk=user.pk).update(
        temporary_password_expires_at=timezone.now() - timedelta(seconds=1),
    )

    assert client.get("/api/auth/me/").status_code == 403


def test_choosing_your_own_password_ends_the_expiry() -> None:
    user = temporary_account(expired=False)
    client = APIClient()
    client.force_authenticate(user=user)

    client.post(
        "/api/auth/change-password/",
        {
            "current_password": "Temporary-Pass-2026!",
            "new_password": "Owner-Chosen-Pass-9!",
        },
        format="json",
    )

    user.refresh_from_db()
    assert user.must_change_password is False
    assert user.temporary_password_expires_at is None
    assert sign_in("temp-holder@example.com", "Owner-Chosen-Pass-9!") == 200


def test_a_password_its_owner_chose_never_expires() -> None:
    # Every account from before this change: no expiry, so nobody is locked out.
    user = User.objects.create_user(
        email="temp-permanent@example.com",
        password="Owner-Chosen-Pass-9!",
    )

    assert user.temporary_password_expires_at is None
    assert user.temporary_password_expired is False
    assert sign_in("temp-permanent@example.com", "Owner-Chosen-Pass-9!") == 200


def test_an_issued_password_never_prints() -> None:
    issued = create_platform_user(email="temp-repr@example.com")

    assert issued.password not in repr(issued)
    assert issued.password not in str(issued)


def test_the_security_log_never_sees_a_temporary_password(
    caplog: pytest.LogCaptureFixture,
) -> None:
    client, _admin = admin_client()
    with caplog.at_level(logging.DEBUG, logger="kukgrade.security"):
        issued = create(client).json()["temporary_password"]
        sign_in("temp-new@example.com", issued + "x")

    # The failed sign-in is there: proof the capture sees this log at all.
    assert "Failed login attempt for temp-new@example.com" in caplog.text
    assert issued not in caplog.text


def test_sessions_signed_in_before_account_backend_stay_signed_in() -> None:
    # Django loads a session's user only while the backend path the session
    # recorded is still configured; 0007 re-points the old one.
    migration = importlib.import_module(
        "accounts.migrations.0007_sessions_use_account_backend",
    )
    user = User.objects.create_user(email="temp-session@example.com")
    client = Client()
    client.force_login(user, backend=migration.MODEL_BACKEND)
    assert client.get("/api/auth/me/").status_code == 403

    migration.forwards(django_apps, None)

    assert client.get("/api/auth/me/").status_code == 200
    migration.backwards(django_apps, None)
    assert client.get("/api/auth/me/").status_code == 403
