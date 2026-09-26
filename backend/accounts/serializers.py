from __future__ import annotations

import logging
from typing import Any

from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from accounts.models import User
from accounts.permissions import (
    AUTHORITY_PERMISSIONS,
    DELETE_ANY_SESSION_PERMISSION,
    FINAL_GRADING_DECISION_PERMISSION,
    GRADING_AUDIT_LOG_PERMISSION,
    OVERRIDE_LOCKED_SESSION_PERMISSION,
    PROMOTE_STUDENT_PERMISSION,
    can_view_audit_log,
)
from accounts.services import (
    create_platform_user,
    record_password_reset,
    set_user_authority,
    update_platform_user,
)

security_logger = logging.getLogger("kukgrade.security")


def _validated_password(value: str, user: User | None) -> str:
    """Run Django's configured validators, reported as a DRF field error."""
    try:
        validate_password(value, user=user)
    except DjangoValidationError as exc:
        raise serializers.ValidationError(list(exc.messages)) from exc
    return value


class HasPermission(serializers.BooleanField):
    """Read-only: whether the serialized user holds `permission`.

    Computed from the permission that actually gates the action, so the UI
    cannot disagree with what the server will allow.
    """

    def __init__(self, permission: str) -> None:
        self.permission = permission
        super().__init__(source="*", read_only=True)

    def to_representation(self, value: Any) -> bool:
        return bool(value.has_perm(self.permission))


# The four per-user authority flags, spelled as AUTHORITY_PERMISSIONS. A
# comment rather than a docstring: drf-spectacular would otherwise inherit it
# as the OpenAPI description of every serializer that mixes this in.
class AuthorityFields(serializers.Serializer):
    can_make_final_grading_decision = HasPermission(FINAL_GRADING_DECISION_PERMISSION)
    can_promote_student = HasPermission(PROMOTE_STUDENT_PERMISSION)
    can_override_locked_session = HasPermission(OVERRIDE_LOCKED_SESSION_PERMISSION)
    can_view_grading_audit_log = HasPermission(GRADING_AUDIT_LOG_PERMISSION)


class UserSerializer(AuthorityFields, serializers.ModelSerializer):
    full_name = serializers.CharField(source="get_full_name", read_only=True)
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    # What the signed-in user may do beyond ordinary grading, from the exact
    # permission each action checks - so the UI offers a control only when
    # the server will accept it, and never decides that from role.
    can_manage_users = HasPermission("accounts.view_user")
    can_import_data = HasPermission("data_imports.add_importbatch")
    can_reconcile_imported_history = HasPermission(
        "gradings.can_reconcile_imported_history",
    )
    can_delete_students = HasPermission("students.delete_student")
    can_delete_assessments = HasPermission("gradings.delete_candidateassessment")
    can_delete_any_session = HasPermission(DELETE_ANY_SESSION_PERMISSION)
    # Not a single permission: the audit-log rule, computed by the same
    # function the API and admin enforce it with.
    can_read_audit_log = serializers.SerializerMethodField()

    def get_can_read_audit_log(self, user: User) -> bool:
        return can_view_audit_log(user)

    class Meta:
        model = User
        fields: tuple[str, ...] = (
            "id",
            "email",
            "first_name",
            "last_name",
            "full_name",
            "role",
            "role_display",
            "can_make_final_grading_decision",
            "can_promote_student",
            "can_override_locked_session",
            "can_view_grading_audit_log",
            "can_manage_users",
            "can_import_data",
            "can_reconcile_imported_history",
            "can_delete_students",
            "can_delete_assessments",
            "can_delete_any_session",
            "can_read_audit_log",
            "must_change_password",
            "is_staff",
            "is_superuser",
        )
        read_only_fields: tuple[str, ...] = fields


class SelfProfileSerializer(UserSerializer):
    """PATCH /api/auth/me/.

    Everything UserSerializer exposes, but first_name and last_name become
    writable - the only things a user may change about themselves. Email,
    role and authority stay administrator-only, on UserManagementSerializer;
    a separate serializer keeps "what a user can do to themselves" from ever
    silently growing alongside admin capabilities.
    """

    class Meta(UserSerializer.Meta):
        read_only_fields: tuple[str, ...] = tuple(
            field
            for field in UserSerializer.Meta.fields
            if field not in {"first_name", "last_name"}
        )

    def update(self, instance: User, validated_data: dict[str, Any]) -> User:
        request = self.context["request"]
        return update_platform_user(instance, actor=request.user, **validated_data)


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(write_only=True)
    password = serializers.CharField(
        style={"input_type": "password"},
        trim_whitespace=False,
        write_only=True,
    )

    default_error_messages = {
        "invalid_credentials": "Unable to log in with the provided credentials.",
    }

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        request = self.context.get("request")
        email = User.objects.normalize_email(str(attrs["email"]))
        password = str(attrs["password"])
        user = authenticate(request=request, email=email, password=password)

        if user is None:
            # The email identifies which account was targeted, which is
            # exactly what makes this useful for spotting a brute-force
            # attempt; the password itself is never in this call or any
            # other log line in this codebase.
            security_logger.warning("Failed login attempt for %s", email)
            self.fail("invalid_credentials")

        attrs["user"] = user
        return attrs


