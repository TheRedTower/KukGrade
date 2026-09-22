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

from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from accounts.models import User

INSTRUCTOR_GROUP = "Instructor"
ADMINISTRATOR_GROUP = "Administrator"

# Everything to do with running a grading. Students are never deleted - every
# relationship to them is PROTECT - so no delete_student here. Ranks and the
# syllabus are read-only until syllabus versioning lands in Phase 2b.
_KUK_SOOL_PERMISSIONS: tuple[tuple[str, str], ...] = (
    ("students", "view_student"),
    ("students", "add_student"),
    ("students", "change_student"),
    ("ranks", "view_rank"),
    ("syllabus", "view_syllabusitem"),
    ("syllabus", "view_syllabusrequirement"),
    ("gradings", "view_gradingsession"),
    ("gradings", "add_gradingsession"),
    ("gradings", "change_gradingsession"),
    ("gradings", "delete_gradingsession"),
    ("gradings", "view_gradingcandidate"),
    ("gradings", "add_gradingcandidate"),
    ("gradings", "change_gradingcandidate"),
    ("gradings", "delete_gradingcandidate"),
    ("gradings", "view_candidateassessment"),
    ("gradings", "add_candidateassessment"),
    ("gradings", "change_candidateassessment"),
    ("gradings", "view_candidateassessmentitem"),
    ("gradings", "change_candidateassessmentitem"),
    ("gradings", "view_candidateoutcome"),
    ("gradings", "add_candidateoutcome"),
    ("gradings", "change_candidateoutcome"),
    ("gradings", "view_promotion"),
    # Historical grading visibility matches native grading visibility
    # (Decision 15 of the import spec) - both roles may view imported
    # legacy records; only an administrator may import/reconcile/void one
    # (_LEGACY_GRADING_RECONCILIATION_PERMISSIONS below).
    ("gradings", "view_legacygradingrecord"),
    # Deliberately not "audit", "view_auditevent" here: audit log access is
    # administrator-or-Master (accounts.permissions.CanViewAuditLog), a
    # narrower cut than either role group, so no group grants it at all.
)

# Administrators additionally manage people. Logistics beyond Kuk Sool.
_USER_ADMINISTRATION_PERMISSIONS: tuple[tuple[str, str], ...] = (
    ("accounts", "view_user"),
    ("accounts", "add_user"),
    ("accounts", "change_user"),
    ("accounts", "delete_user"),
)

# Hard-delete of grading records, for corruption or test-data cleanup only.
# Deliberately narrower than _KUK_SOOL_PERMISSIONS, which both groups share:
# an instructor can create and correct grading data, but only an
# administrator can make it disappear. See gradings.services for the
# cascade/attribution handling this gates.
_DATA_CLEANUP_PERMISSIONS: tuple[tuple[str, str], ...] = (
    ("gradings", "delete_candidateassessment"),
    ("gradings", "delete_candidateoutcome"),
    ("gradings", "delete_promotion"),
)

# Bulk data import (student rosters, and later legacy grading workbooks).
# Administrator-only by decision - see the Definitive Implementation Spec's
# Decision 1 and docs/decision_log.md. "can_commit_import" is a custom
# permission (ImportBatch.Meta.permissions) rather than the auto-generated
# "change_importbatch", so upload/preview can be separated from the
# irreversible act of actually creating students.
_DATA_IMPORT_PERMISSIONS: tuple[tuple[str, str], ...] = (
    ("data_imports", "view_importbatch"),
    ("data_imports", "add_importbatch"),
    ("data_imports", "change_importbatch"),
    ("data_imports", "can_commit_import"),
)

# Link/unlink/resolve-rank/void a historical record - Administrator-only
# (Decision 1/15 of the import spec), distinct from view_legacygradingrecord
# above so an instructor can read imported history without being able to
# correct it.
_LEGACY_GRADING_RECONCILIATION_PERMISSIONS: tuple[tuple[str, str], ...] = (
    ("gradings", "can_reconcile_imported_history"),
)

GROUP_PERMISSIONS: dict[str, tuple[tuple[str, str], ...]] = {
    INSTRUCTOR_GROUP: _KUK_SOOL_PERMISSIONS,
    ADMINISTRATOR_GROUP: (
        _KUK_SOOL_PERMISSIONS
        + _USER_ADMINISTRATION_PERMISSIONS
        + _DATA_CLEANUP_PERMISSIONS
        + _DATA_IMPORT_PERMISSIONS
        + _LEGACY_GRADING_RECONCILIATION_PERMISSIONS
    ),
}

# Deliberately in no group. These are granted per user, so that an instructor
# or an administrator can hold them without changing what their role means.
SENSITIVE_PERMISSIONS: tuple[str, ...] = (
    "gradings.can_make_final_grading_decision",
    "gradings.can_promote_student",
    "gradings.can_override_locked_session",
    "gradings.can_view_grading_audit_log",
)


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

    for app_config in django_apps.get_app_configs():
        create_permissions(app_config, verbosity=0, using=using or "default")

    for name, specs in GROUP_PERMISSIONS.items():
        group, _created = Group.objects.get_or_create(name=name)
        permissions = [
            permission
            for app_label, codename in specs
            if (
                permission := Permission.objects.filter(
                    content_type__app_label=app_label,
                    codename=codename,
                ).first()
            )
            is not None
        ]
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
