from __future__ import annotations

import logging
from typing import Any

from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from accounts.models import User
from accounts.permissions import (
    FINAL_GRADING_DECISION_PERMISSION,
    OVERRIDE_LOCKED_SESSION_PERMISSION,
    PROMOTE_STUDENT_PERMISSION,
)
from accounts.services import (
    AUTHORITY_PERMISSIONS,
    create_platform_user,
    record_password_reset,
    set_user_authority,
    update_platform_user,
)
from gradings.serializers import raise_drf_validation_error

security_logger = logging.getLogger("kukgrade.security")


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="get_full_name", read_only=True)
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    # Computed from the permissions that actually gate these actions, so the
    # UI cannot disagree with what the server will allow. This key was once a
    # model field that nothing consulted; it now means what it says.
    can_make_final_grading_decision = serializers.SerializerMethodField()
    can_promote_student = serializers.SerializerMethodField()
    can_override_locked_session = serializers.SerializerMethodField()

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
            "can_make_final_grading_decision",
            "can_promote_student",
            "can_override_locked_session",
            "is_staff",
            "is_superuser",
        )
        read_only_fields = fields

    def get_can_make_final_grading_decision(self, obj: User) -> bool:
        return obj.has_perm(FINAL_GRADING_DECISION_PERMISSION)

    def get_can_promote_student(self, obj: User) -> bool:
        return obj.has_perm(PROMOTE_STUDENT_PERMISSION)

    def get_can_override_locked_session(self, obj: User) -> bool:
        # Added after can_make_final_grading_decision / can_promote_student:
        # this permission did not exist yet when those two were written, and
        # nothing updated this serializer when it was introduced in the
        # locked-session-exit work. Found while building the users API,
        # which reuses this exact shape - fixed here rather than propagated.
        return obj.has_perm(OVERRIDE_LOCKED_SESSION_PERMISSION)


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


class UserManagementSerializer(serializers.ModelSerializer):
    """List, retrieve, create and update for the administrator-facing API.

    Deliberately separate from UserSerializer, which is a fixed read-only
    self-view for /api/auth/me/: that one has no reason to expose is_active
    or date_joined about the caller to themselves, and has no reason to be
    writable at all. Sharing one class between the two would couple changes
    meant for one endpoint to the other.
    """

    full_name = serializers.CharField(source="get_full_name", read_only=True)
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    can_make_final_grading_decision = serializers.SerializerMethodField()
    can_promote_student = serializers.SerializerMethodField()
    can_override_locked_session = serializers.SerializerMethodField()
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
            "is_staff",
            "is_superuser",
            "date_joined",
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
            "is_staff",
            "is_superuser",
            "date_joined",
        )

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        if self.instance is not None:
            del self.fields["password"]

    def get_can_make_final_grading_decision(self, obj: User) -> bool:
        return obj.has_perm(FINAL_GRADING_DECISION_PERMISSION)

    def get_can_promote_student(self, obj: User) -> bool:
        return obj.has_perm(PROMOTE_STUDENT_PERMISSION)

    def get_can_override_locked_session(self, obj: User) -> bool:
        return obj.has_perm(OVERRIDE_LOCKED_SESSION_PERMISSION)

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
        try:
            validate_password(value, user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def create(self, validated_data: dict[str, Any]) -> User:
        request = self.context["request"]
        try:
            return create_platform_user(actor=request.user, **validated_data)
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)

    def update(self, instance: User, validated_data: dict[str, Any]) -> User:
        request = self.context["request"]
        try:
            return update_platform_user(instance, actor=request.user, **validated_data)
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)


class UserAuthoritySerializer(serializers.Serializer):
    """PATCH /api/users/{id}/authority/.

    Same three keys /api/auth/me/ returns, so the concept is spelled one way
    throughout rather than the read shape and the write shape drifting.
    """

    can_make_final_grading_decision = serializers.BooleanField(required=False)
    can_promote_student = serializers.BooleanField(required=False)
    can_override_locked_session = serializers.BooleanField(required=False)

    def update(self, instance: User, validated_data: dict[str, Any]) -> User:
        request = self.context["request"]
        try:
            return set_user_authority(
                instance,
                actor=request.user,
                **{name: validated_data.get(name) for name in AUTHORITY_PERMISSIONS},
            )
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)

    def create(self, validated_data: dict[str, Any]) -> User:
        raise NotImplementedError


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
        try:
            validate_password(value, user=self.instance)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def update(self, instance: User, validated_data: dict[str, Any]) -> User:
        request = self.context["request"]
        instance.set_password(validated_data["password"])
        instance.save(update_fields=["password"])
        record_password_reset(instance, actor=request.user)
        return instance

    def create(self, validated_data: dict[str, Any]) -> User:
        raise NotImplementedError
