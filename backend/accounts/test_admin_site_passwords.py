"""The Django admin site and passwords (slice 4): closed while a change is
required, no password form for your own account, and nobody typing another
person's password - a reset or a new account issues a generated one, once."""

from __future__ import annotations

from typing import Any

import pytest
from django.test import Client

from accounts.models import User
from audit.models import AuditAction, AuditEvent
from kukgrade.testing import render_admin_pages

pytestmark = pytest.mark.django_db

OWNER_PASSWORD = "Owner-Chosen-Pass-9!"


@pytest.fixture(autouse=True)
def _admin_pages(settings: Any) -> None:
    render_admin_pages(settings)


def superuser_client(**extra: Any) -> tuple[Client, User]:
    superuser = User.objects.create_superuser(
        email="site-superuser@example.com",
        password=OWNER_PASSWORD,
        **extra,
    )
    client = Client()
    client.force_login(superuser)
    return client, superuser


def target() -> User:
    return User.objects.create_user(
        email="site-target@example.com",
        first_name="Sam",
        last_name="Target",
        password=OWNER_PASSWORD,
    )


def password_inputs(response: Any) -> int:
    count: int = response.content.decode().count('type="password"')
    return count


# ---------------------------------------------------------------------------
# Closed while a change is required
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    ["/admin/", "/admin/accounts/user/", "/admin/students/student/"],
)
def test_the_admin_site_is_closed_while_a_change_is_required(path: str) -> None:
    client, _me = superuser_client(must_change_password=True)

    response = client.get(path)

    assert response.status_code == 403
    page = response.content.decode()
    assert "Your password must be changed before you can use the admin site." in page
    assert "Sign out" in page
    # Nothing of the site behind it: no model list, no navigation.
    assert "/admin/accounts/user/" not in page


def test_signing_out_of_the_admin_site_stays_open() -> None:
    client, _me = superuser_client(must_change_password=True)

    response = client.post("/admin/logout/")

    assert response.status_code == 200
    assert "_auth_user_id" not in client.session


def test_the_admin_site_opens_once_the_password_is_changed() -> None:
    # One session: changing the password ends every other.
    client, _me = superuser_client(must_change_password=True)

    client.post(
        "/api/auth/change-password/",
        {"current_password": OWNER_PASSWORD, "new_password": "Brand-New-Choice-9!"},
        content_type="application/json",
    )

    assert client.get("/admin/").status_code == 200


# ---------------------------------------------------------------------------
# Your own password: KukGrade's Settings, not the admin site
# ---------------------------------------------------------------------------


def test_the_admin_sites_own_password_form_points_to_the_account_menu() -> None:
    client, me = superuser_client()

    shown = client.get("/admin/password_change/")
    sent = client.post(
        "/admin/password_change/",
        {
            "old_password": OWNER_PASSWORD,
            "new_password1": "Admin-Form-Choice-9!",
            "new_password2": "Admin-Form-Choice-9!",
        },
    )

    for response in (shown, sent):
        assert response.status_code == 200
        assert "Change your own password in Settings" in (response.content.decode())
        assert password_inputs(response) == 0
    me.refresh_from_db()
    assert me.check_password(OWNER_PASSWORD)


def test_the_admin_sites_password_changed_page_claims_nothing() -> None:
    client, _me = superuser_client()

    response = client.get("/admin/password_change/done/")

    page = response.content.decode()
    assert "Change your own password in Settings" in page
    assert "was changed" not in page


def test_your_own_account_cannot_be_reset_on_the_admin_site() -> None:
    client, me = superuser_client()
    events_before = AuditEvent.objects.count()

    response = client.post(f"/admin/accounts/user/{me.pk}/password/")

    assert "Change your own password in Settings" in (response.content.decode())
    me.refresh_from_db()
    assert me.check_password(OWNER_PASSWORD)
    assert me.must_change_password is False
    assert AuditEvent.objects.count() == events_before


# ---------------------------------------------------------------------------
# Someone else's: a generated temporary password, shown once
# ---------------------------------------------------------------------------


def test_a_reset_on_the_admin_site_asks_first_and_takes_no_password() -> None:
    client, _me = superuser_client()
    person = target()

    response = client.get(f"/admin/accounts/user/{person.pk}/password/")

    assert response.status_code == 200
    assert "Reset the password for Sam Target?" in response.content.decode()
    assert password_inputs(response) == 0
    person.refresh_from_db()
    assert person.check_password(OWNER_PASSWORD)


def test_a_reset_on_the_admin_site_issues_a_temporary_password_once() -> None:
    client, me = superuser_client()
    person = target()

    response = client.post(f"/admin/accounts/user/{person.pk}/password/")

    assert response.status_code == 200
    assert "no-store" in response["Cache-Control"]
    issued = response.context["issued"].password
    page = response.content.decode()
    assert issued in page
    assert "It will not be shown again." in page
    person.refresh_from_db()
    assert person.check_password(issued)
    assert not person.check_password(OWNER_PASSWORD)
    assert person.must_change_password is True
    assert person.temporary_password_expires_at is not None
    event = AuditEvent.objects.get(
        action=AuditAction.USER_UPDATED,
        entity_id=str(person.pk),
    )
    assert event.actor == me
    assert issued not in event.summary
    assert issued not in str(event.metadata)


def test_adding_a_user_on_the_admin_site_issues_a_temporary_password_once() -> None:
    client, me = superuser_client()

    form = client.get("/admin/accounts/user/add/")
    response = client.post(
        "/admin/accounts/user/add/",
        {
            "email": "site-added@example.com",
            "first_name": "Ada",
            "role": User.Role.INSTRUCTOR,
            "is_active": "on",
            # Ignored: the form has no password field.
            "password1": "Typed-On-Admin-2026!",
            "password2": "Typed-On-Admin-2026!",
        },
    )

    assert password_inputs(form) == 0
    assert response.status_code == 200
    assert "no-store" in response["Cache-Control"]
    issued = response.context["issued"].password
    assert issued in response.content.decode()
    added = User.objects.get(email="site-added@example.com")
    assert added.check_password(issued)
    assert not added.check_password("Typed-On-Admin-2026!")
    assert added.must_change_password is True
    assert added.temporary_password_expires_at is not None
    created = AuditEvent.objects.get(
        action=AuditAction.USER_CREATED,
        entity_id=str(added.pk),
    )
    assert created.actor == me
    assert issued not in str(created.metadata)


def test_only_a_superuser_can_reset_a_superuser_on_the_admin_site() -> None:
    # An administrator who can use the admin site, but is not a superuser.
    administrator = User.objects.create_user(
        email="site-administrator@example.com",
        role=User.Role.ADMINISTRATOR,
        is_staff=True,
    )
    superuser = User.objects.create_superuser(
        email="site-root@example.com",
        password=OWNER_PASSWORD,
    )
    client = Client()
    client.force_login(administrator)

    shown = client.get(f"/admin/accounts/user/{superuser.pk}/password/")
    sent = client.post(f"/admin/accounts/user/{superuser.pk}/password/")

    # The superuser's record is view-only to them, password page included.
    assert shown.status_code == sent.status_code == 403
    superuser.refresh_from_db()
    assert superuser.check_password(OWNER_PASSWORD)
