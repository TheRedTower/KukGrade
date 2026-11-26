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

from collections import defaultdict
from collections.abc import Iterable

from django.contrib.auth.models import AnonymousUser, Permission
from django.db.models import F
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from accounts.models import User

FINAL_GRADING_DECISION_PERMISSION = "gradings.can_make_final_grading_decision"
PROMOTE_STUDENT_PERMISSION = "gradings.can_promote_student"
OVERRIDE_LOCKED_SESSION_PERMISSION = "gradings.can_override_locked_session"
GRADING_AUDIT_LOG_PERMISSION = "gradings.can_view_grading_audit_log"
AUDIT_LOG_PERMISSION = "audit.view_auditevent"
DELETE_ANY_SESSION_PERMISSION = "gradings.delete_any_gradingsession"
# Managing people: the Administrator group's own grant (accounts.groups).
USER_ADMINISTRATION_PERMISSION = "accounts.view_user"
# Checked by rules outside a permission_map (services, serializer flags and
# exports): named once here, so a typo is one place to look and the
# permission tests can prove each one exists.
CHANGE_SESSION_PERMISSION = "gradings.change_gradingsession"
DELETE_ASSESSMENT_PERMISSION = "gradings.delete_candidateassessment"
VIEW_PROMOTION_PERMISSION = "gradings.view_promotion"
DELETE_STUDENT_PERMISSION = "students.delete_student"
IMPORT_DATA_PERMISSION = "data_imports.add_importbatch"
RECONCILE_IMPORTED_HISTORY_PERMISSION = "gradings.can_reconcile_imported_history"

# The per-user authority flags, keyed the way /api/auth/me/ and the users
# API's authority sub-resource spell them. Deliberately in no role group
# (see accounts/groups.py): granted per user, so authority survives one
# person being away and never arrives as a side effect of a role change.
AUTHORITY_PERMISSIONS: dict[str, str] = {
    "can_make_final_grading_decision": FINAL_GRADING_DECISION_PERMISSION,
    "can_promote_student": PROMOTE_STUDENT_PERMISSION,
    "can_override_locked_session": OVERRIDE_LOCKED_SESSION_PERMISSION,
    "can_view_grading_audit_log": GRADING_AUDIT_LOG_PERMISSION,
}

# The authorities' keys, as a choice set the contract can name.
AUTHORITY_KEYS: tuple[str, ...] = tuple(AUTHORITY_PERMISSIONS)

# "Authorised Master" is these three; the grading audit log is a per-user
# grant but not Master authority.
MASTER_AUTHORITY_KEYS: tuple[str, ...] = (
    "can_make_final_grading_decision",
    "can_promote_student",
    "can_override_locked_session",
)

# Any one of these lets a person read the audit log: the Administrator
# group's grant, Master authority, or the grantable audit-log permission.
AUDIT_LOG_GRANTS: tuple[str, ...] = (
    AUDIT_LOG_PERMISSION,
    FINAL_GRADING_DECISION_PERMISSION,
    GRADING_AUDIT_LOG_PERMISSION,
)

# What each authority is called and does, as every screen words it.
AUTHORITY_WORDS: dict[str, tuple[str, str]] = {
    "can_make_final_grading_decision": (
        "Make final grading decisions",
        "Allow this user to make final decisions on student gradings.",
    ),
    "can_promote_student": (
        "Promote students",
        "Allow this user to promote students to the next rank.",
    ),
    "can_override_locked_session": (
        "Override locked sessions",
        "Allow this user to withdraw candidates from, or cancel, a locked session.",
    ),
    "can_view_grading_audit_log": (
        "View grading audit log",
        "Allow this user to see grading, syllabus and assessment audit events "
        "(not user management).",
    ),
}


# Which roles each authority may be granted to. Final grading decisions are
# never an administrator's: "administrators do everything" means running the
# school, not deciding gradings. The services refuse a grant (and a role
# change) that breaks this, and the screens grey out what it rules out
# (served through /api/choices/), so the rule is stated here only.
AUTHORITY_ROLES: dict[str, frozenset[str]] = {
    **{key: frozenset(User.Role.values) for key in AUTHORITY_KEYS},
    "can_make_final_grading_decision": frozenset({User.Role.INSTRUCTOR}),
}


def authority_grantable_to(key: str, role: str) -> bool:
    """Whether the authority `key` may be held by an account of `role`."""
    return role in AUTHORITY_ROLES[key]


