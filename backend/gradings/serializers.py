from __future__ import annotations

from typing import Any, cast

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from accounts.models import User
from gradings.legacy_services import link_legacy_record_to_student, void_legacy_record
from gradings.models import (
    CANDIDATE_STUDENT_FIXED_MESSAGE,
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    LegacyGradingRecord,
    Promotion,
)
from gradings.services import (
    WITHDRAWAL_REASON_REQUIRED_MESSAGE,
    OverallAssessmentSummary,
    apply_candidate_update,
    candidate_assessment_summary,
    candidate_can_be_deleted,
    candidate_can_change_session,
    create_grading_session,
    finalise_candidate_outcome,
    promote_candidate,
    propose_candidate_outcome,
    update_candidate_assessment,
    update_candidate_assessment_item,
    update_grading_session,
    validate_session_grading_date_change,
    validate_session_transition,
    withdraw_locked_candidate,
)
from ranks.models import Rank
from students.models import Student
from syllabus.models import SyllabusItem


class GradingSessionSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)

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
            "cancellation_reason",
        )
        read_only_fields = (
            "id",
            "status_display",
        )
        # Sent when cancelling a locked session; no screen reads it back. It
        # is kept on the model and in the audit log.
        extra_kwargs = {"cancellation_reason": {"write_only": True}}

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        if self.instance is not None and "status" in attrs:
            validate_session_transition(
                self.instance.status,
                str(attrs["status"]),
                session=self.instance,
            )
        if self.instance is not None and "grading_date" in attrs:
            self.instance.grading_date = attrs["grading_date"]
            validate_session_grading_date_change(self.instance)
        return attrs

    def create(self, validated_data: dict[str, Any]) -> GradingSession:
        request = self.context["request"]
        return create_grading_session(
            title=str(validated_data["title"]),
            grading_date=validated_data["grading_date"],
            location=str(validated_data.get("location", "")),
            notes=str(validated_data.get("notes", "")),
            created_by=cast(User, request.user),
            status=cast(str | None, validated_data.get("status")),
        )

    def update(
        self,
        instance: GradingSession,
        validated_data: dict[str, Any],
    ) -> GradingSession:
        target_status = cast(str | None, validated_data.pop("status", None))
        reason = cast(str, validated_data.pop("cancellation_reason", ""))
        return update_grading_session(
            instance,
            changes=validated_data,
            target_status=target_status,
            reason=reason,
            actor=self.context["request"].user,
        )


class GradingCandidateSerializer(serializers.ModelSerializer):
    age_band_display = serializers.CharField(
        source="get_age_band_display", read_only=True
    )
    # Blank on a candidate who is not withdrawn, so the schema admits "".
    withdrawal_reason = serializers.ChoiceField(
        choices=GradingCandidate.WithdrawalReason.choices,
        required=False,
        allow_blank=True,
    )
    student_display_name = serializers.SerializerMethodField()
    student_wksa_id = serializers.CharField(source="student.wksa_id", read_only=True)
    from_rank_name = serializers.CharField(source="from_rank.name", read_only=True)
    testing_for_rank_name = serializers.CharField(
        source="testing_for_rank.name",
        read_only=True,
    )

    withdrawal_reason_display = serializers.CharField(
        source="get_withdrawal_reason_display",
        read_only=True,
    )

    can_be_moved = serializers.SerializerMethodField()
    can_be_removed = serializers.SerializerMethodField()

    def get_student_display_name(self, instance: GradingCandidate) -> str:
        return f"{instance.student.first_name} {instance.student.last_name}".strip()

    def get_can_be_moved(self, instance: GradingCandidate) -> bool:
        return candidate_can_change_session(instance)

    def get_can_be_removed(self, instance: GradingCandidate) -> bool:
        return candidate_can_be_deleted(instance)

    def validate_student(self, value: Student) -> Student:
        if self.instance is not None and value.pk != self.instance.student_id:
            raise serializers.ValidationError(CANDIDATE_STUDENT_FIXED_MESSAGE)
        return value

    class Meta:
        model = GradingCandidate
        fields = (
            "id",
            "session",
            "student",
            "student_display_name",
            "student_wksa_id",
            "from_rank",
            "from_rank_name",
            "testing_for_rank",
            "testing_for_rank_name",
            "age_band_display",
            "status",
            "notes",
            "withdrawal_reason",
            "withdrawal_reason_display",
            "withdrawal_note",
            "can_be_moved",
            "can_be_removed",
        )
        read_only_fields = (
            "id",
            "student_display_name",
            "student_wksa_id",
            "from_rank",
            "from_rank_name",
            "testing_for_rank_name",
            "age_band_display",
            "withdrawal_reason_display",
        )

    def update(
        self,
        instance: GradingCandidate,
        validated_data: dict[str, Any],
    ) -> GradingCandidate:
        return apply_candidate_update(
            instance,
            session=cast(GradingSession | None, validated_data.get("session")),
            testing_for_rank=cast(
                Rank | None,
                validated_data.get("testing_for_rank"),
            ),
            status=cast(str | None, validated_data.get("status")),
            notes=cast(str | None, validated_data.get("notes")),
            withdrawal_reason=validated_data.get("withdrawal_reason"),
            withdrawal_note=validated_data.get("withdrawal_note"),
            actor=cast(User, self.context["request"].user),
        )


