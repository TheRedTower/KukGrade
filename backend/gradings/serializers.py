from __future__ import annotations

from typing import Any, NoReturn, cast

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from rest_framework import serializers

from gradings.models import GradingCandidate, GradingSession
from gradings.services import (
    build_candidate,
    update_candidate,
    validate_session_grading_date_change,
    validate_session_transition,
)
from ranks.models import Rank
from students.models import Student


def raise_drf_validation_error(exc: DjangoValidationError) -> NoReturn:
    if hasattr(exc, "message_dict"):
        raise serializers.ValidationError(exc.message_dict) from exc
    raise serializers.ValidationError(exc.messages) from exc


class GradingSessionSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    created_by: serializers.PrimaryKeyRelatedField = serializers.PrimaryKeyRelatedField(
        read_only=True,
    )
    created_by_email = serializers.EmailField(source="created_by.email", read_only=True)

    class Meta:
        model = GradingSession
        fields = (
            "id",
            "title",
            "grading_date",
            "status",
            "status_display",
            "location",
            "notes",
            "created_by",
            "created_by_email",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "status_display",
            "created_by",
            "created_by_email",
            "created_at",
            "updated_at",
        )

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        if self.instance is not None and "status" in attrs:
            try:
                validate_session_transition(
                    self.instance.status,
                    str(attrs["status"]),
                )
            except DjangoValidationError as exc:
                raise_drf_validation_error(exc)
        if self.instance is not None and "grading_date" in attrs:
            self.instance.grading_date = attrs["grading_date"]
            try:
                validate_session_grading_date_change(self.instance)
            except DjangoValidationError as exc:
                raise_drf_validation_error(exc)
        return attrs

    def create(self, validated_data: dict[str, Any]) -> GradingSession:
        request = self.context["request"]
        validated_data["created_by"] = request.user
        try:
            return cast(GradingSession, super().create(validated_data))
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)

    def update(
        self,
        instance: GradingSession,
        validated_data: dict[str, Any],
    ) -> GradingSession:
        try:
            return cast(GradingSession, super().update(instance, validated_data))
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)


class GradingCandidateSerializer(serializers.ModelSerializer):
    age_band = serializers.CharField(read_only=True)
    age_band_display = serializers.CharField(
        source="get_age_band_display", read_only=True
    )
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    session_title = serializers.CharField(source="session.title", read_only=True)
    student_display_name = serializers.CharField(source="student", read_only=True)
    student_wksa_id = serializers.CharField(source="student.wksa_id", read_only=True)
    testing_for_rank_code = serializers.CharField(
        source="testing_for_rank.code",
        read_only=True,
    )
    testing_for_rank_name = serializers.CharField(
        source="testing_for_rank.name",
        read_only=True,
    )

    class Meta:
        model = GradingCandidate
        fields = (
            "id",
            "session",
            "session_title",
            "student",
            "student_display_name",
            "student_wksa_id",
            "testing_for_rank",
            "testing_for_rank_code",
            "testing_for_rank_name",
            "age_band",
            "age_band_display",
            "status",
            "status_display",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "session_title",
            "student_display_name",
            "student_wksa_id",
            "testing_for_rank_code",
            "testing_for_rank_name",
            "age_band",
            "age_band_display",
            "status_display",
            "created_at",
            "updated_at",
        )

    def create(self, validated_data: dict[str, Any]) -> GradingCandidate:
        try:
            candidate = build_candidate(
                session=cast(GradingSession, validated_data["session"]),
                student=cast(Student, validated_data["student"]),
                testing_for_rank=cast(Rank, validated_data["testing_for_rank"]),
                status=str(
                    validated_data.get(
                        "status",
                        GradingCandidate.Status.REGISTERED,
                    ),
                ),
                notes=str(validated_data.get("notes", "")),
            )
            candidate.save()
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)
        except IntegrityError as exc:
            raise serializers.ValidationError(
                {"student": ["Student is already registered for this session."]},
            ) from exc
        return candidate

    def update(
        self,
        instance: GradingCandidate,
        validated_data: dict[str, Any],
    ) -> GradingCandidate:
        try:
            candidate = update_candidate(
                instance,
                session=cast(GradingSession | None, validated_data.get("session")),
                student=cast(Student | None, validated_data.get("student")),
                testing_for_rank=cast(
                    Rank | None,
                    validated_data.get("testing_for_rank"),
                ),
                status=cast(str | None, validated_data.get("status")),
                notes=cast(str | None, validated_data.get("notes")),
            )
            candidate.save()
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)
        except IntegrityError as exc:
            raise serializers.ValidationError(
                {"student": ["Student is already registered for this session."]},
            ) from exc
        return candidate
