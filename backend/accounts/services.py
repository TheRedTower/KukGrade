"""User account management, with audit recording.

Same shape as students/services.py and gradings/services.py: a thin function
per action, the audit call inline in the same transaction, one event per call
rather than one per changed field.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID

from django.conf import settings
from django.contrib.auth.models import Permission
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.utils import timezone

from accounts.models import User
from accounts.password_policy import generate_temporary_password
from accounts.permissions import (
    AUTHORITY_PERMISSIONS,
    FINAL_GRADING_DECISION_PERMISSION,
)
from audit.models import AuditAction
from audit.recording import record


def _lock_user(user_id: UUID) -> User:
    """The account row, locked and re-read - a fresh instance, so has_perm()
    has no stale permission cache either."""
    locked = User.objects.select_for_update().filter(pk=user_id).first()
    if locked is None:
        raise ValidationError({"user": ["This user no longer exists."]})
    return locked


def _snapshot(user: User) -> dict[str, Any]:
    return {
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "role": user.role,
        "is_active": user.is_active,
    }


SUPERUSER_ONLY_MESSAGE = "Only a superuser can change this account."
OWN_ROLE_OR_STATUS_MESSAGE = "You cannot change your own role or account status."
DELETED_ACCOUNT_MESSAGE = "This account has been deleted and cannot be changed."


def can_manage(target: User, actor: User) -> bool:
    """Whether `actor` may change `target` at all (2026-10-20).

    An account that can use the Django admin site - a superuser's, or one a
    superuser gave `is_staff` - is changed only by a superuser: its details,
    role, status, authority, password and existence. Anyone less could
    otherwise take it over, lock it out or delete it. Your own account has
    rules of its own: no role or status change (update_platform_user), no
    reset, authority change or deletion.
    """
    if target.deleted_at is not None:
        return False
    if target.pk == actor.pk:
        return True
    return actor.is_superuser or not (target.is_staff or target.is_superuser)


def _validate_not_deleted(target: User) -> None:
    """A deleted account is closed for good, on every path that writes to it
    - the app, and the Django admin's recovery forms alike - so it can never
    be reactivated or given a password again."""
    if target.deleted_at is not None:
        raise ValidationError({"user": [DELETED_ACCOUNT_MESSAGE]})


def _validate_can_manage(target: User, actor: User) -> None:
    _validate_not_deleted(target)
    if not can_manage(target, actor):
        raise ValidationError({"user": [SUPERUSER_ONLY_MESSAGE]})


@dataclass(frozen=True)
class TemporaryPassword:
    """A temporary password just issued, for the administrator to pass on.

    The plaintext exists only here, on its way to the one response that shows
    it: only its hash is stored, and it is never logged or audited.
    """

    user: User
    # Out of the repr, so a log line or traceback that prints this cannot
    # print the password.
    password: str = field(repr=False)


def _temporary_password_expiry() -> datetime:
    return timezone.now() + settings.TEMPORARY_PASSWORD_LIFETIME


@transaction.atomic
def create_platform_user(
    *,
    email: str,
    first_name: str = "",
    last_name: str = "",
    role: str | None = None,
    is_active: bool | None = None,
    actor: User | None = None,
) -> TemporaryPassword:
    """A new account with a generated temporary password, which expires and
    which its owner must replace at their first sign-in."""
    if User.objects.filter(
        email=User.objects.normalize_email(email),
        deleted_at__isnull=False,
    ).exists():
        raise ValidationError(
            {
                "email": [
                    "This email belonged to an account that was deleted. Its "
                    "records still carry it, so use another email.",
                ],
            },
        )
    expires_at = _temporary_password_expiry()
    extra: dict[str, Any] = {
        "first_name": first_name,
        "last_name": last_name,
        "must_change_password": True,
        "temporary_password_expires_at": expires_at,
    }
    if role is not None:
        extra["role"] = role
    if is_active is not None:
        extra["is_active"] = is_active
    # Built unsaved from the submitted details, so the similarity check has
    # the new account's own name and email to compare against.
    password = generate_temporary_password(
        User(
            email=User.objects.normalize_email(email),
            first_name=first_name,
            last_name=last_name,
        ),
    )
    # create_user() already calls full_clean(exclude=["password"]) and
    # save() itself; is_staff and is_superuser are not accepted here at
    # all, so this path can never hand out Django admin access.
    user = User.objects.create_user(email=email, password=password, **extra)
    record(
        AuditAction.USER_CREATED,
        user,
        f"User account created for {user.email}.",
        actor=actor,
        metadata={
            "role": user.role,
            "temporary_password_expires_at": expires_at.isoformat(),
        },
    )
    return TemporaryPassword(user, password)


def _granted(user: User, permission: str) -> bool:
    """Whether `permission` was granted to `user`, directly or by a group.

    Unlike has_perm(), not true for a superuser by default.
    """
    app_label, codename = permission.split(".")
    held = Permission.objects.filter(
        content_type__app_label=app_label,
        codename=codename,
    )
    return held.filter(user=user).exists() or held.filter(group__user=user).exists()


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
    # Only `user`'s id is used. The API loaded it before this transaction
    # began (for PATCH /api/auth/me/ it is request.user itself), and Django
    # admin has already written its form onto it, so saving it as received
    # wrote back every column - the password hash included - that another
    # request changed in the meantime. The locked row is also what
    # makes the Master check below race-proof: set_user_authority() takes the
    # same lock, so a role change and a Master grant cannot both read the
    # other's field as it was.
    locked = _lock_user(user.pk)
    before = _snapshot(locked)

    # Checked against the grant itself, and only when the role is actually
    # changing: has_perm() is true for every superuser, so it refused any
    # edit that resent a superuser's unchanged administrator role.
    if (
        role == User.Role.ADMINISTRATOR
        and locked.role != User.Role.ADMINISTRATOR
        and _granted(locked, FINAL_GRADING_DECISION_PERMISSION)
    ):
        raise ValidationError(
            {
                "role": [
                    "This user holds final grading decision authority and "
                    "cannot become an administrator. Revoke that authority "
                    "first.",
                ],
            },
        )

    if email is not None:
        locked.email = email
    if first_name is not None:
        locked.first_name = first_name
    if last_name is not None:
        locked.last_name = last_name
    if role is not None:
        locked.role = role
    if is_active is not None:
        locked.is_active = is_active

    # User.save() does not call full_clean() itself - unlike every other
    # model in this codebase, it only normalises the email. create_user()
    # calls full_clean() explicitly before saving; this does the same for
    # updates, rather than changing the model's save() and risking an
    # unaudited effect on Django's own auth internals (set_password flows,
    # AbstractBaseUser.save() call sites) that this change has no reason to
    # touch.
    locked.full_clean(exclude=["password"])
    _validate_not_deleted(locked)

    after = _snapshot(locked)
    if before == after:
        # A no-op PATCH writes nothing: an audit trail exists to show what
        # changed, and nothing did.
        return locked
    if actor is not None:
        _validate_can_manage(locked, actor)
        # The screen never offers it, and the server refuses it too: nobody
        # demotes or deactivates themselves, so the last administrator
        # cannot leave the school with none.
        if locked.pk == actor.pk and (
            before["role"] != after["role"] or before["is_active"] != after["is_active"]
        ):
            raise ValidationError({"user": [OWN_ROLE_OR_STATUS_MESSAGE]})

    locked.save()
    record(
        AuditAction.USER_UPDATED,
        locked,
        f"User account {locked.email} updated.",
        actor=actor,
        metadata={"before": before, "after": after},
    )
    return locked


def has_recorded_work(user: User) -> bool:
    """Whether anything in the record names this account: every PROTECT
    foreign key to User is an attribution (who marked, decided, imported...),
    so this reads them all, including any added later."""
    for relation in User._meta.related_objects:
        if relation.on_delete is not models.PROTECT:
            continue
        related = relation.related_model
        if not isinstance(related, type):
            continue
        manager = related._default_manager
        if manager.filter(**{relation.field.name: user}).exists():
            return True
    return False


@transaction.atomic
def delete_platform_user(target: User, actor: User) -> bool:
    """Delete a staff account. Returns whether the row itself was removed.

    An account that recorded nothing is removed completely. One that did is
    closed instead (owner, 2026-11-07): it can no longer sign in, leaves the
    Users list and holds no authority, but the row stays, so every mark,
    comment, proposal and decision still names the person who made it.
    """
    if target.pk == actor.pk:
        raise ValidationError({"user": ["You cannot delete your own account."]})
    _validate_can_manage(target, actor)
    if target.is_deleted_user_placeholder:
        raise ValidationError(
            {"user": ["The deleted-user placeholder account cannot be deleted."]},
        )
    locked = User.objects.select_for_update().get(pk=target.pk)
    if locked.deleted_at is not None:
        raise ValidationError({"user": ["This account is already deleted."]})

    keep = has_recorded_work(locked)
    record(
        AuditAction.USER_DELETED,
        locked,
        (
            f"User account {locked.email} deleted; their name stays on what "
            "they recorded."
            if keep
            else f"User account {locked.email} deleted."
        ),
        actor=actor,
        metadata={
            "email": locked.email,
            "name": locked.get_full_name(),
            "role": locked.role,
            "kept_for_their_records": keep,
        },
    )
    if not keep:
        locked.delete()
        return True
    locked.deleted_at = timezone.now()
    locked.is_active = False
    locked.must_change_password = False
    locked.temporary_password_expires_at = None
    locked.set_unusable_password()
    locked.save()
    # Authority is per-user permissions; a closed account keeps none. (Its
    # role group is harmless: an inactive account holds no permission.)
    locked.user_permissions.clear()
    return False


def validate_authority_change(
    target: User,
    actor: User,
    **flags: bool | None,
) -> None:
    if target.pk == actor.pk:
        raise ValidationError(
            {
                "authority": [
                    "You cannot change your own authority. Ask another "
                    "administrator to make this change.",
                ],
            },
        )
    _validate_can_manage(target, actor)

    if (
        flags.get("can_make_final_grading_decision")
        and target.role == User.Role.ADMINISTRATOR
    ):
        raise ValidationError(
            {
                "can_make_final_grading_decision": [
                    "Administrators cannot hold final grading decision "
                    "authority - grant it to an instructor instead.",
                ],
            },
        )


@transaction.atomic
def set_user_authority(target: User, actor: User, **flags: bool | None) -> User:
    """Grant or revoke the per-user authority permissions.

    Not a role: granted per user so authority survives one person being
    unavailable, and self-granting is refused so an administrator cannot
    make themselves a Master unilaterally. Administrators are also refused
    final-decision authority outright: it belongs to instructors - as many
    Masters as the school has (2026-09-25) - with administrators holding
    everything else instead.

    Checked and changed on the locked row, the same lock
    update_platform_user() takes: a grant and a role change each read the
    other's field, so without it both could pass and commit.
    """
    target = _lock_user(target.pk)
    validate_authority_change(target, actor, **flags)

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


OWN_PASSWORD_RESET_MESSAGE = (
    "Change your own password in Settings, which asks for your current one."
)


def validate_can_reset_password(target: User, actor: User) -> None:
    """Whether `actor` may issue `target` a temporary password.

    Not your own: a reset asks for no current password, so on your own
    account it let whoever held a signed-in session replace the password and
    lock the owner out (audit F-04); change_own_password, behind the current
    password, is the way. And, as with every change, not an account that can
    use the Django admin site unless you are a superuser (can_manage): the
    temporary password signs in as that account.
    """
    if target.pk == actor.pk:
        raise ValidationError({"user": [OWN_PASSWORD_RESET_MESSAGE]})
    _validate_can_manage(target, actor)


@transaction.atomic
def reset_password(target: User, *, actor: User) -> TemporaryPassword:
    """Issue `target` a new temporary password, replacing whatever they had.

    Their old password stops working at once, as does any earlier temporary
    one; they must choose their own at next sign-in.
    """
    locked = _lock_user(target.pk)
    # On the locked row, so a change to its admin site access cannot slip in
    # between the check and the reset.
    validate_can_reset_password(locked, actor)
    password = generate_temporary_password(locked)
    locked.set_password(password)
    return TemporaryPassword(_password_set(locked, actor=actor), password)


@transaction.atomic
def change_own_password(user: User, *, password: str) -> User:
    """The owner's own new password, which lifts the forced change."""
    locked = _lock_user(user.pk)
    locked.set_password(password)
    return _password_set(locked, actor=user)