def prime_permission_cache(users: Iterable[User]) -> None:
    """Load the listed users' permissions in two queries, not two each.

    `has_perm` asks the auth backend, which reads a user's direct and group
    permissions on first use and keeps them on the instance as `_perm_cache`.
    Serialising a page of users asks for several flags each, so this fills
    that cache up front with the same two reads for everyone. Active
    superusers and inactive users never reach the backend (`has_perm`
    answers them itself), so they are skipped.
    """
    pending = {
        user.pk: user
        for user in users
        if user.is_active and not user.is_superuser and not hasattr(user, "_perm_cache")
    }
    if not pending:
        return
    granted: defaultdict[object, set[str]] = defaultdict(set)
    sources = (
        ("user", Permission.objects.filter(user__in=pending)),
        ("group__user", Permission.objects.filter(group__user__in=pending)),
    )
    for owner, permissions in sources:
        for user_id, app_label, codename in permissions.values_list(
            F(owner),
            "content_type__app_label",
            "codename",
        ):
            granted[user_id].add(f"{app_label}.{codename}")
    for user_id, user in pending.items():
        user._perm_cache = granted[user_id]  # type: ignore[attr-defined]


def can_view_audit_log(user: User) -> bool:
    """Whether the user holds any of `AUDIT_LOG_GRANTS`.

    The one statement of this rule: the API (`CanViewAuditLog`) and Django
    admin (`audit.admin.AuditEventAdmin`) both ask it.
    """
    # has_perm refuses a closed account everything, superusers included.
    return any(user.has_perm(permission) for permission in AUDIT_LOG_GRANTS)


def can_see_school_settings(user: User) -> bool:
    """Whoever administers the school's accounts also sees how it is set up
    (the About page): the Administrator group's grant, not the role label."""
    return user.has_perm(USER_ADMINISTRATION_PERMISSION)


def _active_user(request: Request) -> User | None:
    user = request.user
    if isinstance(user, AnonymousUser) or not user.is_authenticated:
        return None
    if not isinstance(user, User) or not user.is_active:
        return None
    return user


# What a refusal says when the missing permission is one of the per-user
# authorities, so the person is told which authority the action needs.
AUTHORITY_REFUSALS: dict[str, str] = {
    FINAL_GRADING_DECISION_PERMISSION: "Final grading decision authority is required.",
    PROMOTE_STUDENT_PERMISSION: "Student promotion authority is required.",
    OVERRIDE_LOCKED_SESSION_PERMISSION: (
        "Locked session override authority is required."
    ),
}


class HasRequiredPermissions(BasePermission):
    """Require the permissions a view declares for the current action.

    Views set `permission_map`, an action name to a tuple of permission
    strings, every one of which is required - the per-user authorities
    included, so an action's whole rule is in one place. An empty tuple means
    "authenticated is enough". A missing action is denied.
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

        # A method a view has deliberately excluded via http_method_names
        # (e.g. PUT on a PATCH-only viewset) must answer 405, not 403.
        # DRF's router still binds 'put' to whatever method the relevant
        # mixin provides regardless of http_method_names, so `view.action`
        # is a real, bound action here - not None - and would otherwise be
        # denied as undeclared. Checked ahead of the action lookup so it
        # takes priority over "undeclared action" for exactly this case.
        method = (request.method or "").lower()
        allowed_methods = getattr(view, "http_method_names", None)
        if allowed_methods is not None and method not in allowed_methods:
            return True

        action = getattr(view, "action", None)
        if action is None:
            # The HTTP method is not routed to any action at all, so there
            # is no handler and DRF will answer 405. Denying here would
            # turn an honest "that method does not exist" into a
            # misleading 403. Guarded to ViewSets: an APIView has no
            # action_map, and allowing one through would open it to every
            # authenticated user, which is the opposite of failing closed.
            return hasattr(view, "action_map")
        if action not in permission_map:
            return False

        for permission in permission_map[action]:
            if not user.has_perm(permission):
                # An instance per request, so the message is this refusal's.
                self.message = AUTHORITY_REFUSALS.get(permission, self.message)
                return False
        return True


class CanViewAuditLog(BasePermission):
    """Logistics access plus Master authority, not every instructor.

    Administrators see it as part of running the school; a Master sees it
    because they are the one who adjudicates the decisions it records. An
    instructor granted `can_view_grading_audit_log` sees it for the same
    reason on a smaller scale - retrospective accountability for grading and
    syllabus decisions - without that grant implying anything about user
    management, which stays behind `accounts.view_user` in the queryset
    filter (see `audit/views.py`). A plain instructor holding none of the
    three is refused, even though they can still act on most of what the log
    describes.
    """

    message = "Audit log access requires administrator or grading audit authority."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = _active_user(request)
        return user is not None and can_view_audit_log(user)
