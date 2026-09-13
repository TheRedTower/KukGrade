from __future__ import annotations

from rest_framework import serializers

from gradings.models import Promotion
from gradings.services import StudentRankTimeline


class PromotionRankHistorySerializer(serializers.ModelSerializer):
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


class StudentRankHistorySerializer(serializers.Serializer):
    student = serializers.SerializerMethodField()
    student_display_name = serializers.SerializerMethodField()
    student_wksa_id = serializers.SerializerMethodField()
    current_rank = serializers.SerializerMethodField()
    current_rank_code = serializers.SerializerMethodField()
    current_rank_name = serializers.SerializerMethodField()
    promotions = PromotionRankHistorySerializer(many=True, read_only=True)

    def get_student(self, obj: StudentRankTimeline) -> int:
        return obj["student"].id

    def get_student_display_name(self, obj: StudentRankTimeline) -> str:
        return str(obj["student"])

    def get_student_wksa_id(self, obj: StudentRankTimeline) -> str:
        return obj["student"].wksa_id

    def get_current_rank(self, obj: StudentRankTimeline) -> int:
        return obj["current_rank"].id

    def get_current_rank_code(self, obj: StudentRankTimeline) -> str:
        return obj["current_rank"].code

    def get_current_rank_name(self, obj: StudentRankTimeline) -> str:
        return obj["current_rank"].name
