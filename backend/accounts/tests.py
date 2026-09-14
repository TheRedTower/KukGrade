from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser, Permission
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework.views import APIView

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


def test_current_user_requires_authentication() -> None:
    response = APIClient().get("/api/auth/me/")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "authentication_required"


def test_current_user_returns_authenticated_user() -> None:
    user = create_user(
        email="current@example.com",
        first_name="Current",
        last_name="User",
        can_make_final_grading_decision=True,
    )
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
        "can_make_final_grading_decision": True,
        "is_staff": False,
        "is_superuser": False,
    }


def test_logout_clears_session() -> None:
    user = create_user(email="logout@example.com")
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.post("/api/auth/logout/")

    assert response.status_code == 204


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
        can_make_final_grading_decision=False,
    )
    legacy_boolean_only = create_user(
        "legacy-boolean-only@example.com",
        can_make_final_grading_decision=True,
    )
    superuser = User.objects.create_superuser("permission-superuser@example.com")

    assert permission_result(CanMakeFinalGradingDecision, instructor_master) is True
    assert (
        permission_result(CanMakeFinalGradingDecision, administrator_without_capability)
        is False
    )
    assert permission_result(CanMakeFinalGradingDecision, legacy_boolean_only) is False
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
