from __future__ import annotations

from django.contrib.auth.models import AnonymousUser
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from accounts.models import User

FINAL_GRADING_DECISION_PERMISSION = "gradings.can_make_final_grading_decision"
PROMOTE_STUDENT_PERMISSION = "gradings.can_promote_student"


def _active_user(request: Request) -> User | None:
    user = request.user
    if isinstance(user, AnonymousUser) or not user.is_authenticated:
        return None
    if not isinstance(user, User) or not user.is_active:
        return None
    return user


class IsAuthenticatedUser(BasePermission):
    message = "Authentication is required."

    def has_permission(self, request: Request, view: APIView) -> bool:
        return _active_user(request) is not None


class IsInstructorOrAbove(BasePermission):
    message = "Instructor access or above is required."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = _active_user(request)
        return user is not None and user.role in {
            User.Role.INSTRUCTOR,
            User.Role.MANAGER,
            User.Role.ADMINISTRATOR,
        }


class IsManagerOrAdministrator(BasePermission):
    message = "Manager or administrator access is required."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = _active_user(request)
        return user is not None and user.role in {
            User.Role.MANAGER,
            User.Role.ADMINISTRATOR,
        }


class IsAdministrator(BasePermission):
    message = "Administrator access is required."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = _active_user(request)
        return user is not None and user.role == User.Role.ADMINISTRATOR


class CanMakeFinalGradingDecision(BasePermission):
    message = "Final grading decision authority is required."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = _active_user(request)
        return user is not None and user.has_perm(FINAL_GRADING_DECISION_PERMISSION)


class CanPromoteStudent(BasePermission):
    message = "Student promotion authority is required."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = _active_user(request)
        return user is not None and user.has_perm(PROMOTE_STUDENT_PERMISSION)


__all__ = [
    "CanMakeFinalGradingDecision",
    "CanPromoteStudent",
    "FINAL_GRADING_DECISION_PERMISSION",
    "IsAdministrator",
    "IsAuthenticatedUser",
    "IsInstructorOrAbove",
    "IsManagerOrAdministrator",
    "PROMOTE_STUDENT_PERMISSION",
]
