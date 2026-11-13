from __future__ import annotations

from typing import Any, cast

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from accounts.people import PersonNameField
from accounts.permissions import FINAL_GRADING_DECISION_PERMISSION
from gradings.assessment_services import (
    assessment_can_be_prepared,
    assessment_can_start,
    assessment_marks_open,
    holds_final_decision,
    item_change_needs_reason,
    item_mark_can_be_cleared,
)
from gradings.exports.records import record_can_be_downloaded
from gradings.legacy_matching import Suggestion
from gradings.models import (
    AssessmentItemComment,
    AssessmentItemResultChange,
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    LegacyGradingRecord,
    LegacyRankField,
    Promotion,
    StagedDecision,
)
from gradings.outcome_services import (
    outcome_can_be_finalised,
)
from gradings.read_models import (
    CandidateNextAction,
    OverallAssessmentSummary,
    assessment_overall,
    candidate_assessment_summary,
    candidate_next_action,
)
from gradings.services import (
    WITHDRAWAL_REASON_REQUIRED_MESSAGE,
    AlreadyRegistered,
    cancelling_needs_reason,
    candidate_can_be_deleted,
    candidate_can_be_marked_absent,
    candidate_can_be_withdrawn_after_lock,
    candidate_can_change_session,
    may_override_locked_session,
    session_can_be_archived,
    session_can_be_restored,
    session_deletion_blocker,
    session_may_move_to,
    with_session_progress,
)
from kukgrade.serializers import ChoiceSerializer, ModelSerializer
from ranks.models import Rank
from students.models import Student
from syllabus.models import CORE_CATEGORIES, SyllabusItem


class GradingYearsSerializer(serializers.Serializer[dict[str, list[int]]]):
    years = serializers.ListField(child=serializers.IntegerField(), read_only=True)


class GradingSessionSerializer(ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    # Counted by gradings.services.with_session_progress.
    candidate_count = serializers.IntegerField(read_only=True)
    completed_assessment_count = serializers.IntegerField(read_only=True)
    awaiting_decision_count = serializers.IntegerField(read_only=True)
    withdrawn_count = serializers.IntegerField(
        read_only=True,
        help_text="How many of its candidates have been withdrawn.",
    )
    roster_open = serializers.BooleanField(
        read_only=True,
        help_text=(
            "Whether candidates can still be added, changed, removed and have "
            "their forms prepared: the session is draft or open."
        ),
    )
    marking_open = serializers.BooleanField(
        read_only=True,
        help_text=(
            "Whether candidates are being graded now: assessments are started, "
            "marked and completed while the session is open."
        ),
    )
    decisions_open = serializers.BooleanField(
        source="is_locked",
        read_only=True,
        help_text=(
            "Whether final decisions are being made now: the session is locked."
        ),
    )
    can_open = serializers.SerializerMethodField(
        help_text="Whether the viewer may open this session now.",
    )
    can_lock = serializers.SerializerMethodField(
        help_text=(
            "Whether the viewer may ask to lock this session now. Locking "
            "itself checks that every assessment is complete."
        ),
    )
    can_complete = serializers.SerializerMethodField(
        help_text=(
            "Whether the viewer may ask to complete this session now. "
            "Completing itself checks that every decision is recorded."
        ),
    )
    can_cancel = serializers.SerializerMethodField(
        help_text="Whether the viewer may cancel this session now.",
    )
    cancel_reason_required = serializers.SerializerMethodField(
        help_text="Whether cancelling it now needs a written reason.",
    )
    can_be_deleted = serializers.SerializerMethodField()
    can_be_archived = serializers.SerializerMethodField(
        help_text="Whether the viewer may archive this session now.",
    )
    can_be_restored = serializers.SerializerMethodField(
        help_text="Whether the viewer may restore this archived session.",
    )

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
            "candidate_count",
            "completed_assessment_count",
            "awaiting_decision_count",
            "withdrawn_count",
            "roster_open",
            "marking_open",
            "decisions_open",
            "can_open",
            "can_lock",
            "can_complete",
            "can_cancel",
            "cancel_reason_required",
            "can_be_deleted",
            "archived_at",
            "can_be_archived",
            "can_be_restored",
        )
        read_only_fields = (
            "id",
            "status_display",
            "archived_at",
        )

        # Sent when cancelling a locked session; no screen reads it back. It
        # is kept on the model and in the audit log.
        extra_kwargs = {"cancellation_reason": {"write_only": True}}

    def get_can_be_deleted(self, obj: GradingSession) -> bool:
        """Whether the requesting user may delete it, by the delete's own rule."""
        actor = self.context["request"].user
        return (
            session_deletion_blocker(
                obj,
                actor,
                has_recorded_work=obj.has_recorded_work,  # type: ignore[attr-defined]
                has_final_decisions=obj.has_final_decisions,  # type: ignore[attr-defined]
            )
            is None
        )

    def _may_move(self, obj: GradingSession, target: str) -> bool:
        return session_may_move_to(obj, target, self.context["request"].user)

    def get_can_open(self, obj: GradingSession) -> bool:
        return self._may_move(obj, GradingSession.Status.OPEN)

    def get_can_lock(self, obj: GradingSession) -> bool:
        return self._may_move(obj, GradingSession.Status.LOCKED)

    def get_can_complete(self, obj: GradingSession) -> bool:
        return self._may_move(obj, GradingSession.Status.COMPLETED)

    def get_can_cancel(self, obj: GradingSession) -> bool:
        return self._may_move(obj, GradingSession.Status.CANCELLED)

    def get_cancel_reason_required(self, obj: GradingSession) -> bool:
        return cancelling_needs_reason(obj)

    def get_can_be_archived(self, obj: GradingSession) -> bool:
        return session_can_be_archived(obj, self.context["request"].user)

    def get_can_be_restored(self, obj: GradingSession) -> bool:
        return session_can_be_restored(obj, self.context["request"].user)

    def to_representation(self, instance: GradingSession) -> dict[str, Any]:
        # A session just created or edited was not loaded through the
        # viewset's annotated queryset, so its counts are read now.
        if not hasattr(instance, "candidate_count"):
            instance = with_session_progress(
                GradingSession.objects.filter(pk=instance.pk),
            ).get()
        return super().to_representation(instance)


