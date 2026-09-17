from __future__ import annotations

import logging
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import patch

import pytest
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser, Permission
from django.contrib.contenttypes.models import ContentType
from django.core.cache import cache as django_cache
from django.core.exceptions import ValidationError
from django.forms import ModelForm
from django.test import RequestFactory
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.admin import UserAdmin, UserCreationForm
from accounts.groups import (
    ADMINISTRATOR_GROUP,
    INSTRUCTOR_GROUP,
    SENSITIVE_PERMISSIONS,
)
from accounts.models import User
from accounts.permissions import (
    FINAL_GRADING_DECISION_PERMISSION,
    CanMakeFinalGradingDecision,
    HasRequiredPermissions,
)
from audit.models import AuditAction, AuditEvent

pytestmark = pytest.mark.django_db


def create_user(
    email: str = "user@example.com",
    password: str = "StrongPass123!",
    **kwargs: object,
) -> User:
    return User.objects.create_user(email=email, password=password, **kwargs)


def csrf_token(client: APIClient) -> str:
    response = client.get("/api/auth/me/")
    cookie = response.cookies.get("csrftoken")
    assert cookie is not None
    return str(cookie.value)


def test_custom_user_creation_uses_uuid_and_email_login() -> None:
    user = create_user(
        email="Instructor@example.com",
        first_name="Casey",
        last_name="Instructor",
    )

    assert str(user.id)
    assert user.email == "instructor@example.com"
    assert not hasattr(user, "username")
    assert user.check_password("StrongPass123!")
    assert user.role == User.Role.INSTRUCTOR
    assert user.is_active is True
    assert user.is_staff is False
    assert user.is_superuser is False


def test_superuser_preserves_django_staff_and_superuser_behaviour() -> None:
    user = User.objects.create_superuser(
        email="admin@example.com",
        password="StrongPass123!",
    )

    assert user.role == User.Role.ADMINISTRATOR
    assert user.is_staff is True
    assert user.is_superuser is True


def test_email_is_normalised_and_unique() -> None:
    create_user(email="  PERSON@Example.COM  ")

    with pytest.raises(ValidationError):
        create_user(email="person@example.com")


def test_login_success_sets_session_and_returns_current_user() -> None:
    create_user(
        email="admin@example.com",
        password="StrongPass123!",
        role=User.Role.ADMINISTRATOR,
    )
    client = APIClient(enforce_csrf_checks=True)
    token = csrf_token(client)

    # Mixed case on purpose: emails are normalised before lookup.
    response = client.post(
        "/api/auth/login/",
        {"email": "ADMIN@example.com", "password": "StrongPass123!"},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )

    assert response.status_code == 200
    assert response.json()["email"] == "admin@example.com"
    assert response.json()["role"] == User.Role.ADMINISTRATOR
    assert "sessionid" in response.cookies


def test_login_failure_does_not_reveal_account_existence() -> None:
    create_user(email="known@example.com", password="StrongPass123!")
    client = APIClient(enforce_csrf_checks=True)
    token = csrf_token(client)

    known_response = client.post(
        "/api/auth/login/",
        {"email": "known@example.com", "password": "wrong"},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )
    unknown_response = client.post(
        "/api/auth/login/",
        {"email": "unknown@example.com", "password": "wrong"},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )

    assert known_response.status_code == 400
    assert unknown_response.status_code == 400
    assert known_response.json() == unknown_response.json()


def test_disabled_users_cannot_authenticate() -> None:
    create_user(
        email="disabled@example.com",
        password="StrongPass123!",
        is_active=False,
    )
    client = APIClient(enforce_csrf_checks=True)
    token = csrf_token(client)

    response = client.post(
        "/api/auth/login/",
        {"email": "disabled@example.com", "password": "StrongPass123!"},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )

    assert response.status_code == 400
    assert "sessionid" not in response.cookies


