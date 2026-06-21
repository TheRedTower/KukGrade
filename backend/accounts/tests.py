from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework.views import APIView

from accounts.models import User
from accounts.permissions import (
    CanMakeFinalGradingDecision,
    IsAdministrator,
    IsAuthenticatedUser,
    IsInstructorOrAbove,
    IsManagerOrAdministrator,
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
        email="manager@example.com",
        password="StrongPass123!",
        role=User.Role.MANAGER,
    )
    client = APIClient(enforce_csrf_checks=True)
    token = csrf_token(client)

    response = client.post(
        "/api/auth/login/",
        {"email": "MANAGER@example.com", "password": "StrongPass123!"},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )

    assert response.status_code == 200
    assert response.json()["email"] == "manager@example.com"
    assert response.json()["role"] == User.Role.MANAGER
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


def test_role_permission_classes_against_all_roles() -> None:
    instructor = create_user("instructor@example.com", role=User.Role.INSTRUCTOR)
    manager = create_user("manager@example.com", role=User.Role.MANAGER)
    administrator = create_user(
        "administrator@example.com",
        role=User.Role.ADMINISTRATOR,
    )

    assert permission_result(IsAuthenticatedUser, None) is False
    assert permission_result(IsAuthenticatedUser, instructor) is True

    assert permission_result(IsInstructorOrAbove, instructor) is True
    assert permission_result(IsInstructorOrAbove, manager) is True
    assert permission_result(IsInstructorOrAbove, administrator) is True

    assert permission_result(IsManagerOrAdministrator, instructor) is False
    assert permission_result(IsManagerOrAdministrator, manager) is True
    assert permission_result(IsManagerOrAdministrator, administrator) is True

    assert permission_result(IsAdministrator, instructor) is False
    assert permission_result(IsAdministrator, manager) is False
    assert permission_result(IsAdministrator, administrator) is True


def test_final_grading_decision_capability_is_independent_of_role() -> None:
    instructor_master = create_user(
        "instructor-master@example.com",
        role=User.Role.INSTRUCTOR,
        can_make_final_grading_decision=True,
    )
    administrator_without_capability = create_user(
        "administrator-no-capability@example.com",
        role=User.Role.ADMINISTRATOR,
        can_make_final_grading_decision=False,
    )

    assert permission_result(CanMakeFinalGradingDecision, instructor_master) is True
    assert (
        permission_result(CanMakeFinalGradingDecision, administrator_without_capability)
        is False
    )


def test_inactive_users_fail_reusable_permissions() -> None:
    inactive = create_user("inactive@example.com", is_active=False)

    assert permission_result(IsAuthenticatedUser, inactive) is False
    assert permission_result(IsInstructorOrAbove, inactive) is False
    assert permission_result(IsManagerOrAdministrator, inactive) is False
    assert permission_result(IsAdministrator, inactive) is False
    assert permission_result(CanMakeFinalGradingDecision, inactive) is False


def test_configured_user_model_is_custom_user() -> None:
    assert get_user_model() is User