class GradingCandidateSerializer(ModelSerializer):
    age_band_display = serializers.CharField(
        source="get_age_band_display", read_only=True
    )
    # Blank on a candidate who is not withdrawn, so the schema admits "".
    withdrawal_reason = serializers.ChoiceField(
        choices=GradingCandidate.WithdrawalReason.choices,
        allow_blank=True,
        read_only=True,
    )
    student_display_name = serializers.SerializerMethodField()
    student_first_name = serializers.CharField(
        source="student.first_name",
        read_only=True,
    )
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
        return instance.student.full_name

    def get_can_be_moved(self, instance: GradingCandidate) -> bool:
        return candidate_can_change_session(instance)

    def get_can_be_removed(self, instance: GradingCandidate) -> bool:
        return candidate_can_be_deleted(instance)

    class Meta:
        model = GradingCandidate
        fields: tuple[str, ...] = (
            "id",
            "session",
            "student",
            "student_display_name",
            "student_first_name",
            "student_wksa_id",
            "from_rank",
            "from_rank_name",
            "testing_for_rank",
            "testing_for_rank_name",
            "age_band_display",
            "status",
            "withdrawal_reason",
            "withdrawal_reason_display",
            "withdrawal_note",
            "can_be_moved",
            "can_be_removed",
        )
        # PATCH moves a registration to another session and does nothing
        # else: withdrawal and status go through their own actions,
        # and the rest is fixed at registration.
        read_only_fields = (
            "id",
            "student",
            "testing_for_rank",
            "status",
            "withdrawal_note",
            "student_display_name",
            "student_wksa_id",
            "from_rank",
            "from_rank_name",
            "testing_for_rank_name",
            "age_band_display",
            "withdrawal_reason_display",
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


# One file's worth: the largest grading's whole roster, made well inside the
# server's time limit (gradings.exports).
EXPORT_LIMIT = 60


class CandidateExportSerializer(serializers.Serializer):
    """POST sessions/<id>/exports/records/: the candidates a file holds."""

    candidates = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
        max_length=EXPORT_LIMIT,
        help_text=(
            "The candidates to include, all registered in this session, all or "
            "nothing: a refusal is keyed by candidate id. The file lists them "
            "in the grading's order, whatever order they are given in."
        ),
        error_messages={
            "empty": "Choose at least one candidate.",
            "max_length": f"Choose at most {EXPORT_LIMIT} candidates for one file.",
        },
    )

    def validate_candidates(self, value: list[int]) -> list[int]:
        if len(set(value)) != len(value):
            raise serializers.ValidationError("A candidate is chosen twice.")
        return value


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

    can_complete = serializers.BooleanField(
        read_only=True,
        help_text=(
            "Whether the assessment can be completed now, as these counts leave "
            "it: in progress, every required item marked, the candidate not "
            "withdrawn and the session open."
        ),
    )

    overall = AssessmentSummaryCountsSerializer(read_only=True)
    categories = AssessmentCategorySummarySerializer(many=True, read_only=True)