def test_login_requires_csrf_token() -> None:
    create_user(email="csrf@example.com", password="StrongPass123!")
    client = APIClient(enforce_csrf_checks=True)
    client.get("/api/auth/me/")

    response = client.post(
        "/api/auth/login/",
        {"email": "csrf@example.com", "password": "StrongPass123!"},
        format="json",
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_failed"


def test_failed_login_logs_the_email_and_never_the_password(
    caplog: pytest.LogCaptureFixture,
) -> None:
    create_user(email="logged-target@example.com", password="StrongPass123!")
    client = APIClient(enforce_csrf_checks=True)
    token = csrf_token(client)

    with caplog.at_level(logging.WARNING, logger="kukgrade.security"):
        client.post(
            "/api/auth/login/",
            {
                "email": "logged-target@example.com",
                "password": "TotallySecretPassphrase1!",
            },
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )

    messages = [record.getMessage() for record in caplog.records]
    assert any("logged-target@example.com" in message for message in messages)
    assert not any("TotallySecretPassphrase1!" in message for message in messages)


def test_repeated_failed_logins_are_throttled() -> None:
    # ScopedRateThrottle.THROTTLE_RATES is bound from api_settings once at
    # import time, so override_settings(REST_FRAMEWORK=...) does not reach
    # it - patching the class attribute directly is what actually changes
    # the rate for the duration of the test.
    create_user(email="throttle-target@example.com", password="StrongPass123!")
    client = APIClient(enforce_csrf_checks=True)
    token = csrf_token(client)
    django_cache.clear()

    try:
        with patch.object(ScopedRateThrottle, "THROTTLE_RATES", {"login": "2/min"}):
            attempts = [
                client.post(
                    "/api/auth/login/",
                    {
                        "email": "throttle-target@example.com",
                        "password": "wrong",
                    },
                    format="json",
                    HTTP_X_CSRFTOKEN=token,
                )
                for _ in range(2)
            ]
            throttled = client.post(
                "/api/auth/login/",
                {"email": "throttle-target@example.com", "password": "wrong"},
                format="json",
                HTTP_X_CSRFTOKEN=token,
            )
    finally:
        django_cache.clear()

    assert [response.status_code for response in attempts] == [400, 400]
    assert throttled.status_code == 429
    assert throttled.json()["error"]["code"] == "throttled"


def test_current_user_requires_authentication() -> None:
    response = APIClient().get("/api/auth/me/")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "authentication_required"


def test_current_user_returns_authenticated_user() -> None:
    user = create_user(
        email="current@example.com",
        first_name="Current",
        last_name="User",
    )
    grant_final_decision_permission(user)
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get("/api/auth/me/")

    assert response.status_code == 200
    assert response.json() == {
        "id": str(user.id),
        "email": "current@example.com",
        "first_name": "Current",
        "last_name": "User",
        "full_name": "Current User",
        "role": User.Role.INSTRUCTOR,
        "role_display": "Instructor",
        # Computed from the permission, not from a stored flag.
        "can_make_final_grading_decision": True,
        "can_promote_student": False,
        "can_override_locked_session": False,
        "must_change_password": False,
        "is_staff": False,
        "is_superuser": False,
    }


def test_logout_clears_session() -> None:
    user = create_user(email="logout@example.com")
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.post("/api/auth/logout/")

    assert response.status_code == 204


# ---------------------------------------------------------------------------
# Self-service profile: display name
# ---------------------------------------------------------------------------


def test_current_user_can_update_their_own_display_name() -> None:
    user = create_user(
        email="rename-self@example.com",
        first_name="Old",
        last_name="Name",
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.patch(
        "/api/auth/me/",
        {"first_name": "New", "last_name": "Name"},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["first_name"] == "New"
    assert response.json()["full_name"] == "New Name"
    user.refresh_from_db()
    assert user.first_name == "New"

    event = AuditEvent.objects.get(
        action=AuditAction.USER_UPDATED, entity_id=str(user.pk)
    )
    assert event.actor == user
    assert event.metadata["before"]["first_name"] == "Old"
    assert event.metadata["after"]["first_name"] == "New"


def test_current_user_profile_patch_cannot_change_email_role_or_authority() -> None:
    user = create_user(email="rename-boundary@example.com", role=User.Role.INSTRUCTOR)
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.patch(
        "/api/auth/me/",
        {
            "first_name": "Changed",
            "email": "escalated@example.com",
            "role": User.Role.ADMINISTRATOR,
            "is_staff": True,
            "is_superuser": True,
        },
        format="json",
    )

    assert response.status_code == 200
    user.refresh_from_db()
    assert user.first_name == "Changed"
    assert user.email == "rename-boundary@example.com"
    assert user.role == User.Role.INSTRUCTOR
    assert user.is_staff is False
    assert user.is_superuser is False


def test_current_user_profile_patch_requires_authentication() -> None:
    response = APIClient().patch("/api/auth/me/", {"first_name": "X"}, format="json")

    assert response.status_code == 403


def test_noop_profile_patch_records_no_audit_event() -> None:
    user = create_user(
        email="rename-noop@example.com",
        first_name="Same",
        last_name="Name",
    )
    client = APIClient()
    client.force_authenticate(user=user)
    before = AuditEvent.objects.count()

    response = client.patch(
        "/api/auth/me/",
        {"first_name": "Same", "last_name": "Name"},
        format="json",
    )

    assert response.status_code == 200
    assert AuditEvent.objects.count() == before


# ---------------------------------------------------------------------------
# Self-service password change
# ---------------------------------------------------------------------------


def test_change_password_requires_the_correct_current_password() -> None:
    user = create_user(email="change-pw-wrong@example.com", password="OldPassw0rd!")
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.post(
        "/api/auth/change-password/",
        {"current_password": "WrongPassword!", "new_password": "NewPassw0rd!42"},
        format="json",
    )

    assert response.status_code == 400
    assert "current_password" in response.json()["error"]["fields"]
    user.refresh_from_db()
    assert user.check_password("OldPassw0rd!")


def test_change_password_enforces_the_configured_validators() -> None:
    user = create_user(
        email="change-pw-weak@example.com",
        password="OldPassw0rd!",
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.post(
        "/api/auth/change-password/",
        # Matches the account's own email, which UserAttributeSimilarityValidator
        # rejects - only reachable if the instance is passed through to
        # validate_password(), same as SetPasswordSerializer.
        {
            "current_password": "OldPassw0rd!",
            "new_password": "change-pw-weak@example.com",
        },
        format="json",
    )

    assert response.status_code == 400
    assert "new_password" in response.json()["error"]["fields"]
    user.refresh_from_db()
    assert user.check_password("OldPassw0rd!")


def test_change_password_succeeds_and_is_audited_without_leaking_the_value() -> None:
    user = create_user(email="change-pw-ok@example.com", password="OldPassw0rd!")
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.post(
        "/api/auth/change-password/",
        {"current_password": "OldPassw0rd!", "new_password": "BrandNewPassw0rd!42"},
        format="json",
    )

    assert response.status_code == 204
    user.refresh_from_db()
    assert user.check_password("BrandNewPassw0rd!42")
    assert not user.check_password("OldPassw0rd!")

    event = AuditEvent.objects.get(
        action=AuditAction.USER_UPDATED, entity_id=str(user.pk)
    )
    assert event.actor == user
    assert "BrandNewPassw0rd" not in event.summary
    assert "BrandNewPassw0rd" not in str(event.metadata)


def test_change_password_requires_authentication() -> None:
    response = APIClient().post(
        "/api/auth/change-password/",
        {"current_password": "x", "new_password": "y"},
        format="json",
    )

    assert response.status_code == 403


def test_repeated_wrong_current_passwords_are_throttled() -> None:
    user = create_user(email="change-pw-throttle@example.com", password="OldPassw0rd!")
    client = APIClient()
    client.force_authenticate(user=user)
    django_cache.clear()

    try:
        with patch.object(
            ScopedRateThrottle, "THROTTLE_RATES", {"password_change": "2/min"}
        ):
            attempts = [
                client.post(
                    "/api/auth/change-password/",
                    {
                        "current_password": "wrong",
                        "new_password": "Whatever42!Password",
                    },
                    format="json",
                )
                for _ in range(2)
            ]
            throttled = client.post(
                "/api/auth/change-password/",
                {"current_password": "wrong", "new_password": "Whatever42!Password"},
                format="json",
            )
    finally:
        django_cache.clear()

    assert [response.status_code for response in attempts] == [400, 400]
    assert throttled.status_code == 429


def permission_result(permission: type, user: User | None) -> bool:
    request = APIRequestFactory().get("/permission-test/")
    request.user = user if user is not None else AnonymousUser()
    return bool(permission().has_permission(request, APIView()))


def grant_final_decision_permission(user: User) -> None:
    app_label, codename = FINAL_GRADING_DECISION_PERMISSION.split(".")
    permission = Permission.objects.get(
        codename=codename,
        content_type=ContentType.objects.get(
            app_label=app_label,
            model="candidateoutcome",
        ),
    )
    user.user_permissions.add(permission)


def test_role_assigns_the_matching_group() -> None:
    instructor = create_user("instructor@example.com", role=User.Role.INSTRUCTOR)
    administrator = create_user(
        "administrator@example.com",
        role=User.Role.ADMINISTRATOR,
    )

    assert list(instructor.groups.values_list("name", flat=True)) == [
        INSTRUCTOR_GROUP,
    ]
    assert list(administrator.groups.values_list("name", flat=True)) == [
        ADMINISTRATOR_GROUP,
    ]


def test_changing_role_moves_the_user_between_groups() -> None:
    user = create_user("promoted@example.com", role=User.Role.INSTRUCTOR)

    user.role = User.Role.ADMINISTRATOR
    user.save()

    names = set(user.groups.values_list("name", flat=True))
    assert names == {ADMINISTRATOR_GROUP}
    assert INSTRUCTOR_GROUP not in names


def test_only_administrators_manage_users() -> None:
    instructor = create_user("perm-instructor@example.com")
    administrator = create_user(
        "perm-administrator@example.com",
        role=User.Role.ADMINISTRATOR,
    )

    # Both run gradings; only one manages people.
    for user in (instructor, administrator):
        assert user.has_perm("gradings.add_gradingsession")
        assert user.has_perm("students.change_student")
    assert instructor.has_perm("accounts.add_user") is False
    assert administrator.has_perm("accounts.add_user") is True


def test_sensitive_permissions_are_in_no_role_group() -> None:
    # Master authority is granted per user so it survives one person being
    # away, and so it never arrives as a side effect of a role change.
    for user in (
        create_user("plain-instructor@example.com"),
        create_user("plain-admin@example.com", role=User.Role.ADMINISTRATOR),
    ):
        for permission in SENSITIVE_PERMISSIONS:
            assert user.has_perm(permission) is False


def test_undeclared_actions_are_denied() -> None:
    # Failing closed: an endpoint added without declaring its permissions
    # locks everyone out rather than opening to every authenticated user.
    user = create_user("undeclared@example.com")
    request = APIRequestFactory().get("/whatever/")
    request.user = user

    view = APIView()
    view.action = "some_new_action"  # type: ignore[attr-defined]
    view.permission_map = {"list": ()}  # type: ignore[attr-defined]

    assert HasRequiredPermissions().has_permission(request, view) is False


def test_views_without_a_permission_map_are_denied() -> None:
    user = create_user("no-map@example.com")
    request = APIRequestFactory().get("/whatever/")
    request.user = user

    view = APIView()
    view.action = "list"  # type: ignore[attr-defined]

    assert HasRequiredPermissions().has_permission(request, view) is False


def test_final_grading_decision_capability_is_independent_of_role() -> None:
    instructor_master = create_user(
        "instructor-master@example.com",
        role=User.Role.INSTRUCTOR,
    )
    grant_final_decision_permission(instructor_master)
    administrator_without_capability = create_user(
        "administrator-no-capability@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    superuser = User.objects.create_superuser("permission-superuser@example.com")

    assert permission_result(CanMakeFinalGradingDecision, instructor_master) is True
    assert (
        permission_result(CanMakeFinalGradingDecision, administrator_without_capability)
        is False
    )
    assert permission_result(CanMakeFinalGradingDecision, superuser) is True


def test_inactive_users_fail_every_permission_check() -> None:
    inactive = create_user("inactive@example.com", is_active=False)
    grant_final_decision_permission(inactive)

    assert permission_result(CanMakeFinalGradingDecision, inactive) is False

    request = APIRequestFactory().get("/whatever/")
    request.user = inactive
    view = APIView()
    view.action = "list"  # type: ignore[attr-defined]
    view.permission_map = {"list": ()}  # type: ignore[attr-defined]
    assert HasRequiredPermissions().has_permission(request, view) is False


def test_configured_user_model_is_custom_user() -> None:
    assert get_user_model() is User


def test_me_capabilities_are_computed_from_permissions() -> None:
    user = create_user("capabilities@example.com")
    client = APIClient()
    client.force_authenticate(user=user)

    before = client.get("/api/auth/me/").json()
    assert before["can_make_final_grading_decision"] is False
    assert before["can_promote_student"] is False

    grant_final_decision_permission(user)
    user = User.objects.get(pk=user.pk)  # drop the permission cache
    client.force_authenticate(user=user)

    after = client.get("/api/auth/me/").json()
    # The same key that used to be a stored flag nothing consulted.
    assert after["can_make_final_grading_decision"] is True
    assert after["can_promote_student"] is False


def test_superuser_capabilities_reflect_implicit_authority() -> None:
    superuser = User.objects.create_superuser("super-caps@example.com")
    client = APIClient()
    client.force_authenticate(user=superuser)

    payload = client.get("/api/auth/me/").json()

    assert payload["can_make_final_grading_decision"] is True
    assert payload["can_promote_student"] is True
    assert payload["can_override_locked_session"] is True


def test_me_override_locked_session_capability_is_computed_from_its_permission() -> (
    None
):
    # can_override_locked_session was added to the model after
    # can_make_final_grading_decision and can_promote_student; nothing
    # updated the serializer when it landed, so /api/auth/me/ silently
    # never reported it. Found while building the users API, which reuses
    # this exact response shape.
    from django.contrib.auth.models import Permission
    from django.contrib.contenttypes.models import ContentType

    from gradings.models import GradingSession

    user = create_user("override-caps@example.com")
    client = APIClient()
    client.force_authenticate(user=user)

    before = client.get("/api/auth/me/").json()
    assert before["can_override_locked_session"] is False

    user.user_permissions.add(
        Permission.objects.get(
            codename="can_override_locked_session",
            content_type=ContentType.objects.get_for_model(GradingSession),
        ),
    )
    user = User.objects.get(pk=user.pk)  # drop the permission cache
    client.force_authenticate(user=user)

    after = client.get("/api/auth/me/").json()
    assert after["can_override_locked_session"] is True
    # Independent of the other two, exactly as the model intends.
    assert after["can_make_final_grading_decision"] is False
    assert after["can_promote_student"] is False


def test_role_alone_never_grants_grading_authority() -> None:
    administrator = create_user(
        "admin-no-authority@example.com",
        role=User.Role.ADMINISTRATOR,
    )
    client = APIClient()
    client.force_authenticate(user=administrator)

    payload = client.get("/api/auth/me/").json()

    assert payload["can_make_final_grading_decision"] is False
    assert payload["can_promote_student"] is False
    assert payload["can_override_locked_session"] is False


# ---------------------------------------------------------------------------
# The users API: list, retrieve, create, partial_update. No delete, no PUT.
# Authority and set-password as separate actions.
# ---------------------------------------------------------------------------


def admin_client(email: str = "users-api-admin@example.com") -> tuple[APIClient, User]:
    admin = User.objects.create_user(email=email, role=User.Role.ADMINISTRATOR)
    client = APIClient()
    client.force_authenticate(user=admin)
    return client, admin


def create_user_via_api(client: APIClient, **overrides: object) -> dict[str, Any]:
    payload: dict[str, object] = {
        "email": "created-user@example.com",
        "password": "kg-Str0ngPassw0rd!",
        "first_name": "Created",
        "last_name": "User",
    }
    payload.update(overrides)
    response = client.post("/api/users/", payload, format="json")
    assert response.status_code == 201, response.json()
    body: dict[str, Any] = response.json()
    return body


def test_anonymous_cannot_read_or_write_users() -> None:
    client = APIClient()

    assert client.get("/api/users/").status_code == 403
    assert client.post("/api/users/", {}, format="json").status_code == 403


def test_instructors_cannot_read_or_write_users() -> None:
    instructor = create_user("plain-instructor-users@example.com")
    client = APIClient()
    client.force_authenticate(user=instructor)

    assert client.get("/api/users/").status_code == 403
    assert client.post("/api/users/", {}, format="json").status_code == 403


def test_administrators_can_list_and_retrieve() -> None:
    client, _admin = admin_client("list-retrieve-admin@example.com")
    created = create_user_via_api(client, email="list-target@example.com")

    listing = client.get("/api/users/").json()
    detail = client.get(f"/api/users/{created['id']}/").json()

    assert any(row["email"] == "list-target@example.com" for row in listing["results"])
    assert detail["email"] == "list-target@example.com"


def test_weak_password_is_rejected_with_a_field_error() -> None:
    client, _admin = admin_client("weak-password-admin@example.com")

    response = client.post(
        "/api/users/",
        {"email": "weak@example.com", "password": "12345678"},
        format="json",
    )

    assert response.status_code == 400
    assert "password" in response.json()["error"]["fields"]
    assert not User.objects.filter(email="weak@example.com").exists()


def test_password_matching_the_new_accounts_own_email_is_rejected() -> None:
    # UserAttributeSimilarityValidator has nothing to compare against on
    # create unless the serializer builds an unsaved User from the other
    # submitted fields first - this is the case that catches a regression.
    client, _admin = admin_client("similarity-admin@example.com")

    response = client.post(
        "/api/users/",
        {
            "email": "graham.mitchell@example.com",
            "password": "graham.mitchell@example.com",
            "first_name": "Graham",
            "last_name": "Mitchell",
        },
        format="json",
    )

    assert response.status_code == 400
    assert "password" in response.json()["error"]["fields"]
    assert not User.objects.filter(email="graham.mitchell@example.com").exists()


def test_admin_add_user_form_enforces_the_same_password_validators() -> None:
    # UserCreationForm is a plain ModelForm subclass, not Django's own
    # contrib.auth.forms.UserCreationForm - it must validate the password
    # itself, or admin becomes a second door with a lower standard than
    # the API.
    weak = UserCreationForm(
        data={
            "email": "weak-admin-form@example.com",
            "first_name": "Weak",
            "last_name": "Password",
            "role": User.Role.INSTRUCTOR,
            "password1": "12345678",
            "password2": "12345678",
        },
    )

    assert weak.is_valid() is False
    assert "password2" in weak.errors

    similar = UserCreationForm(
        data={
            "email": "graham.mitchell@example.com",
            "first_name": "Graham",
            "last_name": "Mitchell",
            "role": User.Role.INSTRUCTOR,
            "password1": "graham.mitchell@example.com",
            "password2": "graham.mitchell@example.com",
        },
    )

    assert similar.is_valid() is False
    assert "password2" in similar.errors


def test_duplicate_email_is_a_field_error_not_a_server_error() -> None:
    client, _admin = admin_client("duplicate-email-admin@example.com")
    create_user_via_api(client, email="dup@example.com")

    response = client.post(
        "/api/users/",
        {"email": "dup@example.com", "password": "kg-Str0ngPassw0rd!"},
        format="json",
    )

    assert response.status_code == 400
    assert "email" in response.json()["error"]["fields"]


def test_is_staff_and_is_superuser_cannot_be_granted_through_create() -> None:
    client, _admin = admin_client("no-staff-grant-admin@example.com")

    created = create_user_via_api(
        client,
        email="attempted-staff@example.com",
        is_staff=True,
        is_superuser=True,
    )

    assert created["is_staff"] is False
    assert created["is_superuser"] is False
    stored = User.objects.get(pk=created["id"])
    assert stored.is_staff is False
    assert stored.is_superuser is False


def test_create_records_a_user_created_event() -> None:
    client, _admin = admin_client("create-audit-admin@example.com")
    before = AuditEvent.objects.filter(action=AuditAction.USER_CREATED).count()

    create_user_via_api(client, email="audit-create@example.com")

    assert (
        AuditEvent.objects.filter(action=AuditAction.USER_CREATED).count() == before + 1
    )


def test_a_no_op_patch_writes_no_audit_event() -> None:
    client, _admin = admin_client("no-op-admin@example.com")
    created = create_user_via_api(client, email="no-op-target@example.com")
    before = AuditEvent.objects.count()

    response = client.patch(
        f"/api/users/{created['id']}/",
        {"first_name": created["first_name"]},
        format="json",
    )

    assert response.status_code == 200
    assert AuditEvent.objects.count() == before


def test_patch_cannot_change_the_password() -> None:
    # The password field is removed entirely from the update serializer, not
    # just made optional: password changes go through set-password only.
    client, _admin = admin_client("patch-password-admin@example.com")
    created = create_user_via_api(
        client,
        email="patch-password-target@example.com",
        password="kg-Original-Passw0rd!",
    )

    response = client.patch(
        f"/api/users/{created['id']}/",
        {"first_name": "Changed", "password": "kg-Attempted-Change!"},
        format="json",
    )

    assert response.status_code == 200
    assert "password" not in response.json()
    target = User.objects.get(pk=created["id"])
    assert target.check_password("kg-Original-Passw0rd!") is True
    assert target.check_password("kg-Attempted-Change!") is False


def test_put_and_delete_are_not_allowed() -> None:
    client, _admin = admin_client("no-put-delete-admin@example.com")
    created = create_user_via_api(client, email="no-method-target@example.com")

    put_response = client.put(
        f"/api/users/{created['id']}/",
        {"first_name": "X"},
        format="json",
    )
    delete_response = client.delete(f"/api/users/{created['id']}/")

    assert put_response.status_code == 405
    assert delete_response.status_code == 405
    assert User.objects.filter(pk=created["id"]).exists()


# ---------------------------------------------------------------------------
# Authority sub-resource
# ---------------------------------------------------------------------------


def test_granting_authority_is_reflected_immediately_in_the_response() -> None:
    # Django caches has_perm() on the instance; the service must refetch
    # before recomputing, or this response would show the pre-change state
    # even though the database was updated correctly.
    client, _admin = admin_client("grant-authority-admin@example.com")
    created = create_user_via_api(client, email="grant-authority-target@example.com")

    response = client.patch(
        f"/api/users/{created['id']}/authority/",
        {"can_make_final_grading_decision": True},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["can_make_final_grading_decision"] is True
    assert response.json()["can_promote_student"] is False


def test_revoking_authority_works_and_is_independent_per_flag() -> None:
    client, _admin = admin_client("revoke-authority-admin@example.com")
    created = create_user_via_api(client, email="revoke-authority-target@example.com")
    client.patch(
        f"/api/users/{created['id']}/authority/",
        {"can_make_final_grading_decision": True, "can_promote_student": True},
        format="json",
    )

    response = client.patch(
        f"/api/users/{created['id']}/authority/",
        {"can_make_final_grading_decision": False},
        format="json",
    )

    assert response.json()["can_make_final_grading_decision"] is False
    # Revoking one must not touch the other.
    assert response.json()["can_promote_student"] is True


def test_a_combined_authority_change_writes_exactly_one_event() -> None:
    client, _admin = admin_client("combined-authority-admin@example.com")
    created = create_user_via_api(client, email="combined-authority-target@example.com")
    before = AuditEvent.objects.count()

    client.patch(
        f"/api/users/{created['id']}/authority/",
        {"can_make_final_grading_decision": True, "can_override_locked_session": True},
        format="json",
    )

    new_events = AuditEvent.objects.filter(
        entity_type="User",
        entity_id=created["id"],
        action=AuditAction.USER_AUTHORITY_CHANGED,
    )
    assert new_events.count() == 1
    event = new_events.get()
    assert event.metadata["before"] == {
        "can_make_final_grading_decision": False,
        "can_promote_student": False,
        "can_override_locked_session": False,
    }
    assert event.metadata["after"] == {
        "can_make_final_grading_decision": True,
        "can_promote_student": False,
        "can_override_locked_session": True,
    }
    assert AuditEvent.objects.count() == before + 1


def test_a_no_op_authority_patch_writes_no_event() -> None:
    client, _admin = admin_client("no-op-authority-admin@example.com")
    created = create_user_via_api(client, email="no-op-authority-target@example.com")
    before = AuditEvent.objects.count()

    response = client.patch(
        f"/api/users/{created['id']}/authority/",
        {"can_promote_student": False},  # already false; nothing changes
        format="json",
    )

    assert response.status_code == 200
    assert AuditEvent.objects.count() == before


def test_an_administrator_cannot_change_their_own_authority() -> None:
    # Self-granting would defeat the point of authority being separate from
    # role and from being an administrator.
    client, admin = admin_client("self-authority-admin@example.com")

    response = client.patch(
        f"/api/users/{admin.pk}/authority/",
        {"can_make_final_grading_decision": True},
        format="json",
    )

    assert response.status_code == 400
    assert "authority" in response.json()["error"]["fields"]
    admin.refresh_from_db()
    assert admin.has_perm(FINAL_GRADING_DECISION_PERMISSION) is False


def test_only_administrators_hold_change_user_for_the_authority_action() -> None:
    instructor = create_user("cannot-grant-authority@example.com")
    client, _admin = admin_client("authority-target-owner@example.com")
    created = create_user_via_api(client, email="authority-victim@example.com")

    instructor_client = APIClient()
    instructor_client.force_authenticate(user=instructor)
    response = instructor_client.patch(
        f"/api/users/{created['id']}/authority/",
        {"can_promote_student": True},
        format="json",
    )

    assert response.status_code == 403


def test_granting_final_decision_authority_to_an_administrator_is_refused() -> None:
    # Confirmed policy: exactly one designated Master, never an
    # administrator - administrators keep every other capability instead.
    client, _admin = admin_client("no-master-admin-grantor@example.com")
    created = create_user_via_api(
        client,
        email="no-master-admin-target@example.com",
        role=User.Role.ADMINISTRATOR,
    )

    response = client.patch(
        f"/api/users/{created['id']}/authority/",
        {"can_make_final_grading_decision": True},
        format="json",
    )

    assert response.status_code == 400
    assert "can_make_final_grading_decision" in response.json()["error"]["fields"]
    target = User.objects.get(pk=created["id"])
    assert target.has_perm(FINAL_GRADING_DECISION_PERMISSION) is False


def test_granting_other_authority_to_an_administrator_still_works() -> None:
    # Only final-decision authority is refused for administrators - "admins
    # having everything else" was explicit.
    client, _admin = admin_client("admin-other-authority-grantor@example.com")
    created = create_user_via_api(
        client,
        email="admin-other-authority-target@example.com",
        role=User.Role.ADMINISTRATOR,
    )

    response = client.patch(
        f"/api/users/{created['id']}/authority/",
        {"can_promote_student": True, "can_override_locked_session": True},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["can_promote_student"] is True
    assert response.json()["can_override_locked_session"] is True


def test_promoting_a_master_authority_instructor_to_administrator_is_refused() -> None:
    client, _admin = admin_client("no-master-promotion-admin@example.com")
    created = create_user_via_api(
        client,
        email="master-cannot-become-admin@example.com",
    )
    client.patch(
        f"/api/users/{created['id']}/authority/",
        {"can_make_final_grading_decision": True},
        format="json",
    )

    response = client.patch(
        f"/api/users/{created['id']}/",
        {"role": User.Role.ADMINISTRATOR},
        format="json",
    )

    assert response.status_code == 400
    assert "role" in response.json()["error"]["fields"]
    target = User.objects.get(pk=created["id"])
    assert target.role == User.Role.INSTRUCTOR


# ---------------------------------------------------------------------------
# Password reset
# ---------------------------------------------------------------------------


def test_administrator_can_reset_another_users_password() -> None:
    client, _admin = admin_client("reset-password-admin@example.com")
    created = create_user_via_api(
        client,
        email="reset-target@example.com",
        password="kg-Original-Str0ng!",
    )

    response = client.post(
        f"/api/users/{created['id']}/set-password/",
        {"password": "kg-Replacement-Str0ng!"},
        format="json",
    )

    assert response.status_code == 204
    target = User.objects.get(pk=created["id"])
    assert target.check_password("kg-Replacement-Str0ng!") is True
    assert target.check_password("kg-Original-Str0ng!") is False


def test_weak_reset_password_is_rejected() -> None:
    client, _admin = admin_client("weak-reset-admin@example.com")
    created = create_user_via_api(client, email="weak-reset-target@example.com")

    response = client.post(
        f"/api/users/{created['id']}/set-password/",
        {"password": "12345678"},
        format="json",
    )

    assert response.status_code == 400
    assert "password" in response.json()["error"]["fields"]


def test_password_reset_is_recorded_without_leaking_the_password() -> None:
    client, _admin = admin_client("reset-audit-admin@example.com")
    created = create_user_via_api(client, email="reset-audit-target@example.com")

    client.post(
        f"/api/users/{created['id']}/set-password/",
        {"password": "kg-NewSecret-Value!"},
        format="json",
    )

    event = AuditEvent.objects.filter(
        entity_type="User",
        entity_id=created["id"],
        action=AuditAction.USER_UPDATED,
    ).latest("pk")
    assert "kg-NewSecret-Value!" not in event.summary
    assert "kg-NewSecret-Value!" not in str(event.metadata)


def test_new_password_actually_works_for_login() -> None:
    client, _admin = admin_client("reset-login-admin@example.com")
    created = create_user_via_api(
        client,
        email="reset-login-target@example.com",
        password="kg-Original-Login!",
    )
    client.post(
        f"/api/users/{created['id']}/set-password/",
        {"password": "kg-New-Login-Value!"},
        format="json",
    )

    old_login = APIClient().post(
        "/api/auth/login/",
        {"email": "reset-login-target@example.com", "password": "kg-Original-Login!"},
        format="json",
    )
    new_login = APIClient().post(
        "/api/auth/login/",
        {"email": "reset-login-target@example.com", "password": "kg-New-Login-Value!"},
        format="json",
    )

    assert old_login.status_code == 400
    assert new_login.status_code == 200


def test_search_and_role_filters_work() -> None:
    client, _admin = admin_client("filters-admin@example.com")
    create_user_via_api(
        client,
        email="alex.kim@example.com",
        first_name="Alex",
        last_name="Kim",
    )
    create_user_via_api(
        client,
        email="blair.diaz@example.com",
        first_name="Blair",
        last_name="Diaz",
        role=User.Role.ADMINISTRATOR,
    )

    by_search = client.get("/api/users/?search=kim").json()
    by_role = client.get(f"/api/users/?role={User.Role.ADMINISTRATOR}").json()
    unknown_role = client.get("/api/users/?role=nonsense").json()

    assert {r["email"] for r in by_search["results"]} == {"alex.kim@example.com"}
    assert "blair.diaz@example.com" in {r["email"] for r in by_role["results"]}
    assert "alex.kim@example.com" not in {r["email"] for r in by_role["results"]}
    assert unknown_role["count"] == 0


# ---------------------------------------------------------------------------
# Admin routes through the same services the API uses (KG-036)
# ---------------------------------------------------------------------------


def admin_operator_request(email: str) -> Any:
    request = RequestFactory().post("/admin/")
    request.user = User.objects.create_user(
        email=email,
        role=User.Role.ADMINISTRATOR,
    )
    return request


def test_admin_created_user_is_persisted_and_audited() -> None:
    # Previously ModelAdmin's default save persisted the user without ever
    # calling create_platform_user(), so USER_CREATED never fired.
    obj = User(
        email="admin-add-form@example.com",
        first_name="New",
        last_name="Person",
        role=User.Role.INSTRUCTOR,
        is_active=True,
    )
    model_admin = UserAdmin(User, admin.site)
    request = admin_operator_request("user-admin-creator@example.com")
    form = cast(
        ModelForm,
        SimpleNamespace(cleaned_data={"password1": "Str0ng-Passphrase!42"}),
    )

    model_admin.save_model(request, obj, form, False)

    assert obj.pk is not None
    persisted = User.objects.get(pk=obj.pk)
    assert persisted.check_password("Str0ng-Passphrase!42")
    assert persisted.is_staff is False
    assert persisted.is_superuser is False
    event = AuditEvent.objects.filter(
        action=AuditAction.USER_CREATED,
        entity_id=str(obj.pk),
    ).latest("occurred_at")
    assert event.actor == request.user


def test_admin_can_still_create_a_staff_or_superuser_account() -> None:
    # create_platform_user() deliberately refuses is_staff/is_superuser, the
    # same way the API does - admin must still be able to grant them
    # directly, since that is Django's own privilege system, not the API's.
    obj = User(
        email="admin-superuser-add@example.com",
        first_name="Super",
        last_name="User",
        role=User.Role.ADMINISTRATOR,
        is_active=True,
        is_staff=True,
        is_superuser=True,
    )
    model_admin = UserAdmin(User, admin.site)
    request = admin_operator_request("user-admin-superuser-creator@example.com")
    form = cast(
        ModelForm,
        SimpleNamespace(cleaned_data={"password1": "Str0ng-Passphrase!42"}),
    )

    model_admin.save_model(request, obj, form, False)

    persisted = User.objects.get(pk=obj.pk)
    assert persisted.is_staff is True
    assert persisted.is_superuser is True
    # Still exactly one audit event - granting is_staff/is_superuser is a
    # detail of the same creation, not a second action.
    assert (
        AuditEvent.objects.filter(
            action=AuditAction.USER_CREATED,
            entity_id=str(obj.pk),
        ).count()
        == 1
    )


def test_admin_user_update_is_audited() -> None:
    target = User.objects.create_user(
        email="admin-change-form@example.com",
        first_name="Before",
    )
    model_admin = UserAdmin(User, admin.site)
    target.first_name = "After"
    request = admin_operator_request("user-admin-updater@example.com")
    form = cast(ModelForm, SimpleNamespace(changed_data=["first_name"]))

    model_admin.save_model(request, target, form, True)

    target.refresh_from_db()
    assert target.first_name == "After"
    event = AuditEvent.objects.filter(
        action=AuditAction.USER_UPDATED,
        entity_id=str(target.pk),
    ).latest("occurred_at")
    assert event.actor == request.user


def test_admin_is_staff_only_change_is_not_blocked_by_the_service() -> None:
    # update_platform_user()'s no-op check only tracks the five API-writable
    # fields; is_staff is not one of them, so this must still persist even
    # though none of those five changed.
    target = User.objects.create_user(email="admin-staff-toggle@example.com")
    assert target.is_staff is False
    model_admin = UserAdmin(User, admin.site)
    target.is_staff = True
    request = admin_operator_request("user-admin-staff-toggler@example.com")
    form = cast(ModelForm, SimpleNamespace(changed_data=["is_staff"]))

    model_admin.save_model(request, target, form, True)

    target.refresh_from_db()
    assert target.is_staff is True


# ---------------------------------------------------------------------------
# Forced password change on onboarding / reset
# ---------------------------------------------------------------------------


def test_user_created_via_api_has_must_change_password_flag() -> None:
    client, _admin = admin_client("onboarding-admin@example.com")
    created = create_user_via_api(
        client,
        email="onboarded-staff@example.com",
        password="kg-InitialSecret123!",
    )
    assert created["must_change_password"] is True
    stored = User.objects.get(pk=created["id"])
    assert stored.must_change_password is True


def test_admin_set_password_forces_must_change_password() -> None:
    client, _admin = admin_client("reset-pw-admin@example.com")
    created = create_user_via_api(
        client,
        email="reset-forced@example.com",
        password="kg-InitialSecret123!",
    )
    target = User.objects.get(pk=created["id"])
    target.must_change_password = False
    target.save(update_fields=["must_change_password"])

    client.post(
        f"/api/users/{created['id']}/set-password/",
        {"password": "kg-ResetAdminPass123!"},
        format="json",
    )

    target.refresh_from_db()
    assert target.must_change_password is True


def test_user_changing_password_clears_must_change_password() -> None:
    user = create_user(
        email="force-change-target@example.com",
        password="kg-TemporaryPass123!",
        must_change_password=True,
    )
    client = APIClient()
    client.force_authenticate(user=user)

    me_resp = client.get("/api/auth/me/")
    assert me_resp.status_code == 200
    assert me_resp.json()["must_change_password"] is True

    change_resp = client.post(
        "/api/auth/change-password/",
        {
            "current_password": "kg-TemporaryPass123!",
            "new_password": "kg-BrandNewSecurePass123!",
        },
        format="json",
    )
    assert change_resp.status_code == 204

    user.refresh_from_db()
    assert user.must_change_password is False

    me_after = client.get("/api/auth/me/")
    assert me_after.json()["must_change_password"] is False