class UserManagementSerializer(AuthorityFields, serializers.ModelSerializer):
    """List, retrieve, create and update for the administrator-facing API.

    Deliberately separate from UserSerializer, which is a fixed read-only
    self-view for /api/auth/me/: that one has no reason to expose is_active
    or date_joined about the caller to themselves, and has no reason to be
    writable at all. Sharing one class between the two would couple changes
    meant for one endpoint to the other.
    """

    full_name = serializers.CharField(source="get_full_name", read_only=True)
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    # write_only and required at the class level, for create. Removed
    # entirely on update in __init__, below, rather than merely marked
    # optional: password changes go through the dedicated set-password
    # action, so update() should never even receive the field.
    password = serializers.CharField(
        write_only=True,
        style={"input_type": "password"},
    )

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "first_name",
            "last_name",
            "full_name",
            "role",
            "role_display",
            "is_active",
            "can_make_final_grading_decision",
            "can_promote_student",
            "can_override_locked_session",
            "can_view_grading_audit_log",
            "must_change_password",
            "is_staff",
            "is_superuser",
            "date_joined",
            "last_login",
            "password",
        )
        # is_staff and is_superuser are never writable through this API:
        # Django admin access is not something it should be able to hand
        # out. Role and is_active are writable; role decides group
        # membership via the post_save signal in accounts/apps.py.
        read_only_fields = (
            "id",
            "full_name",
            "role_display",
            "can_make_final_grading_decision",
            "can_promote_student",
            "can_override_locked_session",
            "can_view_grading_audit_log",
            "must_change_password",
            "is_staff",
            "is_superuser",
            "date_joined",
            "last_login",
        )

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        if self.instance is not None:
            del self.fields["password"]

    def validate_password(self, value: str) -> str:
        # This only ever runs on create - update() has no password field, see
        # __init__ above. Without an unsaved User built from the other
        # submitted fields, UserAttributeSimilarityValidator has nothing to
        # compare against and a password identical to the new account's own
        # email would pass.
        candidate = User(
            email=self.initial_data.get("email", ""),
            first_name=self.initial_data.get("first_name", ""),
            last_name=self.initial_data.get("last_name", ""),
        )
        return _validated_password(value, candidate)

    def create(self, validated_data: dict[str, Any]) -> User:
        request = self.context["request"]
        return create_platform_user(actor=request.user, **validated_data)

    def update(self, instance: User, validated_data: dict[str, Any]) -> User:
        request = self.context["request"]
        return update_platform_user(instance, actor=request.user, **validated_data)


class UserAuthoritySerializer(serializers.Serializer):
    """PATCH /api/users/{id}/authority/.

    Same keys /api/auth/me/ returns, so the concept is spelled one way
    throughout rather than the read shape and the write shape drifting.
    """

    can_make_final_grading_decision = serializers.BooleanField(required=False)
    can_promote_student = serializers.BooleanField(required=False)
    can_override_locked_session = serializers.BooleanField(required=False)
    can_view_grading_audit_log = serializers.BooleanField(required=False)

    def update(self, instance: User, validated_data: dict[str, Any]) -> User:
        request = self.context["request"]
        return set_user_authority(
            instance,
            actor=request.user,
            **{name: validated_data.get(name) for name in AUTHORITY_PERMISSIONS},
        )


class SetPasswordSerializer(serializers.Serializer):
    """POST /api/users/{id}/set-password/.

    A separate action rather than a writable field on UserManagementSerializer,
    so a plain PATCH to a user's other details can never carry a password
    change as a side effect.
    """

    password = serializers.CharField(
        write_only=True,
        style={"input_type": "password"},
    )

    def validate_password(self, value: str) -> str:
        return _validated_password(value, self.instance)

    def update(self, instance: User, validated_data: dict[str, Any]) -> User:
        request = self.context["request"]
        instance.set_password(validated_data["password"])
        instance.must_change_password = True
        instance.save(update_fields=["password", "must_change_password"])
        record_password_reset(instance, actor=request.user)
        return instance


class ChangePasswordSerializer(serializers.Serializer):
    """POST /api/auth/change-password/.

    Self-service, unlike SetPasswordSerializer: an administrator resetting
    someone else's password already proved their own authority to manage
    that account, so no current-password check applies there. Here the
    caller is proving they still control the account, not managing someone
    else's - current_password is required precisely because a hijacked
    session should not be enough to lock the real owner out.
    """

    current_password = serializers.CharField(
        write_only=True,
        style={"input_type": "password"},
    )
    new_password = serializers.CharField(
        write_only=True,
        style={"input_type": "password"},
    )

    def validate_current_password(self, value: str) -> str:
        request = self.context["request"]
        if not request.user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate_new_password(self, value: str) -> str:
        return _validated_password(value, self.instance)

    def update(self, instance: User, validated_data: dict[str, Any]) -> User:
        request = self.context["request"]
        instance.set_password(validated_data["new_password"])
        instance.must_change_password = False
        instance.save(update_fields=["password", "must_change_password"])
        record_password_reset(instance, actor=request.user)
        return instance
