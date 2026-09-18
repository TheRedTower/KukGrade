from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from gradings.models import Promotion
from gradings.serializers import raise_drf_validation_error
from gradings.services import StudentRankTimeline
from students.models import Student
from students.services import create_student, update_student


class PromotionRankHistorySerializer(serializers.ModelSerializer[Promotion]):
    from_rank_code = serializers.CharField(source="from_rank.code", read_only=True)
    from_rank_name = serializers.CharField(source="from_rank.name", read_only=True)
    to_rank_code = serializers.CharField(source="to_rank.code", read_only=True)
    to_rank_name = serializers.CharField(source="to_rank.name", read_only=True)
    session = serializers.IntegerField(
        source="grading_candidate.session_id",
        read_only=True,
    )
    session_title = serializers.CharField(
        source="grading_candidate.session.title",
        read_only=True,
    )
    grading_date = serializers.DateField(
        source="grading_candidate.session.grading_date",
        read_only=True,
    )
    outcome_status = serializers.CharField(source="outcome.status", read_only=True)
    final_outcome = serializers.CharField(
        source="outcome.final_outcome", read_only=True
    )
    promoted_by_email = serializers.EmailField(
        source="promoted_by.email",
        read_only=True,
    )
    promoted_by_name = serializers.CharField(
        source="promoted_by.get_full_name",
        read_only=True,
    )

    class Meta:
        model = Promotion
        fields = (
            "id",
            "from_rank",
            "from_rank_code",
            "from_rank_name",
            "to_rank",
            "to_rank_code",
            "to_rank_name",
            "session",
            "session_title",
            "grading_date",
            "outcome",
            "outcome_status",
            "final_outcome",
            "promoted_by",
            "promoted_by_email",
            "promoted_by_name",
            "promoted_at",
            "effective_date",
            "notes",
        )
        read_only_fields = fields


class StudentRankHistorySerializer(serializers.Serializer[StudentRankTimeline]):
    student = serializers.SerializerMethodField()
    student_display_name = serializers.SerializerMethodField()
    student_wksa_id = serializers.SerializerMethodField()
    current_rank = serializers.SerializerMethodField()
    current_rank_code = serializers.SerializerMethodField()
    current_rank_name = serializers.SerializerMethodField()
    promotions = PromotionRankHistorySerializer(many=True, read_only=True)

    def get_student(self, obj: StudentRankTimeline) -> int:
        return obj["student"].pk

    def get_student_display_name(self, obj: StudentRankTimeline) -> str:
        return str(obj["student"])

    def get_student_wksa_id(self, obj: StudentRankTimeline) -> str:
        return obj["student"].wksa_id

    def get_current_rank(self, obj: StudentRankTimeline) -> int:
        return obj["current_rank"].pk

    def get_current_rank_code(self, obj: StudentRankTimeline) -> str:
        return obj["current_rank"].code

    def get_current_rank_name(self, obj: StudentRankTimeline) -> str:
        return obj["current_rank"].name


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
    age_band = serializers.CharField(read_only=True)
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

    current_rank_code = serializers.CharField(
        source="current_rank.code", read_only=True
    )
    current_rank_name = serializers.CharField(
        source="current_rank.name", read_only=True
    )
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    can_be_graded = serializers.BooleanField(read_only=True)
    age_band = serializers.CharField(read_only=True)
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
            "current_rank_code",
            "current_rank_name",
            "status",
            "status_display",
            "can_be_graded",
            "age_band",
            "age_band_display",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "current_rank_code",
            "current_rank_name",
            "status_display",
            "can_be_graded",
            "age_band",
            "age_band_display",
            "created_at",
            "updated_at",
        )

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        if self.instance is not None:
            # wksa_id is the external identifier grading records are matched
            # against; it must not change once a student exists.
            self.fields["wksa_id"].read_only = True

    def create(self, validated_data: dict[str, Any]) -> Student:
        request = self.context["request"]
        try:
            return create_student(actor=request.user, **validated_data)
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)

    def update(self, instance: Student, validated_data: dict[str, Any]) -> Student:
        request = self.context["request"]
        try:
            return update_student(instance, actor=request.user, **validated_data)
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)
