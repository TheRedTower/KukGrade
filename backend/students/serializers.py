from __future__ import annotations

from typing import Any

from rest_framework import serializers

from gradings.models import (
    CandidateOutcome,
    LegacyAttendance,
    LegacyDatePrecision,
    Promotion,
)
from gradings.read_models import (
    GradingHistoryItem,
    StudentGradingHistory,
    StudentRankTimeline,
)
from students.models import Student
from students.services import create_student, update_student
from syllabus.models import AgeBand


class PromotionRankHistorySerializer(serializers.ModelSerializer[Promotion]):
    from_rank_name = serializers.CharField(source="from_rank.name", read_only=True)
    to_rank_name = serializers.CharField(source="to_rank.name", read_only=True)
    session_title = serializers.CharField(
        source="grading_candidate.session.title",
        read_only=True,
    )

    class Meta:
        model = Promotion
        fields = (
            "id",
            "from_rank_name",
            "to_rank_name",
            "session_title",
            "promoted_at",
            "effective_date",
        )
        read_only_fields = fields


class StudentRankHistorySerializer(serializers.Serializer[StudentRankTimeline]):
    promotions = PromotionRankHistorySerializer(many=True, read_only=True)


class GradingHistoryItemSerializer(serializers.Serializer[GradingHistoryItem]):
    # "source" collides with Field.source's own type (Callable | str | None)
    # - same mypy collision as EffectiveSyllabusRequirementSerializer.required
    # elsewhere in this codebase, not a real conflict at runtime.
    source = serializers.ChoiceField(  # type: ignore[assignment]
        choices=["KUKGRADE", "LEGACY"],
    )
    record_id = serializers.IntegerField()
    date = serializers.DateField(allow_null=True)
    cycle_year = serializers.IntegerField(allow_null=True)
    cycle_month = serializers.IntegerField(allow_null=True)
    date_precision = serializers.ChoiceField(choices=LegacyDatePrecision.choices)
    testing_for_rank_name = serializers.CharField(allow_null=True)
    source_testing_for_rank_text = serializers.CharField()
    outcome = serializers.ChoiceField(
        choices=CandidateOutcome.Outcome.choices,
        allow_null=True,
    )
    attendance_status = serializers.ChoiceField(choices=LegacyAttendance.choices)
    comments = serializers.CharField()


class StudentGradingHistorySerializer(serializers.Serializer[StudentGradingHistory]):
    """Combines finalised native outcomes with linked, non-voided legacy
    records - kept deliberately separate from
    StudentRankHistorySerializer/`/rank-history/`, which remains
    Promotion-only (import Decision 6)."""

    items = GradingHistoryItemSerializer(many=True)


class StudentListSerializer(serializers.ModelSerializer[Student]):
    """The list representation. Deliberately excludes date of birth.

    Date of birth is the most sensitive field held, on people who may be
    minors. It appears on a single record an instructor deliberately opened,
    never in a page of two hundred names.
    """

    current_rank_code = serializers.CharField(
        source="current_rank.code", read_only=True
    )
    current_rank_name = serializers.CharField(
        source="current_rank.name", read_only=True
    )
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    can_be_graded = serializers.BooleanField(read_only=True)
    age_band = serializers.ChoiceField(choices=AgeBand.choices, read_only=True)
    age_band_display = serializers.CharField(read_only=True)

    class Meta:
        model = Student
        fields = (
            "id",
            "wksa_id",
            "first_name",
            "last_name",
            "current_rank",
            "current_rank_code",
            "current_rank_name",
            "status",
            "status_display",
            "can_be_graded",
            "age_band",
            "age_band_display",
        )
        read_only_fields = fields


class StudentSerializer(serializers.ModelSerializer[Student]):
    """Detail, create and update. wksa_id is writable only on create.

    One serializer rather than three: create and update share every field
    except wksa_id, and splitting them further would just be the same
    fields copied into different classes.
    """

    current_rank_name = serializers.CharField(
        source="current_rank.name", read_only=True
    )
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    age_band_display = serializers.CharField(read_only=True)

    class Meta:
        model = Student
        fields = (
            "id",
            "wksa_id",
            "first_name",
            "last_name",
            "date_of_birth",
            "current_rank",
            "current_rank_name",
            "status",
            "status_display",
            "age_band_display",
            "created_at",
        )
        read_only_fields = (
            "id",
            "current_rank_name",
            "status_display",
            "age_band_display",
            "created_at",
        )

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        if self.instance is not None:
            # wksa_id is the external identifier grading records are matched
            # against; it must not change once a student exists.
            self.fields["wksa_id"].read_only = True

    def create(self, validated_data: dict[str, Any]) -> Student:
        request = self.context["request"]
        return create_student(actor=request.user, **validated_data)

    def update(self, instance: Student, validated_data: dict[str, Any]) -> Student:
        request = self.context["request"]
        return update_student(instance, actor=request.user, **validated_data)