def _password_set(locked: User, *, actor: User) -> User:
    # A password its owner chose is theirs to keep; one someone else set is
    # temporary - it expires, and must be replaced at next sign-in. The owner
    # reaches this only through change_own_password: Django admin has no
    # password form for your own account (accounts/admin_site.py).
    _validate_not_deleted(locked)
    chosen_by_owner = locked.pk == actor.pk
    expires_at = None if chosen_by_owner else _temporary_password_expiry()
    locked.must_change_password = not chosen_by_owner
    locked.temporary_password_expires_at = expires_at
    # One transaction with the password itself, so the change and its record
    # land together or not at all. The value never appears in the
    # summary or metadata.
    locked.save(
        update_fields=[
            "password",
            "must_change_password",
            "temporary_password_expires_at",
        ],
    )
    record(
        AuditAction.USER_UPDATED,
        locked,
        (
            f"Password changed by {locked.email}."
            if chosen_by_owner
            else f"Password reset for {locked.email}."
        ),
        actor=actor,
        metadata=(
            {"temporary_password_expires_at": expires_at.isoformat()}
            if expires_at
            else {}
        ),
    )
    return locked


@transaction.atomic
def set_admin_site_access(
    target: User,
    *,
    actor: User,
    is_staff: bool | None = None,
    is_superuser: bool | None = None,
) -> User:
    """Django admin's own two flags, which the API never sets, audited like
    every other account change. Only a superuser grants or removes
    them - anyone else could make themselves one."""
    locked = _lock_user(target.pk)
    _validate_not_deleted(locked)
    before = {"is_staff": locked.is_staff, "is_superuser": locked.is_superuser}
    if is_staff is not None:
        locked.is_staff = is_staff
    if is_superuser is not None:
        locked.is_superuser = is_superuser
    after = {"is_staff": locked.is_staff, "is_superuser": locked.is_superuser}
    if before == after:
        return locked
    if not actor.is_superuser:
        raise ValidationError({"user": [SUPERUSER_ONLY_MESSAGE]})
    locked.save(update_fields=["is_staff", "is_superuser"])
    record(
        AuditAction.USER_UPDATED,
        locked,
        f"Admin site access changed for {locked.email}.",
        actor=actor,
        metadata={"before": before, "after": after},
    )
    return locked
