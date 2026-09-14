from __future__ import annotations

from typing import Any, NoReturn, cast

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from rest_framework import serializers

from accounts.models import User
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    Promotion,
)
from gradings.services import (
    build_candidate,
    finalise_candidate_outcome,
    promote_candidate,
    propose_candidate_outcome,
    transition_grading_session,
    update_candidate,
    update_candidate_assessment,
    update_candidate_assessment_item,
    validate_session_grading_date_change,
    validate_session_transition,
    withdraw_locked_candidate,
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
            "cancellation_reason",
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
                    session=self.instance,
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
        target_status = cast(str | None, validated_data.pop("status", None))
        reason = cast(str, validated_data.pop("cancellation_reason", ""))
        try:
            with transaction.atomic():
                if validated_data:
                    instance = cast(
                        GradingSession,
                        super().update(instance, validated_data),
                    )
                if target_status is not None and target_status != instance.status:
                    instance = transition_grading_session(
                        instance,
                        target_status,
                        actor=self.context["request"].user,
                        reason=reason,
                    )
                return instance
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


class CandidateAssessmentSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    candidate_student_name = serializers.CharField(
        source="candidate.student",
        read_only=True,
    )
    candidate_student_wksa_id = serializers.CharField(
        source="candidate.student.wksa_id",
        read_only=True,
    )
    testing_for_rank_code = serializers.CharField(
        source="candidate.testing_for_rank.code",
        read_only=True,
    )
    testing_for_rank_name = serializers.CharField(
        source="candidate.testing_for_rank.name",
        read_only=True,
    )
    age_band = serializers.CharField(source="candidate.age_band", read_only=True)
    age_band_display = serializers.CharField(
        source="candidate.get_age_band_display",
        read_only=True,
    )
    generated_by_email = serializers.EmailField(
        source="generated_by.email",
        read_only=True,
    )
    item_counts = serializers.SerializerMethodField()

    class Meta:
        model = CandidateAssessment
        fields = (
            "id",
            "candidate",
            "candidate_student_name",
            "candidate_student_wksa_id",
            "testing_for_rank_code",
            "testing_for_rank_name",
            "age_band",
            "age_band_display",
            "status",
            "status_display",
            "generated_by",
            "generated_by_email",
            "generated_at",
            "started_at",
            "completed_at",
            "notes",
            "item_counts",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "candidate",
            "candidate_student_name",
            "candidate_student_wksa_id",
            "testing_for_rank_code",
            "testing_for_rank_name",
            "age_band",
            "age_band_display",
            "status_display",
            "generated_by",
            "generated_by_email",
            "generated_at",
            "started_at",
            "completed_at",
            "item_counts",
            "created_at",
            "updated_at",
        )

    def get_item_counts(self, obj: CandidateAssessment) -> dict[str, int]:
        items = list(obj.items.all())
        return {
            "total": len(items),
            "required": sum(1 for item in items if item.required),
            "met": sum(
                1 for item in items if item.result == CandidateAssessmentItem.Result.MET
            ),
            "not_met": sum(
                1
                for item in items
                if item.result == CandidateAssessmentItem.Result.NOT_MET
            ),
            "not_assessed": sum(
                1
                for item in items
                if item.result == CandidateAssessmentItem.Result.NOT_ASSESSED
            ),
        }

    def update(
        self,
        instance: CandidateAssessment,
        validated_data: dict[str, Any],
    ) -> CandidateAssessment:
        try:
            return update_candidate_assessment(
                instance,
                status=cast(str | None, validated_data.get("status")),
                notes=cast(str | None, validated_data.get("notes")),
            )
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)


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
            "assessment",
            "source_requirement",
            "source_item",
            "source_rank",
            "source_age_band",
            "item_code",
            "item_name",
            "korean_name",
            "category",
            "category_display",
            "requirement_sequence",
            "required",
            "start_number",
            "end_number",
            "display_range",
            "requirement_notes",
            "result",
            "result_display",
            "assessor",
            "assessor_email",
            "assessed_at",
            "assessor_notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "assessment",
            "source_requirement",
            "source_item",
            "source_rank",
            "source_age_band",
            "item_code",
            "item_name",
            "korean_name",
            "category",
            "category_display",
            "requirement_sequence",
            "required",
            "start_number",
            "end_number",
            "display_range",
            "requirement_notes",
            "result_display",
            "assessor",
            "assessor_email",
            "assessed_at",
            "created_at",
            "updated_at",
        )

    def update(
        self,
        instance: CandidateAssessmentItem,
        validated_data: dict[str, Any],
    ) -> CandidateAssessmentItem:
        request = self.context["request"]
        try:
            return update_candidate_assessment_item(
                instance,
                result=cast(str | None, validated_data.get("result")),
                assessor_notes=cast(str | None, validated_data.get("assessor_notes")),
                assessor=request.user,
            )
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)


class CandidateOutcomeSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    proposed_outcome_display = serializers.CharField(
        source="get_proposed_outcome_display",
        read_only=True,
    )
    final_outcome_display = serializers.CharField(
        source="get_final_outcome_display",
        read_only=True,
    )
    student = serializers.IntegerField(source="candidate.student_id", read_only=True)
    student_display_name = serializers.CharField(
        source="candidate.student",
        read_only=True,
    )
    student_wksa_id = serializers.CharField(
        source="candidate.student.wksa_id",
        read_only=True,
    )
    session = serializers.IntegerField(source="candidate.session_id", read_only=True)
    session_title = serializers.CharField(
        source="candidate.session.title",
        read_only=True,
    )
    testing_for_rank = serializers.IntegerField(
        source="candidate.testing_for_rank_id",
        read_only=True,
    )
    testing_for_rank_code = serializers.CharField(
        source="candidate.testing_for_rank.code",
        read_only=True,
    )
    testing_for_rank_name = serializers.CharField(
        source="candidate.testing_for_rank.name",
        read_only=True,
    )
    assessment_status = serializers.CharField(
        source="assessment.status",
        read_only=True,
    )
    proposed_by_email = serializers.EmailField(
        source="proposed_by.email",
        read_only=True,
    )
    proposed_by_name = serializers.CharField(
        source="proposed_by.get_full_name",
        read_only=True,
    )
    decided_by_email = serializers.EmailField(
        source="decided_by.email",
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
            "assessment",
            "assessment_status",
            "student",
            "student_display_name",
            "student_wksa_id",
            "session",
            "session_title",
            "testing_for_rank",
            "testing_for_rank_code",
            "testing_for_rank_name",
            "status",
            "status_display",
            "proposed_outcome",
            "proposed_outcome_display",
            "proposed_by",
            "proposed_by_email",
            "proposed_by_name",
            "proposed_at",
            "proposal_notes",
            "final_outcome",
            "final_outcome_display",
            "decided_by",
            "decided_by_email",
            "decided_by_name",
            "decided_at",
            "decision_notes",
            "conditional_requirements",
            "created_at",
            "updated_at",
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
        try:
            return propose_candidate_outcome(
                instance,
                proposed_outcome=str(validated_data["proposed_outcome"]),
                proposal_notes=str(validated_data.get("proposal_notes", "")),
                actor=cast(User, request.user),
            )
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)

    def create(self, validated_data: dict[str, Any]) -> CandidateOutcome:
        raise NotImplementedError


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
        try:
            return finalise_candidate_outcome(
                instance,
                final_outcome=str(validated_data["final_outcome"]),
                decision_notes=str(validated_data.get("decision_notes", "")),
                conditional_requirements=str(
                    validated_data.get("conditional_requirements", ""),
                ),
                actor=cast(User, request.user),
            )
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)

    def create(self, validated_data: dict[str, Any]) -> CandidateOutcome:
        raise NotImplementedError


class PromotionSerializer(serializers.ModelSerializer):
    student_display_name = serializers.CharField(source="student", read_only=True)
    student_wksa_id = serializers.CharField(source="student.wksa_id", read_only=True)
    student_current_rank = serializers.IntegerField(
        source="student.current_rank_id",
        read_only=True,
    )
    student_current_rank_code = serializers.CharField(
        source="student.current_rank.code",
        read_only=True,
    )
    student_current_rank_name = serializers.CharField(
        source="student.current_rank.name",
        read_only=True,
    )
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
            "student",
            "student_display_name",
            "student_wksa_id",
            "student_current_rank",
            "student_current_rank_code",
            "student_current_rank_name",
            "outcome",
            "grading_candidate",
            "session",
            "session_title",
            "grading_date",
            "from_rank",
            "from_rank_code",
            "from_rank_name",
            "to_rank",
            "to_rank_code",
            "to_rank_name",
            "promoted_by",
            "promoted_by_email",
            "promoted_by_name",
            "promoted_at",
            "effective_date",
            "notes",
            "created_at",
            "updated_at",
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
        try:
            return promote_candidate(
                instance,
                actor=cast(User, request.user),
                notes=str(validated_data.get("notes", "")),
            )
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)

    def create(self, validated_data: dict[str, Any]) -> Promotion:
        raise NotImplementedError


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
        try:
            return withdraw_locked_candidate(
                instance,
                reason=str(validated_data["withdrawal_reason"]),
                note=str(validated_data.get("withdrawal_note", "")),
                actor=cast(User, request.user),
            )
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)

    def create(self, validated_data: dict[str, Any]) -> GradingCandidate:
        raise NotImplementedError
