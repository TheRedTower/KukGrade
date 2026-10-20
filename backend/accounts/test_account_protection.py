"""Who may change which account (the owner's decision, 2026-10-20).

1. Only a superuser changes an account that can use the Django admin site.
2. Nobody changes their own role or account status.
3. Administrators otherwise manage instructors and each other as before.
"""

from __future__ import annotations

from typing import Any

import pytest
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.test import RequestFactory
from rest_framework.test import APIClient

from accounts.admin import UserAdmin
from accounts.models import User
from accounts.services import set_admin_site_access

pytestmark = pytest.mark.django_db

SUPERUSER_ONLY = "Only a superuser can change this account."
OWN_ROLE_OR_STATUS = "You cannot change your own role or account status."


def as_user(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def administrator(email: str = "guard-admin@example.com") -> User:
    return User.objects.create_user(email=email, role=User.Role.ADMINISTRATOR)


def refused_with(response: Any, message: str) -> None:
    assert response.status_code == 400, response.json()
    assert response.json()["error"]["fields"]["user"] == [message]


CHANGES: dict[str, tuple[str, str, dict[str, Any]]] = {
    "email": ("patch", "", {"email": "taken-over@example.com"}),
    "role": ("patch", "", {"role": "instructor"}),
    "status": ("patch", "", {"is_active": False}),
    "authority": ("patch", "authority/", {"can_promote_student": True}),
    "password": ("post", "set-password/", {}),
    "delete": ("delete", "", {}),
}


@pytest.mark.parametrize("access", ["is_superuser", "is_staff"])
@pytest.mark.parametrize("change", list(CHANGES))
def test_only_a_superuser_changes_an_account_with_admin_site_access(
    access: str,
    change: str,
) -> None:
    method, suffix, body = CHANGES[change]
    access_flag: dict[str, Any] = {access: True}
    protected = User.objects.create_user(
        email="guard-protected@example.com",
        role=User.Role.ADMINISTRATOR,
        **access_flag,
    )
    url = f"/api/users/{protected.pk}/{suffix}"

    refused = getattr(as_user(administrator()), method)(url, body, format="json")

    refused_with(refused, SUPERUSER_ONLY)
    kept = User.objects.get(pk=protected.pk)
    assert (kept.email, kept.role, kept.is_active) == (
        "guard-protected@example.com",
        User.Role.ADMINISTRATOR,
        True,
    )
    superuser = User.objects.create_superuser(email="guard-root@example.com")
    allowed = getattr(as_user(superuser), method)(url, body, format="json")
    assert allowed.status_code in {200, 204}, allowed.content


@pytest.mark.parametrize("role", [User.Role.INSTRUCTOR, User.Role.ADMINISTRATOR])
def test_administrators_still_manage_instructors_and_each_other(role: str) -> None:
    other = User.objects.create_user(email="guard-other@example.com", role=role)
    client = as_user(administrator())

    assert (
        client.patch(
            f"/api/users/{other.pk}/",
            {"is_active": False},
            format="json",
        ).status_code
        == 200
    )
    assert client.post(f"/api/users/{other.pk}/set-password/").status_code == 200
    assert client.delete(f"/api/users/{other.pk}/").status_code == 204


@pytest.mark.parametrize(
    "body",
    [{"role": "instructor"}, {"is_active": False}],
    ids=["role", "status"],
)
@pytest.mark.parametrize("superuser", [False, True], ids=["admin", "superuser"])
def test_nobody_changes_their_own_role_or_status(
    body: dict[str, Any],
    superuser: bool,
) -> None:
    me = (
        User.objects.create_superuser(email="guard-me@example.com")
        if superuser
        else administrator("guard-me@example.com")
    )

    response = as_user(me).patch(f"/api/users/{me.pk}/", body, format="json")

    refused_with(response, OWN_ROLE_OR_STATUS)
    me.refresh_from_db()
    assert (me.role, me.is_active) == (User.Role.ADMINISTRATOR, True)


def test_your_own_email_and_an_unchanged_role_still_save() -> None:
    me = administrator("guard-self@example.com")
    client = as_user(me)

    email = client.patch(
        f"/api/users/{me.pk}/",
        {"email": "guard-self-new@example.com", "role": "administrator"},
        format="json",
    )

    assert email.status_code == 200
    me.refresh_from_db()
    assert me.email == "guard-self-new@example.com"


def test_the_users_list_says_which_accounts_you_may_change() -> None:
    me = administrator("guard-viewer@example.com")
    User.objects.create_superuser(email="guard-list-root@example.com")
    User.objects.create_user(email="guard-list-instructor@example.com")

    rows = {
        row["email"]: row["manageable"]
        for row in as_user(me).get("/api/users/").json()["results"]
    }

    assert rows == {
        "guard-viewer@example.com": True,
        "guard-list-root@example.com": False,
        "guard-list-instructor@example.com": True,
    }


def test_only_a_superuser_grants_admin_site_access() -> None:
    staff = User.objects.create_user(
        email="guard-staff@example.com",
        role=User.Role.ADMINISTRATOR,
        is_staff=True,
    )

    with pytest.raises(ValidationError):
        set_admin_site_access(staff, actor=staff, is_superuser=True)

    staff.refresh_from_db()
    assert staff.is_superuser is False
    request = RequestFactory().get("/admin/")
    request.user = staff
    model_admin = UserAdmin(User, admin.site)
    readonly = model_admin.get_readonly_fields(request, staff)
    assert {"is_staff", "is_superuser"} <= set(readonly)


def test_a_superusers_record_is_view_only_to_anyone_else_on_the_admin_site() -> None:
    staff = User.objects.create_user(
        email="guard-site-staff@example.com",
        role=User.Role.ADMINISTRATOR,
        is_staff=True,
    )
    root = User.objects.create_superuser(email="guard-site-root@example.com")
    request = RequestFactory().get("/admin/")
    request.user = staff
    model_admin = UserAdmin(User, admin.site)

    assert model_admin.has_change_permission(request, root) is False
    assert model_admin.has_delete_permission(request, root) is False
    assert model_admin.has_change_permission(request, staff) is True