class BulkCandidateRegistrationItemSerializer(serializers.Serializer):
    student = serializers.PrimaryKeyRelatedField(queryset=Student.objects.all())
    # Optional: students in one batch are usually a mix of belts (a group of
    # blue belts plus a couple of white belts plus one brown stripe, say), so
    # there is no single rank to default the batch to. Omitting it resolves
    # to that student's own next active rank - the same rank registration
    # would insist on anyway - so the common case needs no rank
    # picked at all; it is only needed to catch an out-of-turn request early.
    testing_for_rank = serializers.PrimaryKeyRelatedField(
        queryset=Rank.objects.all(),
        required=False,
    )
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class BulkCandidateRegistrationSerializer(serializers.Serializer):
    session = serializers.PrimaryKeyRelatedField(queryset=GradingSession.objects.all())
    candidates = BulkCandidateRegistrationItemSerializer(many=True, allow_empty=False)
    # When set, each successfully registered candidate also has its
    # assessment generated immediately, in the same per-row savepoint - so
    # adding a group to a session and starting their assessments is one
    # request instead of two.
    generate_assessments = serializers.BooleanField(required=False, default=False)


class BulkAssessmentGenerationSerializer(serializers.Serializer):
    candidates = serializers.PrimaryKeyRelatedField(
        queryset=GradingCandidate.objects.all(),
        many=True,
        allow_empty=False,
    )


