"""User account management, with audit recording.

Same shape as students/services.py and gradings/services.py: a thin function
per action, the audit call inline in the same transaction, one event per call
rather than one per changed field.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.contrib.auth.models import Permission
from django.core.exceptions import ValidationError
from django.db import models, transaction

from accounts.models import DELETED_USER_PLACEHOLDER_EMAIL, User
from accounts.permissions import (
    AUTHORITY_PERMISSIONS,
    FINAL_GRADING_DECISION_PERMISSION,
)
from audit.models import AuditAction, AuditEvent
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


@transaction.atomic
def create_platform_user(
    *,
    email: str,
    password: str,
    first_name: str = "",
    last_name: str = "",
    role: str | None = None,
    is_active: bool | None = None,
    must_change_password: bool = True,
    actor: User | None = None,
) -> User:
    extra: dict[str, Any] = {
        "first_name": first_name,
        "last_name": last_name,
        "must_change_password": must_change_password,
    }
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
    # Only `user`'s id is used. The API loaded it before this transaction
    # began (for PATCH /api/auth/me/ it is request.user itself), and Django
    # admin has already written its form onto it, so saving it as received
    # wrote back every column - the password hash included - that another
    # request changed in the meantime (KG-A12). The locked row is also what
    # makes the Master check below race-proof: set_user_authority() takes the
    # same lock, so a role change and a Master grant cannot both read the
    # other's field as it was.
    locked = _lock_user(user.pk)
    before = _snapshot(locked)

    if role == User.Role.ADMINISTRATOR and locked.has_perm(
        FINAL_GRADING_DECISION_PERMISSION,
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

    after = _snapshot(locked)
    if before == after:
        # A no-op PATCH writes nothing: an audit trail exists to show what
        # changed, and nothing did.
        return locked

    locked.save()
    record(
        AuditAction.USER_UPDATED,
        locked,
        f"User account {locked.email} updated.",
        actor=actor,
        metadata={"before": before, "after": after},
    )
    return locked


def get_deleted_user_placeholder() -> User:
    return User.objects.get(email=DELETED_USER_PLACEHOLDER_EMAIL)


@transaction.atomic
def delete_platform_user(target: User, actor: User) -> User:
    """Hard-delete a user account, for corruption or test-data cleanup only.

    Every attribution foreign key to User in this codebase is PROTECT
    specifically so that deleting a user can never erase who did something
    (see the comments on `audit.AuditEvent.actor` and
    `gradings.CandidateAssessmentItem.assessor`). Deleting the row outright
    would violate that, so every reference is reassigned to the "Deleted
    User" placeholder account first (seeded by
    accounts/migrations/0005_seed_deleted_user_placeholder.py) - the history
    stays intact and attributable to "a since-deleted account", just not to
    this specific person's row any more, which then has nothing left
    pointing at it and can actually be removed.

    Audit events, promotions, and finalised outcomes all refuse ordinary
    bulk updates - `AuditEventQuerySet.update()` and `PromotionQuerySet.
    update()` unconditionally raise, and `CandidateOutcomeQuerySet.update()`
    raises whenever a finalised outcome is in scope, by design, to keep
    those rows append-only/immutable against ordinary code paths. That
    protects against rewriting what happened; it was never meant to block
    this one narrow, admin-only case of moving whose account a historical
    `actor`/`promoted_by`/`proposed_by`/`decided_by` reference resolves to.
    `models.QuerySet.update` - the real, unbound base implementation - is
    therefore called directly for those models, bypassing the
    instance-level override on purpose. Every other field on the affected
    rows is untouched.
    """
    if target.pk == actor.pk:
        raise ValidationError({"user": ["You cannot delete your own account."]})

    placeholder = get_deleted_user_placeholder()
    if target.pk == placeholder.pk:
        raise ValidationError(
            {"user": ["The deleted-user placeholder account cannot be deleted."]},
        )

    from data_imports.models import ImportBatch
    from gradings.models import (
        CandidateAssessment,
        CandidateAssessmentItem,
        CandidateOutcome,
        GradingCandidate,
        GradingSession,
        LegacyGradingRecord,
        Promotion,
    )

    reassigned = {
        "grading_sessions_created": GradingSession.objects.filter(
            created_by=target,
        ).update(created_by=placeholder),
        "grading_candidates_withdrawn": GradingCandidate.objects.filter(
            withdrawn_by=target,
        ).update(withdrawn_by=placeholder),
        "assessments_generated": CandidateAssessment.objects.filter(
            generated_by=target,
        ).update(generated_by=placeholder),
        "outcomes_proposed": models.QuerySet.update(
            CandidateOutcome.objects.filter(proposed_by=target),
            proposed_by=placeholder,
        ),
        "outcomes_decided": models.QuerySet.update(
            CandidateOutcome.objects.filter(decided_by=target),
            decided_by=placeholder,
        ),
        "assessment_items_assessed": CandidateAssessmentItem.objects.filter(
            assessor=target,
        ).update(assessor=placeholder),
        "promotions_recorded": models.QuerySet.update(
            Promotion.objects.filter(promoted_by=target),
            promoted_by=placeholder,
        ),
        "audit_events_actored": models.QuerySet.update(
            AuditEvent.objects.filter(actor=target),
            actor=placeholder,
        ),
        "import_batches_uploaded": ImportBatch.objects.filter(
            uploaded_by=target,
        ).update(uploaded_by=placeholder),
        "import_batches_committed": ImportBatch.objects.filter(
            committed_by=target,
        ).update(committed_by=placeholder),
        "import_batches_cancelled": ImportBatch.objects.filter(
            cancelled_by=target,
        ).update(cancelled_by=placeholder),
        "legacy_grading_records_voided": models.QuerySet.update(
            LegacyGradingRecord.objects.filter(voided_by=target),
            voided_by=placeholder,
        ),
    }

    record(
        AuditAction.USER_DELETED,
        target,
        f"User account {target.email} deleted; historical attribution "
        "reassigned to the placeholder account.",
        actor=actor,
        metadata={
            "email": target.email,
            "name": target.get_full_name(),
            "role": target.role,
            "reassigned": reassigned,
        },
    )
    target.delete()
    return placeholder


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

    if (
        flags.get("can_make_final_grading_decision")
        and target.role == User.Role.ADMINISTRATOR
    ):
        raise ValidationError(
            {
                "can_make_final_grading_decision": [
                    "Administrators cannot hold final grading decision "
                    "authority. Only one designated Master should - grant "
                    "it to an instructor instead.",
                ],
            },
        )


@transaction.atomic
def set_user_authority(target: User, actor: User, **flags: bool | None) -> User:
    """Grant or revoke the per-user authority permissions.

    Not a role: granted per user so authority survives one person being
    unavailable, and self-granting is refused so an administrator cannot
    make themselves a Master unilaterally. Administrators are also refused
    final-decision authority outright - the confirmed policy is one
    designated Master, with administrators holding everything else instead.

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


