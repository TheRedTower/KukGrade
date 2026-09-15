"""User account management, with audit recording.

Same shape as students/services.py and gradings/services.py: a thin function
per action, the audit call inline in the same transaction, one event per call
rather than one per changed field.
"""

from __future__ import annotations

from typing import Any

from django.contrib.auth.models import Permission
from django.db import transaction

from accounts.models import User
from accounts.permissions import (
    FINAL_GRADING_DECISION_PERMISSION,
    OVERRIDE_LOCKED_SESSION_PERMISSION,
    PROMOTE_STUDENT_PERMISSION,
)
from audit.models import AuditAction
from audit.recording import record

# Named once, so /api/auth/me/, the users API's authority sub-resource, and
# this module cannot each spell "the three sensitive permissions" differently.
AUTHORITY_PERMISSIONS: dict[str, str] = {
    "can_make_final_grading_decision": FINAL_GRADING_DECISION_PERMISSION,
    "can_promote_student": PROMOTE_STUDENT_PERMISSION,
    "can_override_locked_session": OVERRIDE_LOCKED_SESSION_PERMISSION,
}


def _snapshot(user: User) -> dict[str, Any]:
    return {
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "role": user.role,
        "is_active": user.is_active,
    }


@transaction.atomic
def create_platform_user(
    *,
    email: str,
    password: str,
    first_name: str = "",
    last_name: str = "",
    role: str | None = None,
    is_active: bool | None = None,
    actor: User | None = None,
) -> User:
    extra: dict[str, Any] = {"first_name": first_name, "last_name": last_name}
    if role is not None:
        extra["role"] = role
    if is_active is not None:
        extra["is_active"] = is_active
    # create_user() already calls full_clean(exclude=["password"]) and
    # save() itself; is_staff and is_superuser are not accepted here at
    # all, so this path can never hand out Django admin access.
    user = User.objects.create_user(email=email, password=password, **extra)
    record(
        AuditAction.USER_CREATED,
        user,
        f"User account created for {user.email}.",
        actor=actor,
        metadata={"role": user.role},
    )
    return user


@transaction.atomic
def update_platform_user(
    user: User,
    *,
    email: str | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
    role: str | None = None,
    is_active: bool | None = None,
    actor: User | None = None,
) -> User:
    # Read fresh from the database rather than snapshotting `user` as
    # received: Django admin's own save flow constructs the new field
    # values onto this exact instance before save_model() ever runs, so a
    # comparison against the argument as-is would always see the new value
    # on both sides. The API path is unaffected, since DRF passes the
    # unmodified instance.
    before = _snapshot(User.objects.get(pk=user.pk))

    if email is not None:
        user.email = email
    if first_name is not None:
        user.first_name = first_name
    if last_name is not None:
        user.last_name = last_name
    if role is not None:
        user.role = role
    if is_active is not None:
        user.is_active = is_active

    # User.save() does not call full_clean() itself - unlike every other
    # model in this codebase, it only normalises the email. create_user()
    # calls full_clean() explicitly before saving; this does the same for
    # updates, rather than changing the model's save() and risking an
    # unaudited effect on Django's own auth internals (set_password flows,
    # AbstractBaseUser.save() call sites) that this change has no reason to
    # touch.
    user.full_clean(exclude=["password"])
    user.save()

    after = _snapshot(user)
    if before == after:
        # A no-op PATCH writes nothing: an audit trail exists to show what
        # changed, and nothing did.
        return user

    record(
        AuditAction.USER_UPDATED,
        user,
        f"User account {user.email} updated.",
        actor=actor,
        metadata={"before": before, "after": after},
    )
    return user


def validate_authority_change(target: User, actor: User) -> None:
    from django.core.exceptions import ValidationError

    if target.pk == actor.pk:
        raise ValidationError(
            {
                "authority": [
                    "You cannot change your own authority. Ask another "
                    "administrator to make this change.",
                ],
            },
        )


@transaction.atomic
def set_user_authority(target: User, actor: User, **flags: bool | None) -> User:
    """Grant or revoke the three sensitive permissions.

    Not a role: granted per user so authority survives one person being
    unavailable, and self-granting is refused so an administrator cannot
    make themselves a Master unilaterally.
    """
    validate_authority_change(target, actor)

    before = {
        name: target.has_perm(perm) for name, perm in AUTHORITY_PERMISSIONS.items()
    }

    for name, value in flags.items():
        if value is None:
            continue
        app_label, codename = AUTHORITY_PERMISSIONS[name].split(".")
        permission = Permission.objects.get(
            codename=codename,
            content_type__app_label=app_label,
        )
        if value:
            target.user_permissions.add(permission)
        else:
            target.user_permissions.remove(permission)

    # Django caches computed permissions on the instance the first time
    # has_perm() is called, and .add()/.remove() on user_permissions does
    # not invalidate that cache. Recomputing `after` on `target` would
    # silently return the pre-change values even though the database is
    # correct - refetching is what makes the response the caller sees
    # actually reflect what was just written.
    refreshed = User.objects.get(pk=target.pk)
    after = {
        name: refreshed.has_perm(perm) for name, perm in AUTHORITY_PERMISSIONS.items()
    }

    if before != after:
        record(
            AuditAction.USER_AUTHORITY_CHANGED,
            refreshed,
            f"Authority changed for {refreshed.email}.",
            actor=actor,
            metadata={"before": before, "after": after},
        )
    return refreshed


def record_password_reset(user: User, actor: User | None = None) -> None:
    # Sensitive per AGENTS.md, so it is recorded - but the value itself
    # must never appear in metadata or the summary.
    record(
        AuditAction.USER_UPDATED,
        user,
        f"Password reset for {user.email}.",
        actor=actor,
    )
