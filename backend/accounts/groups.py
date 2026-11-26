"""Role groups and the permissions they carry.

Django permissions are KukGrade's authority primitive. `User.role` is a label
that decides which group a user belongs to; it is never consulted when
authorising a request. Anything that needs finer control than a group - final
grading decisions, promotions - is a permission granted to an individual user
regardless of their group, so Master authority survives one person being away.

This module is the single source of truth. `sync_role_groups` runs on
post_migrate, so groups are correct in development, CI and production without
a manual step.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from django.core.exceptions import ImproperlyConfigured

if TYPE_CHECKING:  # pragma: no cover
    from accounts.models import User

INSTRUCTOR_GROUP = "Instructor"
ADMINISTRATOR_GROUP = "Administrator"


@dataclass(frozen=True)
class Grant:
    """A set of permissions a role is given together, and what it lets the
    holder do: each is one row of the table in docs/features.md
    (accounts.permissions_table)."""

    words: str
    permissions: tuple[tuple[str, str], ...]


# Everything to do with running a grading, in three parts. Ranks and the
# syllabus are read-only while syllabus versioning is deferred.
_VIEW = Grant(
    "View ranks, syllabus, students, history",
    (
        ("students", "view_student"),
        ("ranks", "view_rank"),
        ("syllabus", "view_syllabusrequirement"),
        ("gradings", "view_gradingsession"),
        ("gradings", "view_gradingcandidate"),
        ("gradings", "view_candidateassessment"),
        ("gradings", "view_candidateassessmentitem"),
        ("gradings", "view_candidateoutcome"),
        ("gradings", "view_promotion"),
        # Imported history is read like native history; only an
        # administrator imports, reconciles or voids it (_IMPORT below).
        ("gradings", "view_legacygradingrecord"),
        # Deliberately not "audit", "view_auditevent": instructors read the
        # log only through a per-user grant (accounts.permissions.AUDIT_LOG_GRANTS).
    ),
)

# Deleting a student or a session is not here: every relationship to a
# Student is PROTECT, so it goes through a service, and only an
# administrator deletes (_DATA_CLEANUP below). An instructor cancels.
_RUN_GRADINGS = Grant(
    "Add and edit students; manage sessions, candidates and assessments",
    (
        ("students", "add_student"),
        ("students", "change_student"),
        ("gradings", "add_gradingsession"),
        ("gradings", "change_gradingsession"),
        ("gradings", "add_gradingcandidate"),
        ("gradings", "change_gradingcandidate"),
        ("gradings", "delete_gradingcandidate"),
        ("gradings", "add_candidateassessment"),
        ("gradings", "change_candidateassessment"),
        ("gradings", "change_candidateassessmentitem"),
    ),
)

_PROPOSE = Grant(
    "Propose or revise an outcome",
    (
        ("gradings", "add_candidateoutcome"),
        ("gradings", "change_candidateoutcome"),
    ),
)

# Administrators additionally manage people.
_USER_ADMINISTRATION = Grant(
    "Manage users, roles and authority",
    (
        ("accounts", "view_user"),
        ("accounts", "add_user"),
        ("accounts", "change_user"),
    ),
)

# Bulk data import (student rosters and past grading workbooks), and
# correcting what was imported. "can_commit_import" is a custom permission
# (ImportBatch.Meta.permissions) rather than "change_importbatch", so
# upload and preview are apart from the irreversible act of creating
# students; reconciling is apart from view_legacygradingrecord, so an
# instructor reads imported history without correcting it.
_IMPORT = Grant(
    "Import student rosters and past gradings; reconcile imported history",
    (
        ("data_imports", "view_importbatch"),
        ("data_imports", "add_importbatch"),
        ("data_imports", "change_importbatch"),
        ("data_imports", "can_commit_import"),
        ("gradings", "can_reconcile_imported_history"),
    ),
)

# An instructor creates and corrects grading data; only an administrator
# deletes it. Deleting never erases a final decision, and a student or
# account with history is kept rather than erased (gradings.services,
# students.services, accounts.services). Archiving rests on the same grant.
_DATA_CLEANUP = Grant(
    "Delete a user or student, or an assessment or session without final "
    "decisions; archive or restore a completed or cancelled session",
    (
        ("accounts", "delete_user"),
        ("gradings", "delete_any_gradingsession"),
        ("gradings", "delete_candidateassessment"),
        ("students", "delete_student"),
    ),
)

SHARED_GRANTS: tuple[Grant, ...] = (_VIEW, _RUN_GRADINGS, _PROPOSE)
ADMINISTRATOR_GRANTS: tuple[Grant, ...] = (_USER_ADMINISTRATION, _IMPORT, _DATA_CLEANUP)

ROLE_GRANTS: dict[str, tuple[Grant, ...]] = {
    INSTRUCTOR_GROUP: SHARED_GRANTS,
    ADMINISTRATOR_GROUP: SHARED_GRANTS + ADMINISTRATOR_GRANTS,
}

GROUP_PERMISSIONS: dict[str, tuple[tuple[str, str], ...]] = {
    name: tuple(permission for grant in grants for permission in grant.permissions)
    for name, grants in ROLE_GRANTS.items()
}
# The administrator reads the whole audit log (accounts.permissions.
# AUDIT_LOG_GRANTS, which the table's audit-log row is drawn from).
GROUP_PERMISSIONS[ADMINISTRATOR_GROUP] += (("audit", "view_auditevent"),)

# The per-user authority permissions (accounts.permissions.AUTHORITY_PERMISSIONS)
# are deliberately in no group: an instructor or administrator holds them
# without that changing what their role means.


def group_for_role(role: str) -> str:
    from accounts.models import User

    if role == User.Role.ADMINISTRATOR:
        return ADMINISTRATOR_GROUP
    return INSTRUCTOR_GROUP


def sync_role_groups(using: str | None = None) -> None:
    """Create the role groups and set their permissions to match this module.

    Permissions are materialised first. `post_migrate` is sent once per app
    config, and receivers run in registration order - `accounts` is first in
    INSTALLED_APPS, so this receiver is registered before
    `django.contrib.auth` registers `create_permissions` and therefore runs
    before it on every send, including the last one. Without this the groups
    would only ever pick up whichever permissions happened to exist already.
    """
    from django.apps import apps as django_apps
    from django.contrib.auth.management import create_permissions
    from django.contrib.auth.models import Group, Permission

    database = using or "default"
    for app_config in django_apps.get_app_configs():
        create_permissions(app_config, verbosity=0, using=database)

    for name, specs in GROUP_PERMISSIONS.items():
        group, _created = Group.objects.using(database).get_or_create(name=name)
        permissions = []
        for app_label, codename in specs:
            permission = (
                Permission.objects.using(database)
                .filter(
                    content_type__app_label=app_label,
                    codename=codename,
                )
                .first()
            )
            if permission is None:
                # Every permission was just created, so a missing one is a
                # misspelt grant: refusing here is noticed at once, where
                # skipping it would leave the whole role quietly without it.
                msg = (
                    f"The {name} group names {app_label}.{codename}, "
                    "which does not exist."
                )
                raise ImproperlyConfigured(msg)
            permissions.append(permission)
        group.permissions.set(permissions)


def apply_role_group(user: User) -> None:
    """Put a user in the group their role names, and no other role group."""
    from django.contrib.auth.models import Group

    target = group_for_role(user.role)
    for name in GROUP_PERMISSIONS:
        group, _created = Group.objects.get_or_create(name=name)
        if name == target:
            user.groups.add(group)
        else:
            user.groups.remove(group)