class CandidateAssessmentSerializer(ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    candidate_student_name = serializers.CharField(
        source="candidate.student",
        read_only=True,
    )
    generated_by_name = PersonNameField("generated_by")
    # The served overall counts, so a list of assessments needs no
    # per-assessment summary request.
    overall = serializers.SerializerMethodField()
    marks_open = serializers.SerializerMethodField(
        help_text=(
            "Whether the viewer may change this assessment's marks, or comment on "
            "its items, now: while the session is open, or once it is locked and "
            "the viewer is the authorised Master and the candidate's final "
            "decision is not yet recorded."
        ),
    )

    can_start = serializers.SerializerMethodField(
        help_text=(
            "Whether the assessment can be started now: not started, its "
            "candidate not withdrawn, and the session open."
        ),
    )
    can_delete = serializers.SerializerMethodField(
        help_text=(
            "Whether the viewer may permanently delete this assessment: an "
            "administrator, while its candidate's final decision is not recorded."
        ),
    )

    class Meta:
        model = CandidateAssessment
        fields = (
            "id",
            "candidate",
            "candidate_student_name",
            "status",
            "status_display",
            "generated_by_name",
            "generated_at",
            "started_at",
            "completed_at",
            "notes",
            "overall",
            "marks_open",
            "can_start",
            "can_delete",
        )
        read_only_fields = (
            "id",
            "candidate",
            "candidate_student_name",
            "status_display",
            "generated_by_name",
            "generated_at",
            "started_at",
            "completed_at",
        )

    @extend_schema_field(AssessmentSummaryCountsSerializer)
    def get_overall(self, obj: CandidateAssessment) -> OverallAssessmentSummary:
        return assessment_overall(obj)

    def get_marks_open(self, obj: CandidateAssessment) -> bool:
        return assessment_marks_open(obj, self.context["request"].user)

    def get_can_start(self, obj: CandidateAssessment) -> bool:
        return assessment_can_start(obj)

    def get_can_delete(self, obj: CandidateAssessment) -> bool:
        user = self.context["request"].user
        return user.has_perm("gradings.delete_candidateassessment") and not (
            holds_final_decision(obj.candidate)
        )


class AssessmentItemCommentSerializer(ModelSerializer):
    author_name = PersonNameField("author")

    class Meta:
        model = AssessmentItemComment
        fields = ("id", "author_name", "body", "created_at", "after_lock")
        read_only_fields = fields


COMMENT_MAX_LENGTH = 2000
REASON_MAX_LENGTH = 2000


class AssessmentItemResultChangeSerializer(ModelSerializer):
    from_result_display = serializers.CharField(
        source="get_from_result_display",
        read_only=True,
    )
    to_result_display = serializers.CharField(
        source="get_to_result_display",
        read_only=True,
    )
    changed_by_name = PersonNameField("changed_by")

    class Meta:
        model = AssessmentItemResultChange
        fields = (
            "sequence",
            "from_result",
            "from_result_display",
            "to_result",
            "to_result_display",
            "changed_by_name",
            "changed_at",
            "reason",
            "after_lock",
        )
        read_only_fields = fields


class AssessmentItemCommentRequestSerializer(serializers.Serializer):
    body = serializers.CharField(
        max_length=COMMENT_MAX_LENGTH,
        trim_whitespace=True,
        error_messages={
            "required": "Write a comment to add.",
            "blank": "Write a comment to add.",
            "max_length": (
                f"A comment can be at most {COMMENT_MAX_LENGTH} characters. "
                "Shorten it, or add the rest as a second comment."
            ),
        },
    )


class CandidateAssessmentItemSerializer(ModelSerializer):
    category_display = serializers.CharField(
        source="get_category_display",
        read_only=True,
    )
    result_display = serializers.CharField(source="get_result_display", read_only=True)
    comments = AssessmentItemCommentSerializer(many=True, read_only=True)
    changes = AssessmentItemResultChangeSerializer(many=True, read_only=True)
    reason = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        max_length=REASON_MAX_LENGTH,
        help_text=(
            "Why the mark is changing. Not needed for the first mark on an item; "
            "needed for every later change, including clearing it."
        ),
        error_messages={
            "max_length": (f"A reason can be at most {REASON_MAX_LENGTH} characters."),
        },
    )
    assessor_name = PersonNameField("assessor")
    display_range = serializers.CharField(read_only=True)
    category_is_core = serializers.SerializerMethodField(
        help_text=(
            "Whether the category is one of the six core grading areas every "
            "rank shares, rather than rank-specific content."
        ),
    )
    reason_required = serializers.SerializerMethodField(
        help_text=(
            "Whether the next change to this mark must say why: every change "
            "after the first does, and after the lock every one does."
        ),
    )
    can_clear = serializers.SerializerMethodField(
        help_text=(
            "Whether this mark may be taken away: it has one, and a completed "
            "assessment keeps every required item marked. Whether the viewer "
            "may change marks at all is the assessment's marks_open."
        ),
    )

    class Meta:
        model = CandidateAssessmentItem
        fields = (
            "id",
            "item_name",
            "korean_name",
            "category",
            "category_display",
            "category_is_core",
            "position",
            "required",
            "display_range",
            "requirement_notes",
            "notation",
            "result",
            "result_display",
            "assessor_name",
            "assessed_at",
            "comments",
            "changes",
            "reason",
            "reason_required",
            "can_clear",
        )
        read_only_fields = (
            "id",
            "item_name",
            "korean_name",
            "category",
            "category_display",
            "category_is_core",
            "position",
            "required",
            "display_range",
            "requirement_notes",
            "notation",
            "result_display",
            "assessor_name",
            "assessed_at",
        )

    def get_category_is_core(self, obj: CandidateAssessmentItem) -> bool:
        return obj.category in CORE_CATEGORIES

    def get_reason_required(self, obj: CandidateAssessmentItem) -> bool:
        # The served log, so a list of items asks nothing more of the database.
        return item_change_needs_reason(obj, has_changes=bool(obj.changes.all()))

    def get_can_clear(self, obj: CandidateAssessmentItem) -> bool:
        return item_mark_can_be_cleared(obj)


