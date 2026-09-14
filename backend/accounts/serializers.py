from __future__ import annotations

from django.contrib.auth import authenticate
from rest_framework import serializers

from accounts.models import User
from accounts.permissions import (
    FINAL_GRADING_DECISION_PERMISSION,
    OVERRIDE_LOCKED_SESSION_PERMISSION,
    PROMOTE_STUDENT_PERMISSION,
)


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
            self.fail("invalid_credentials")

        attrs["user"] = user
        return attrs