@transaction.atomic
def reset_password(target: User, *, password: str, actor: User) -> User:
    """Set a password someone else chose, so its owner must replace it (unless
    the owner is the one setting it)."""
    locked = _lock_user(target.pk)
    locked.set_password(password)
    return _password_set(locked, actor=actor)


@transaction.atomic
def change_own_password(user: User, *, password: str) -> User:
    """The owner's own new password, which lifts the forced change."""
    locked = _lock_user(user.pk)
    locked.set_password(password)
    return _password_set(locked, actor=user)


@transaction.atomic
def record_admin_password_change(target: User, *, actor: User) -> User:
    """Django admin's password form has saved `target`'s new password; the
    rest of an administrator reset follows here, in the same transaction."""
    return _password_set(_lock_user(target.pk), actor=actor)


def _password_set(locked: User, *, actor: User) -> User:
    # A password its owner chose - including an administrator setting their
    # own - needs no forced replacement; one someone else chose does.
    chosen_by_owner = locked.pk == actor.pk
    # One transaction with the password itself, so the change and its record
    # land together or not at all (KG-A14). The value never appears in the
    # summary or metadata.
    locked.must_change_password = not chosen_by_owner
    locked.save(update_fields=["password", "must_change_password"])
    record(
        AuditAction.USER_UPDATED,
        locked,
        (
            f"Password changed by {locked.email}."
            if chosen_by_owner
            else f"Password reset for {locked.email}."
        ),
        actor=actor,
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
    every other account change (KG-A14)."""
    locked = _lock_user(target.pk)
    before = {"is_staff": locked.is_staff, "is_superuser": locked.is_superuser}
    if is_staff is not None:
        locked.is_staff = is_staff
    if is_superuser is not None:
        locked.is_superuser = is_superuser
    after = {"is_staff": locked.is_staff, "is_superuser": locked.is_superuser}
    if before == after:
        return locked
    locked.save(update_fields=["is_staff", "is_superuser"])
    record(
        AuditAction.USER_UPDATED,
        locked,
        f"Admin site access changed for {locked.email}.",
        actor=actor,
        metadata={"before": before, "after": after},
    )
    return locked