class CandidateAssessmentItemSavedSerializer(CandidateAssessmentItemSerializer):
    """What a mark returns: the item, and the assessment's rollup as the save
    left it, so a screen need not ask for the counts again. Only the write
    carries it; the list of items is unchanged."""

    assessment_summary = serializers.SerializerMethodField(
        help_text=(
            "The assessment's overall and per-category counts after this save, "
            "the same as GET assessments/<id>/summary/."
        ),
    )

    class Meta(CandidateAssessmentItemSerializer.Meta):
        fields = (  # type: ignore[assignment]
            *CandidateAssessmentItemSerializer.Meta.fields,
            "assessment_summary",
        )

    @extend_schema_field(CandidateAssessmentSummarySerializer)
    def get_assessment_summary(self, obj: CandidateAssessmentItem) -> dict[str, Any]:
        summary = candidate_assessment_summary(obj.assessment)
        data = CandidateAssessmentSummarySerializer(summary).data
        return cast(dict[str, Any], data)


class CandidateOutcomeSerializer(ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    proposed_outcome_display = serializers.CharField(
        source="get_proposed_outcome_display",
        read_only=True,
        allow_null=True,
    )
    final_outcome_display = serializers.CharField(
        source="get_final_outcome_display",
        read_only=True,
        allow_null=True,
        help_text="Null until the final decision is recorded.",
    )
    proposed_by_name = PersonNameField("proposed_by")
    decided_by_name = PersonNameField("decided_by")

    class Meta:
        model = CandidateOutcome
        fields = (
            "id",
            "candidate",
            "status",
            "status_display",
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


class PromotionSerializer(ModelSerializer):
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


class GradingCandidateRosterSerializer(GradingCandidateSerializer):
    """A candidate as the session's roster shows them: with their assessment
    and outcome, and what their row offers next, so a screen needs one request
    and holds no lifecycle rules of its own."""

    assessment = CandidateAssessmentSerializer(read_only=True, allow_null=True)
    outcome = CandidateOutcomeSerializer(read_only=True, allow_null=True)
    promotion = serializers.SerializerMethodField(
        help_text=(
            "The promotion recorded for this candidate, when they have one and "
            "the viewer may see promotions; otherwise null."
        ),
    )
    next_action = serializers.SerializerMethodField()
    can_be_finalised = serializers.SerializerMethodField(
        help_text=(
            "Whether a final decision can be recorded for this candidate now: "
            "their outcome is proposed in a locked session. Whether the viewer "
            "may make it is their own authority."
        ),
    )
    can_be_marked_absent = serializers.SerializerMethodField(
        help_text=(
            "Whether the candidate can be withdrawn as a no-show now: registered, "
            "the session draft or open, and their assessment not started."
        ),
    )
    can_prepare_assessment = serializers.SerializerMethodField(
        help_text=(
            "Whether the candidate's assessment form can be prepared now: they "
            "have none, are not withdrawn, and the session is draft or open."
        ),
    )
    can_be_withdrawn_after_lock = serializers.SerializerMethodField(
        help_text=(
            "Whether the viewer may withdraw this candidate now: the session is "
            "locked, the candidate is not withdrawn and has no final decision, "
            "and the viewer holds the locked-session override."
        ),
    )
    can_download_record = serializers.SerializerMethodField(
        help_text=(
            "Whether this candidate's record can be downloaded as a PDF: their "
            "assessment is sealed."
        ),
    )

    class Meta(GradingCandidateSerializer.Meta):
        fields = (
            *GradingCandidateSerializer.Meta.fields,
            "assessment",
            "outcome",
            "promotion",
            "next_action",
            "can_be_finalised",
            "can_be_withdrawn_after_lock",
            "can_be_marked_absent",
            "can_prepare_assessment",
            "can_download_record",
        )

    @extend_schema_field(PromotionSerializer(allow_null=True))
    def get_promotion(self, instance: GradingCandidate) -> dict[str, Any] | None:
        promotion = getattr(instance, "promotion", None)
        user = self.context["request"].user
        if promotion is None or not user.has_perm("gradings.view_promotion"):
            return None
        return cast(dict[str, Any], PromotionSerializer(promotion).data)

    def get_can_be_finalised(self, instance: GradingCandidate) -> bool:
        outcome = getattr(instance, "outcome", None)
        return outcome is not None and outcome_can_be_finalised(outcome)

    def get_can_be_marked_absent(self, instance: GradingCandidate) -> bool:
        return candidate_can_be_marked_absent(instance)

    def get_can_prepare_assessment(self, instance: GradingCandidate) -> bool:
        return assessment_can_be_prepared(instance)

    def get_can_download_record(self, instance: GradingCandidate) -> bool:
        return record_can_be_downloaded(instance)

    def get_can_be_withdrawn_after_lock(self, instance: GradingCandidate) -> bool:
        # Asked once for the whole list: the context is shared by every row.
        if "may_override_locked_session" not in self.context:
            self.context["may_override_locked_session"] = may_override_locked_session(
                self.context["request"].user
            )
        return candidate_can_be_withdrawn_after_lock(
            instance,
            may_override=self.context["may_override_locked_session"],
        )

    @extend_schema_field(serializers.ChoiceField(choices=CandidateNextAction.choices))
    def get_next_action(self, instance: GradingCandidate) -> str:
        user = self.context["request"].user
        return candidate_next_action(
            instance,
            can_make_final_decision=user.has_perm(FINAL_GRADING_DECISION_PERMISSION),
        )


class CandidateOutcomeProposalSerializer(serializers.Serializer):
    proposed_outcome = serializers.ChoiceField(choices=CandidateOutcome.Outcome.choices)
    proposal_notes = serializers.CharField(
        allow_blank=True,
        required=False,
        trim_whitespace=True,
    )


_REVISION_MESSAGE = "Send which change this is."


def _revision_field() -> serializers.IntegerField:
    """Which change to a staged decision a write is: a number that only goes up."""
    return serializers.IntegerField(
        min_value=1,
        error_messages={
            "required": _REVISION_MESSAGE,
            "invalid": _REVISION_MESSAGE,
            "min_value": _REVISION_MESSAGE,
        },
    )


class StagedDecisionSerializer(ModelSerializer):
    """A final decision chosen but not yet recorded, seen only by whoever chose it."""

    revision = _revision_field()

    # Kept as typed, so it comes back as it was left; recording trims it.
    decision_notes = serializers.CharField(
        allow_blank=True,
        required=False,
        trim_whitespace=False,
    )
    conditional_requirements = serializers.CharField(
        allow_blank=True,
        required=False,
        trim_whitespace=False,
    )

    class Meta:
        model = StagedDecision
        fields = [
            "outcome",
            "final_outcome",
            "decision_notes",
            "conditional_requirements",
            "revision",
            "updated_at",
        ]
        read_only_fields = ["outcome", "updated_at"]


class KeptStagedDecisionSerializer(StagedDecisionSerializer):
    """
    A staged decision as the board reads it back. A decision taken off is
    listed too, `discarded` and with no outcome, so the board knows its
    revision and starts every later change above it, whatever this device's
    clock says.
    """

    final_outcome = serializers.ChoiceField(
        choices=CandidateOutcome.Outcome.choices,
        allow_blank=True,
        read_only=True,
    )

    class Meta(StagedDecisionSerializer.Meta):
        fields = [*StagedDecisionSerializer.Meta.fields, "discarded"]
        read_only_fields = fields


class StagedDecisionDiscardQuerySerializer(serializers.Serializer):
    """Which change taking a staged decision off is."""

    revision = _revision_field()


class CandidateOutcomeFinaliseSerializer(serializers.Serializer):
    """The final decision. It is always given whole: final_outcome is required."""

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

    # Never a partial update, though it arrives as a PATCH: the schema
    # generator reads every PATCH body as partial (dropping final_outcome's
    # "required") unless the serializer refuses to be.
    @property
    def partial(self) -> bool:
        return False

    @partial.setter
    def partial(self, value: bool) -> None:
        pass


class CandidatePromotionSerializer(serializers.Serializer):
    notes = serializers.CharField(
        allow_blank=True,
        required=False,
        trim_whitespace=True,
    )


_CHOOSE_A_SESSION = "Choose a grading session."


class SessionQuerySerializer(serializers.Serializer):
    """The grading session a session-wide read is about."""

    session = serializers.IntegerField(
        min_value=1,
        error_messages={
            "required": _CHOOSE_A_SESSION,
            "invalid": _CHOOSE_A_SESSION,
            "min_value": _CHOOSE_A_SESSION,
        },
    )


class PromotionEligibilitySerializer(serializers.Serializer):
    candidate = serializers.IntegerField()
    outcome = serializers.IntegerField(allow_null=True)
    eligible = serializers.BooleanField()
    reason = serializers.CharField(allow_blank=True)


class BulkPromotionSerializer(serializers.Serializer):
    outcomes = serializers.PrimaryKeyRelatedField(
        queryset=CandidateOutcome.objects.all(),
        many=True,
        allow_empty=False,
    )


# The response of every bulk endpoint: what succeeded, under an
# endpoint-specific key, plus `errors` mapping the id each refused row named
# -> that row's messages. A comment rather than a docstring, which
# drf-spectacular would inherit as each subclass's description.
class BulkResultSerializer(serializers.Serializer):
    # Collides with Serializer.errors only in the type stubs: the serializer
    # metaclass lifts declared fields out of the class namespace.
    errors = serializers.DictField(  # type: ignore[assignment]
        child=serializers.ListField(child=serializers.CharField()),
        help_text=(
            "Each refused row's reasons, keyed by the id that row named: the "
            "student for a registration, the candidate, assessment or outcome "
            "otherwise."
        ),
    )


class RegisteredCandidateSerializer(serializers.Serializer):
    candidate = GradingCandidateSerializer()
    assessment = CandidateAssessmentSerializer(allow_null=True)


class BulkCandidateRegistrationResultSerializer(BulkResultSerializer):
    created = RegisteredCandidateSerializer(many=True)
    already_registered = serializers.DictField(
        child=serializers.ChoiceField(choices=AlreadyRegistered.choices),
        help_text=(
            "The students (keys of `errors`) already registered, for this "
            "session or for another grading that has not settled: nothing to "
            "retry, unlike the other failures."
        ),
    )


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


class LegacyGradingRecordSerializer(ModelSerializer):
    """Read-mostly, matching PromotionSerializer's idiom - no ordinary
    update/delete exists (LegacyGradingRecord is kukgrade.kept), only
    the reconciliation actions on LegacyGradingRecordViewSet."""

    outcome_display = serializers.CharField(
        source="get_outcome_display",
        read_only=True,
        allow_null=True,
    )
    attendance_status_display = serializers.CharField(
        source="get_attendance_status_display",
        read_only=True,
    )
    record_kind_display = serializers.CharField(
        source="get_record_kind_display",
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
    voided_by_name = PersonNameField("voided_by")
    current_rank_name = serializers.CharField(
        source="current_rank.name",
        read_only=True,
        allow_null=True,
        default=None,
    )
    testing_for_rank_name = serializers.CharField(
        source="testing_for_rank.name",
        read_only=True,
        allow_null=True,
        default=None,
    )
    report = serializers.CharField(
        source="comments",
        read_only=True,
        help_text="The grading report: the record's comments, as written.",
    )
    note = serializers.CharField(
        source="admin_note",
        read_only=True,
        help_text="Anything else the sheet said beside the record, as written.",
    )

    class Meta:
        model = LegacyGradingRecord
        fields = (
            "id",
            "student",
            "student_display_name",
            "record_kind",
            "record_kind_display",
            "cycle_year",
            "cycle_month",
            "source_batch",
            "source_section",
            "source_name",
            "source_current_rank_text",
            "current_rank",
            "current_rank_code",
            "current_rank_name",
            "source_testing_for_rank_text",
            "testing_for_rank",
            "testing_for_rank_code",
            "testing_for_rank_name",
            "outcome_display",
            "attendance_status_display",
            "report",
            "note",
            "is_void",
            "void_reason",
            "voided_by_name",
        )
        read_only_fields = fields


class LinkLegacyRecordSerializer(serializers.Serializer):
    student = serializers.PrimaryKeyRelatedField(queryset=Student.objects.all())
    replace = serializers.BooleanField(
        required=False,
        default=False,
        help_text="Move a record already linked to another student.",
    )


class LegacyRecordLinkSerializer(serializers.Serializer):
    record = serializers.PrimaryKeyRelatedField(
        queryset=LegacyGradingRecord.objects.all(),
    )
    student = serializers.PrimaryKeyRelatedField(queryset=Student.objects.all())


# One request's worth: a person's whole history is tens of records.
BULK_LINK_LIMIT = 500


class BulkLinkLegacyRecordsSerializer(serializers.Serializer):
    """POST legacy-records/bulk-link/: many records, each to its student."""

    links = LegacyRecordLinkSerializer(many=True, allow_empty=False)
    replace = serializers.BooleanField(
        required=False,
        default=False,
        help_text="Move records already linked to another student.",
    )

    def validate_links(self, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if len(value) > BULK_LINK_LIMIT:
            raise serializers.ValidationError(
                f"Link at most {BULK_LINK_LIMIT} records at a time.",
            )
        return value


class BulkUnlinkLegacyRecordsSerializer(serializers.Serializer):
    """POST legacy-records/bulk-unlink/: let go of many records at once."""

    records = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
        max_length=BULK_LINK_LIMIT,
        help_text=(
            "The records to unlink from their students, all or nothing - "
            "the undo of a bulk link. Errors are keyed by record id."
        ),
    )


class SuggestedStudentSerializer(serializers.Serializer):
    student = serializers.IntegerField(source="student.pk")
    full_name = serializers.CharField(source="student.full_name")
    wksa_id = serializers.CharField(source="student.wksa_id")
    current_rank_name = serializers.CharField(source="student.current_rank.name")
    status_display = serializers.CharField(source="student.get_status_display")
    score = serializers.IntegerField(help_text="Higher fits better; for ordering.")
    reasons = serializers.ListField(
        child=serializers.CharField(),
        help_text="Why the student is suggested, in plain words.",
    )


class LegacyPersonSerializer(serializers.Serializer):
    """The records that name one person the same way, and who they may be."""

    source_name = serializers.CharField()
    group_key = serializers.CharField(source="key")
    record_ids = serializers.SerializerMethodField()
    records = serializers.SerializerMethodField(help_text="How many records.")
    first_period = serializers.CharField()
    last_period = serializers.CharField()
    linked_student = serializers.SerializerMethodField(
        help_text="The student every record here is linked to, if one is.",
    )
    shared = serializers.BooleanField(
        help_text="Several students fit equally well: a person has to choose.",
    )
    linked_student_name = serializers.SerializerMethodField(
        help_text="That student's name, when every record here is linked to one.",
    )
    ranks = serializers.ListField(
        child=serializers.CharField(),
        source="ranks_written",
        help_text="The ranks the records give, as written, in date order.",
    )
    needs_rank = serializers.BooleanField(
        help_text="Whether a rank is written on a record but not matched to one yet.",
    )
    suggestion = serializers.ChoiceField(
        choices=Suggestion.choices,
        help_text="How clear the suggested students are, from the candidates.",
    )
    candidates = SuggestedStudentSerializer(many=True)

    def get_record_ids(self, group: Any) -> list[int]:
        return [record.pk for record in group.records]

    def get_records(self, group: Any) -> int:
        return len(group.records)

    @extend_schema_field(serializers.IntegerField(allow_null=True))
    def get_linked_student(self, group: Any) -> int | None:
        student = group.linked_student
        return student.pk if student else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_linked_student_name(self, group: Any) -> str | None:
        student = group.linked_student
        return student.full_name if student else None


class SetAsideNamesSerializer(serializers.Serializer):
    """Names put aside on the linking page, as group keys."""

    group_keys = serializers.ListField(
        child=serializers.CharField(max_length=255),
        min_length=1,
        max_length=100,
    )


class LegacyRecordCountsSerializer(serializers.Serializer):
    awaiting_link = serializers.IntegerField(
        help_text=(
            "Someone's records not yet linked to a student: not voided, not a "
            "sheet note."
        ),
    )


class LegacyPeopleSummarySerializer(serializers.Serializer):
    """Names still to link, by how clear their suggested students are, and the
    other counts the linking screens show."""

    names = serializers.IntegerField(help_text="Names with a record still to link.")
    linked = serializers.IntegerField(
        help_text="Names with every record linked; set_aside does not apply.",
    )
    with_a_link = serializers.IntegerField(
        help_text="Names with any record linked; set_aside does not apply.",
    )
    set_aside = serializers.IntegerField(
        help_text="Names still to link that the viewer has put aside for now.",
    )

    clear = serializers.IntegerField(help_text="One student fits clearly.")
    choose = serializers.IntegerField(help_text="Several students fit equally well.")
    none = serializers.IntegerField(help_text="No student fits.")


class ResolveLegacyRankSerializer(serializers.Serializer):
    """Which of the record's ranks to map; `rank=null` explicitly leaves it
    unresolved."""

    field = serializers.ChoiceField(choices=LegacyRankField.choices)
    rank = serializers.PrimaryKeyRelatedField(
        queryset=Rank.objects.filter(active=True),
        allow_null=True,
    )


class VoidLegacyRecordSerializer(serializers.Serializer):
    reason = serializers.CharField()


class WithdrawalReasonSerializer(ChoiceSerializer):
    """One withdrawal reason, and whether it needs a note."""

    value = serializers.ChoiceField(choices=GradingCandidate.WithdrawalReason.choices)
    note_required = serializers.SerializerMethodField()

    def get_note_required(self, reason: dict[str, str]) -> bool:
        return reason["value"] == GradingCandidate.WithdrawalReason.OTHER
