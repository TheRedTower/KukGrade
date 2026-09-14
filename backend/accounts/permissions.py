"""Request authorisation.

Django permissions are the authority primitive. A view declares, per action,
exactly which permissions it requires; anything not declared is denied. Failing
closed is deliberate - adding an endpoint without declaring its permissions
locks everyone out, which is noticed immediately, rather than silently opening
it to every authenticated user, which is not.

`User.role` is never consulted here. It decides group membership, and the group
carries the permissions. See `accounts/groups.py`.
"""

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


class HasRequiredPermissions(BasePermission):
    """Require the permissions a view declares for the current action.

    Views set `permission_map`, an action name to a tuple of permission
    strings. An empty tuple means "authenticated is enough". A missing action
    is denied.
    """

    message = "You do not have permission to perform this action."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = _active_user(request)
        if user is None:
            return False

        permission_map: dict[str, tuple[str, ...]] | None = getattr(
            view,
            "permission_map",
            None,
        )
        if permission_map is None:
            return False

        action = getattr(view, "action", None)
        if action is None:
            # The HTTP method is not routed to any action, so there is no
            # handler and DRF will answer 405. Denying here would turn an
            # honest "that method does not exist" into a misleading 403.
            # Guarded to ViewSets: an APIView has no action_map, and
            # allowing one through would open it to every authenticated
            # user, which is the opposite of failing closed.
            return hasattr(view, "action_map")
        if action not in permission_map:
            return False

        required = permission_map[action]
        return all(user.has_perm(permission) for permission in required)


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
    "FINAL_GRADING_DECISION_PERMISSION",
    "PROMOTE_STUDENT_PERMISSION",
    "CanMakeFinalGradingDecision",
    "CanPromoteStudent",
    "HasRequiredPermissions",
]