class BulkCandidateStatusUpdateSerializer(serializers.Serializer):
    candidates = serializers.PrimaryKeyRelatedField(
        queryset=GradingCandidate.objects.all(),
        many=True,
        allow_empty=False,
    )
    status = serializers.ChoiceField(choices=GradingCandidate.Status.choices)
    withdrawal_reason = serializers.ChoiceField(
        choices=GradingCandidate.WithdrawalReason.choices,
        required=False,
    )
    withdrawal_note = serializers.CharField(
        allow_blank=True,
        required=False,
        trim_whitespace=True,
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if attrs["status"] == GradingCandidate.Status.WITHDRAWN and not attrs.get(
            "withdrawal_reason"
        ):
            raise serializers.ValidationError(
                {"withdrawal_reason": [WITHDRAWAL_REASON_REQUIRED_MESSAGE]},
            )
        return attrs


class BulkAssessmentStartSerializer(serializers.Serializer):
    assessments = serializers.PrimaryKeyRelatedField(
        queryset=CandidateAssessment.objects.all(),
        many=True,
        allow_empty=False,
    )


class AssessmentSummaryCountsSerializer(serializers.Serializer):
    """Shape of one rollup block in `candidate_assessment_summary`.

    Declared so the schema tells the truth about what the assessment `summary`
    endpoint and each assessment's `overall` return. Neither serializes a
    model, and without this the generated contract claims the viewset's own
    `serializer_class`. Read-only: nothing is deserialized through it.
    """

    total = serializers.IntegerField(read_only=True)
    # `required` is a real key in the payload, and it collides with
    # `rest_framework.fields.Field.required`, which is a bool. Renaming the
    # attribute would rename the response key, so the shadowing is
    # deliberate and only the type conflict is silenced.
    required = serializers.IntegerField(read_only=True)  # type: ignore[assignment]
    met = serializers.IntegerField(read_only=True)
    not_met = serializers.IntegerField(read_only=True)
    not_assessed = serializers.IntegerField(read_only=True)
    required_met = serializers.IntegerField(read_only=True)
    required_not_assessed = serializers.IntegerField(read_only=True)
    all_required_assessed = serializers.BooleanField(read_only=True)


class AssessmentCategorySummarySerializer(AssessmentSummaryCountsSerializer):
    category = serializers.ChoiceField(
        choices=SyllabusItem.Category.choices,
        read_only=True,
    )


class CandidateAssessmentSummarySerializer(serializers.Serializer):
    """Overall plus per-category rollup for one assessment."""

    overall = AssessmentSummaryCountsSerializer(read_only=True)
    categories = AssessmentCategorySummarySerializer(many=True, read_only=True)


class CandidateAssessmentSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    candidate_student_name = serializers.CharField(
        source="candidate.student",
        read_only=True,
    )
    generated_by_email = serializers.EmailField(
        source="generated_by.email",
        read_only=True,
    )
    # The served overall counts (FDR-046), so a list of assessments needs no
    # per-assessment summary request.
    overall = serializers.SerializerMethodField()

    class Meta:
        model = CandidateAssessment
        fields = (
            "id",
            "candidate",
            "candidate_student_name",
            "status",
            "status_display",
            "generated_by_email",
            "generated_at",
            "started_at",
            "completed_at",
            "notes",
            "overall",
        )
        read_only_fields = (
            "id",
            "candidate",
            "candidate_student_name",
            "status_display",
            "generated_by_email",
            "generated_at",
            "started_at",
            "completed_at",
        )

    @extend_schema_field(AssessmentSummaryCountsSerializer)
    def get_overall(self, obj: CandidateAssessment) -> OverallAssessmentSummary:
        return candidate_assessment_summary(obj)["overall"]

    def update(
        self,
        instance: CandidateAssessment,
        validated_data: dict[str, Any],
    ) -> CandidateAssessment:
        return update_candidate_assessment(
            instance,
            status=cast(str | None, validated_data.get("status")),
            notes=cast(str | None, validated_data.get("notes")),
            actor=cast(User, self.context["request"].user),
        )


class CandidateAssessmentItemSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(
        source="get_category_display",
        read_only=True,
    )
    result_display = serializers.CharField(source="get_result_display", read_only=True)
    assessor_email = serializers.EmailField(source="assessor.email", read_only=True)
    display_range = serializers.CharField(read_only=True)

    class Meta:
        model = CandidateAssessmentItem
        fields = (
            "id",
            "item_name",
            "korean_name",
            "category",
            "category_display",
            "requirement_sequence",
            "required",
            "display_range",
            "requirement_notes",
            "result",
            "result_display",
            "assessor_email",
            "assessed_at",
            "assessor_notes",
        )
        read_only_fields = (
            "id",
            "item_name",
            "korean_name",
            "category",
            "category_display",
            "requirement_sequence",
            "required",
            "display_range",
            "requirement_notes",
            "result_display",
            "assessor_email",
            "assessed_at",
        )

    def update(
        self,
        instance: CandidateAssessmentItem,
        validated_data: dict[str, Any],
    ) -> CandidateAssessmentItem:
        request = self.context["request"]
        return update_candidate_assessment_item(
            instance,
            result=cast(str | None, validated_data.get("result")),
            assessor_notes=cast(str | None, validated_data.get("assessor_notes")),
            assessor=request.user,
        )


class CandidateOutcomeSerializer(serializers.ModelSerializer):
    proposed_outcome_display = serializers.CharField(
        source="get_proposed_outcome_display",
        read_only=True,
    )
    final_outcome_display = serializers.CharField(
        source="get_final_outcome_display",
        read_only=True,
    )
    proposed_by_name = serializers.CharField(
        source="proposed_by.get_full_name",
        read_only=True,
    )
    decided_by_name = serializers.CharField(
        source="decided_by.get_full_name",
        read_only=True,
    )

    class Meta:
        model = CandidateOutcome
        fields = (
            "id",
            "candidate",
            "status",
            "proposed_outcome",
            "proposed_outcome_display",
            "proposed_by_name",
            "proposed_at",
            "proposal_notes",
            "final_outcome",
            "final_outcome_display",
            "decided_by_name",
            "decided_at",
            "decision_notes",
            "conditional_requirements",
        )
        read_only_fields = fields


class CandidateOutcomeProposalSerializer(serializers.Serializer):
    proposed_outcome = serializers.ChoiceField(choices=CandidateOutcome.Outcome.choices)
    proposal_notes = serializers.CharField(
        allow_blank=True,
        required=False,
        trim_whitespace=True,
    )

    def update(
        self,
        instance: CandidateOutcome,
        validated_data: dict[str, Any],
    ) -> CandidateOutcome:
        request = self.context["request"]
        return propose_candidate_outcome(
            instance,
            proposed_outcome=str(validated_data["proposed_outcome"]),
            proposal_notes=str(validated_data.get("proposal_notes", "")),
            actor=cast(User, request.user),
        )


class CandidateOutcomeFinaliseSerializer(serializers.Serializer):
    final_outcome = serializers.ChoiceField(choices=CandidateOutcome.Outcome.choices)
    decision_notes = serializers.CharField(
        allow_blank=True,
        required=False,
        trim_whitespace=True,
    )
    conditional_requirements = serializers.CharField(
        allow_blank=True,
        required=False,
        trim_whitespace=True,
    )

    def update(
        self,
        instance: CandidateOutcome,
        validated_data: dict[str, Any],
    ) -> CandidateOutcome:
        request = self.context["request"]
        return finalise_candidate_outcome(
            instance,
            final_outcome=str(validated_data["final_outcome"]),
            decision_notes=str(validated_data.get("decision_notes", "")),
            conditional_requirements=str(
                validated_data.get("conditional_requirements", ""),
            ),
            actor=cast(User, request.user),
        )


class PromotionSerializer(serializers.ModelSerializer):
    student_display_name = serializers.CharField(source="student", read_only=True)
    to_rank_name = serializers.CharField(source="to_rank.name", read_only=True)

    class Meta:
        model = Promotion
        fields = (
            "id",
            "student_display_name",
            "grading_candidate",
            "to_rank_name",
            "effective_date",
        )
        read_only_fields = fields


class CandidatePromotionSerializer(serializers.Serializer):
    notes = serializers.CharField(
        allow_blank=True,
        required=False,
        trim_whitespace=True,
    )

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        forbidden_fields = {"effective_date", "promoted_by", "promoted_at"} & set(
            self.initial_data,
        )
        if forbidden_fields:
            raise serializers.ValidationError(
                {
                    field: ["This field is server-controlled."]
                    for field in sorted(forbidden_fields)
                },
            )
        return attrs

    def update(
        self,
        instance: CandidateOutcome,
        validated_data: dict[str, Any],
    ) -> Promotion:
        request = self.context["request"]
        return promote_candidate(
            instance,
            actor=cast(User, request.user),
            notes=str(validated_data.get("notes", "")),
        )


class BulkPromotionSerializer(serializers.Serializer):
    outcomes = serializers.PrimaryKeyRelatedField(
        queryset=CandidateOutcome.objects.all(),
        many=True,
        allow_empty=False,
    )


# The response of every bulk endpoint: what succeeded, under an
# endpoint-specific key, plus `errors` mapping row index -> that row's
# messages. A comment rather than a docstring, which drf-spectacular would
# inherit as each subclass's description.
class BulkResultSerializer(serializers.Serializer):
    # Collides with Serializer.errors only in the type stubs: the serializer
    # metaclass lifts declared fields out of the class namespace.
    errors = serializers.DictField(  # type: ignore[assignment]
        child=serializers.ListField(child=serializers.CharField()),
    )


class RegisteredCandidateSerializer(serializers.Serializer):
    candidate = GradingCandidateSerializer()
    assessment = CandidateAssessmentSerializer(allow_null=True)


class BulkCandidateRegistrationResultSerializer(BulkResultSerializer):
    created = RegisteredCandidateSerializer(many=True)


class BulkAssessmentGenerationResultSerializer(BulkResultSerializer):
    created = CandidateAssessmentSerializer(many=True)


class BulkCandidateStatusUpdateResultSerializer(BulkResultSerializer):
    updated = GradingCandidateSerializer(many=True)


class BulkAssessmentStartResultSerializer(BulkResultSerializer):
    started = CandidateAssessmentSerializer(many=True)


class BulkPromotionResultSerializer(BulkResultSerializer):
    promoted = PromotionSerializer(many=True)


class LockedCandidateWithdrawalSerializer(serializers.Serializer):
    withdrawal_reason = serializers.ChoiceField(
        choices=GradingCandidate.WithdrawalReason.choices,
    )
    withdrawal_note = serializers.CharField(
        allow_blank=True,
        required=False,
        trim_whitespace=True,
    )

    def update(
        self,
        instance: GradingCandidate,
        validated_data: dict[str, Any],
    ) -> GradingCandidate:
        request = self.context["request"]
        return withdraw_locked_candidate(
            instance,
            reason=str(validated_data["withdrawal_reason"]),
            note=str(validated_data.get("withdrawal_note", "")),
            actor=cast(User, request.user),
        )


class LegacyGradingRecordSerializer(serializers.ModelSerializer):
    """Read-mostly, matching PromotionSerializer's idiom - no ordinary
    update/delete exists (gradings.models.LegacyGradingRecordQuerySet), only
    the five reconciliation actions below."""

    outcome_display = serializers.CharField(
        source="get_outcome_display",
        read_only=True,
        allow_null=True,
    )
    attendance_status_display = serializers.CharField(
        source="get_attendance_status_display",
        read_only=True,
    )
    student_display_name = serializers.CharField(
        source="student",
        read_only=True,
        allow_null=True,
    )
    current_rank_code = serializers.CharField(
        source="current_rank.code",
        read_only=True,
        allow_null=True,
        default=None,
    )
    testing_for_rank_code = serializers.CharField(
        source="testing_for_rank.code",
        read_only=True,
        allow_null=True,
        default=None,
    )
    voided_by_email = serializers.EmailField(
        source="voided_by.email",
        read_only=True,
        allow_null=True,
        default=None,
    )

    class Meta:
        model = LegacyGradingRecord
        fields = (
            "id",
            "student",
            "student_display_name",
            "record_kind",
            "cycle_year",
            "cycle_month",
            "source_name",
            "source_current_rank_text",
            "current_rank",
            "current_rank_code",
            "source_testing_for_rank_text",
            "testing_for_rank",
            "testing_for_rank_code",
            "outcome_display",
            "attendance_status_display",
            "is_void",
            "void_reason",
            "voided_by_email",
        )
        read_only_fields = fields


class LinkLegacyRecordSerializer(serializers.Serializer):
    student = serializers.PrimaryKeyRelatedField(queryset=Student.objects.all())

    def update(
        self,
        instance: LegacyGradingRecord,
        validated_data: dict[str, Any],
    ) -> LegacyGradingRecord:
        request = self.context["request"]
        return link_legacy_record_to_student(
            instance,
            validated_data["student"],
            actor=cast(User, request.user),
        )


class ResolveLegacyRankSerializer(serializers.Serializer):
    """`rank=null` explicitly leaves the mapping unresolved."""

    rank = serializers.PrimaryKeyRelatedField(
        queryset=Rank.objects.filter(active=True),
        allow_null=True,
    )


class VoidLegacyRecordSerializer(serializers.Serializer):
    reason = serializers.CharField()

    def update(
        self,
        instance: LegacyGradingRecord,
        validated_data: dict[str, Any],
    ) -> LegacyGradingRecord:
        request = self.context["request"]
        return void_legacy_record(
            instance,
            reason=str(validated_data["reason"]),
            actor=cast(User, request.user),
        )


class WithdrawalReasonSerializer(serializers.Serializer[str]):
    """One withdrawal reason, from its code, and whether it needs a note."""

    code = serializers.ChoiceField(
        choices=GradingCandidate.WithdrawalReason.choices,
        source="*",
        read_only=True,
    )
    name = serializers.SerializerMethodField()
    note_required = serializers.SerializerMethodField()

    def get_name(self, code: str) -> str:
        return str(GradingCandidate.WithdrawalReason(code).label)

    def get_note_required(self, code: str) -> bool:
        return code == GradingCandidate.WithdrawalReason.OTHER
