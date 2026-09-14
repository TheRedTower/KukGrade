from __future__ import annotations

from typing import Any, cast

from django.contrib import admin, messages
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.forms import ModelForm
from django.http import HttpRequest

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
    transition_grading_session,
    update_candidate,
    update_candidate_assessment,
    update_candidate_assessment_item,
    validate_candidate_can_be_deleted,
    validate_grading_session_transition,
    validate_session_can_be_deleted,
    validate_session_grading_date_change,
)


class GradingSessionAdminForm(ModelForm):
    class Meta:
        model = GradingSession
        fields = (
            "title",
            "grading_date",
            "status",
            "location",
            "notes",
            "created_by",
        )

    def clean(self) -> dict[str, Any]:
        cleaned_data = super().clean() or {}
        if self.instance.pk and "status" in self.changed_data:
            target_status = cleaned_data.get("status")
            if target_status is not None:
                try:
                    validate_grading_session_transition(
                        self.instance,
                        str(target_status),
                    )
                except DjangoValidationError as exc:
                    messages = (
                        exc.message_dict.get("status")
                        if hasattr(exc, "message_dict")
                        else exc.messages
                    ) or exc.messages
                    self.add_error("status", messages)
        return cleaned_data


class StateGatedDeleteMixin:
    """Applies the service deletion rule to both admin delete paths.

    The change page hides Delete when the rule refuses, and the changelist
    bulk action refuses as a whole rather than part-deleting a selection.
    Without this, admin bulk delete walked past rules the API enforced -
    and instructors now hold the delete permissions, so the changelist is
    the most reachable way to reach them.
    """

    deletion_validator: Any

    def has_delete_permission(
        self,
        request: HttpRequest,
        obj: Any = None,
    ) -> bool:
        if not super().has_delete_permission(request, obj):  # type: ignore[misc]
            return False
        if obj is None:
            return True
        try:
            type(self).deletion_validator(obj)
        except DjangoValidationError:
            return False
        return True

    def delete_queryset(self, request: HttpRequest, queryset: Any) -> None:
        blocked = [obj for obj in queryset if not self._is_deletable(obj)]
        if blocked:
            self.message_user(  # type: ignore[attr-defined]
                request,
                (
                    f"Nothing was deleted. {len(blocked)} of the selected "
                    f"records cannot be deleted in their current state: "
                    f"{', '.join(str(obj) for obj in blocked[:5])}"
                ),
                level=messages.ERROR,
            )
            return
        queryset.delete()

    def _is_deletable(self, obj: Any) -> bool:
        try:
            type(self).deletion_validator(obj)
        except DjangoValidationError:
            return False
        return True


@admin.register(GradingSession)
class GradingSessionAdmin(StateGatedDeleteMixin, admin.ModelAdmin):
    deletion_validator = staticmethod(validate_session_can_be_deleted)
    form = GradingSessionAdminForm
    list_display = (
        "title",
        "grading_date",
        "status",
        "location",
        "created_by",
    )
    list_filter = ("status", "grading_date")
    search_fields = ("title", "location")
    ordering = ("-grading_date", "created_at")
    list_select_related = ("created_by",)

    def save_model(
        self,
        request: HttpRequest,
        obj: GradingSession,
        form: ModelForm,
        change: bool,
    ) -> None:
        changed_data = set(form.changed_data)
        if not change or "status" not in changed_data:
            if change and "grading_date" in changed_data:
                validate_session_grading_date_change(obj)
            super().save_model(request, obj, form, change)
            return

        target_status = obj.status
        persisted_status = GradingSession.objects.values_list(
            "status",
            flat=True,
        ).get(pk=obj.pk)
        obj.status = persisted_status
        with transaction.atomic():
            if changed_data - {"status"}:
                if "grading_date" in changed_data:
                    validate_session_grading_date_change(obj)
                super().save_model(request, obj, form, change)
            transitioned = transition_grading_session(
                obj,
                target_status,
                actor=cast(User, request.user),
            )
        obj.status = transitioned.status


@admin.register(CandidateAssessment)
class CandidateAssessmentAdmin(admin.ModelAdmin):
    list_display = (
        "candidate",
        "student",
        "session",
        "status",
        "generated_by",
        "generated_at",
        "started_at",
        "completed_at",
    )
    list_filter = (
        "status",
        "candidate__session",
        "candidate__testing_for_rank",
        "candidate__age_band",
    )
    search_fields = (
        "candidate__student__first_name",
        "candidate__student__last_name",
        "candidate__student__wksa_id",
    )
    ordering = (
        "candidate__session__grading_date",
        "candidate__student__last_name",
        "candidate__student__first_name",
    )
    list_select_related = (
        "candidate__session",
        "candidate__student",
        "candidate__testing_for_rank",
        "generated_by",
    )
    readonly_fields = (
        "candidate",
        "generated_by",
        "generated_at",
        "started_at",
        "completed_at",
        "created_at",
        "updated_at",
    )

    @admin.display(ordering="candidate__student__last_name")
    def student(self, obj: CandidateAssessment) -> object:
        return obj.candidate.student

    @admin.display(ordering="candidate__session__grading_date")
    def session(self, obj: CandidateAssessment) -> object:
        return obj.candidate.session

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_delete_permission(
        self,
        request: HttpRequest,
        obj: CandidateAssessment | None = None,
    ) -> bool:
        return False

    def save_model(
        self,
        request: HttpRequest,
        obj: CandidateAssessment,
        form: ModelForm,
        change: bool,
    ) -> None:
        if change:
            update_candidate_assessment(
                obj,
                status=obj.status if "status" in form.changed_data else None,
                notes=obj.notes if "notes" in form.changed_data else None,
            )
        else:
            super().save_model(request, obj, form, change)


@admin.register(CandidateAssessmentItem)
class CandidateAssessmentItemAdmin(admin.ModelAdmin):
    list_display = (
        "assessment",
        "student",
        "item_code",
        "item_name",
        "category",
        "required",
        "result",
        "assessor",
        "assessed_at",
    )
    list_filter = (
        "assessment__candidate__session",
        "category",
        "required",
        "result",
    )
    search_fields = (
        "item_code",
        "item_name",
        "assessment__candidate__student__first_name",
        "assessment__candidate__student__last_name",
        "assessment__candidate__student__wksa_id",
    )
    ordering = ("requirement_sequence", "item_name", "pk")
    list_select_related = (
        "assessment__candidate__session",
        "assessment__candidate__student",
        "assessor",
    )
    readonly_fields = (
        "assessment",
        "source_requirement",
        "source_item",
        "source_rank",
        "source_age_band",
        "item_code",
        "item_name",
        "korean_name",
        "category",
        "requirement_sequence",
        "required",
        "start_number",
        "end_number",
        "requirement_notes",
        "assessor",
        "assessed_at",
        "created_at",
        "updated_at",
    )

    @admin.display(ordering="assessment__candidate__student__last_name")
    def student(self, obj: CandidateAssessmentItem) -> object:
        return obj.assessment.candidate.student

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_delete_permission(
        self,
        request: HttpRequest,
        obj: CandidateAssessmentItem | None = None,
    ) -> bool:
        return False

    def save_model(
        self,
        request: HttpRequest,
        obj: CandidateAssessmentItem,
        form: ModelForm,
        change: bool,
    ) -> None:
        if change:
            update_candidate_assessment_item(
                obj,
                result=obj.result if "result" in form.changed_data else None,
                assessor_notes=(
                    obj.assessor_notes
                    if "assessor_notes" in form.changed_data
                    else None
                ),
                assessor=cast(User, request.user),
            )
        else:
            super().save_model(request, obj, form, change)


class GradingCandidateAdminForm(ModelForm):
    class Meta:
        model = GradingCandidate
        fields = (
            "session",
            "student",
            "testing_for_rank",
            "status",
            "notes",
        )


@admin.register(GradingCandidate)
class GradingCandidateAdmin(StateGatedDeleteMixin, admin.ModelAdmin):
    deletion_validator = staticmethod(validate_candidate_can_be_deleted)
    form = GradingCandidateAdminForm
    list_display = (
        "session",
        "student",
        "testing_for_rank",
        "age_band",
        "status",
    )
    list_filter = ("session", "testing_for_rank", "age_band", "status")
    search_fields = (
        "student__first_name",
        "student__last_name",
        "student__wksa_id",
    )
    ordering = ("session__grading_date", "student__last_name", "student__first_name")
    list_select_related = ("session", "student", "testing_for_rank")
    readonly_fields = ("age_band",)

    def save_model(
        self,
        request: HttpRequest,
        obj: GradingCandidate,
        form: ModelForm,
        change: bool,
    ) -> None:
        if not change:
            candidate = build_candidate(
                session=obj.session,
                student=obj.student,
                testing_for_rank=obj.testing_for_rank,
                status=obj.status,
                notes=obj.notes,
            )
            obj.age_band = candidate.age_band
        else:
            changed_data = set(form.changed_data)
            update_candidate(
                obj,
                session=obj.session if "session" in changed_data else None,
                student=obj.student if "student" in changed_data else None,
                testing_for_rank=(
                    obj.testing_for_rank if "testing_for_rank" in changed_data else None
                ),
                status=obj.status if "status" in changed_data else None,
                notes=obj.notes if "notes" in changed_data else None,
            )
        super().save_model(request, obj, form, change)


@admin.register(CandidateOutcome)
class CandidateOutcomeAdmin(admin.ModelAdmin):
    list_display = (
        "candidate",
        "student",
        "session",
        "testing_rank",
        "status",
        "proposed_outcome",
        "proposed_by",
        "final_outcome",
        "decided_by",
        "decided_at",
    )
    list_filter = (
        "status",
        "proposed_outcome",
        "final_outcome",
        "candidate__session",
        "candidate__testing_for_rank",
    )
    search_fields = (
        "candidate__student__first_name",
        "candidate__student__last_name",
        "candidate__student__wksa_id",
        "candidate__session__title",
    )
    ordering = (
        "candidate__session__grading_date",
        "candidate__student__last_name",
        "candidate__student__first_name",
    )
    list_select_related = (
        "candidate__session",
        "candidate__student",
        "candidate__testing_for_rank",
        "assessment",
        "proposed_by",
        "decided_by",
    )
    actions: tuple[str, ...] = ()
    readonly_fields = (
        "candidate",
        "assessment",
        "status",
        "proposed_outcome",
        "proposed_by",
        "proposed_at",
        "proposal_notes",
        "final_outcome",
        "decided_by",
        "decided_at",
        "decision_notes",
        "conditional_requirements",
        "created_at",
        "updated_at",
    )

    @admin.display(ordering="candidate__student__last_name")
    def student(self, obj: CandidateOutcome) -> object:
        return obj.candidate.student

    @admin.display(ordering="candidate__session__grading_date")
    def session(self, obj: CandidateOutcome) -> object:
        return obj.candidate.session

    @admin.display(ordering="candidate__testing_for_rank__order")
    def testing_rank(self, obj: CandidateOutcome) -> object:
        return obj.candidate.testing_for_rank

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_delete_permission(
        self,
        request: HttpRequest,
        obj: CandidateOutcome | None = None,
    ) -> bool:
        return False

    def save_model(
        self,
        request: HttpRequest,
        obj: CandidateOutcome,
        form: ModelForm,
        change: bool,
    ) -> None:
        if change and form.changed_data:
            raise DjangoValidationError(
                "Candidate outcomes are changed through the API workflow services.",
            )
        super().save_model(request, obj, form, change)


@admin.register(Promotion)
class PromotionAdmin(admin.ModelAdmin):
    list_display = (
        "student",
        "student_wksa_id",
        "from_rank",
        "to_rank",
        "effective_date",
        "promoted_by",
        "promoted_at",
        "session",
        "outcome",
    )
    list_filter = ("from_rank", "to_rank", "effective_date", "promoted_by")
    search_fields = (
        "student__first_name",
        "student__last_name",
        "student__wksa_id",
        "grading_candidate__session__title",
    )
    ordering = ("-effective_date", "-promoted_at", "-pk")
    list_select_related = (
        "student",
        "outcome",
        "grading_candidate__session",
        "from_rank",
        "to_rank",
        "promoted_by",
    )
    actions: tuple[str, ...] = ()
    readonly_fields = (
        "student",
        "outcome",
        "grading_candidate",
        "from_rank",
        "to_rank",
        "promoted_by",
        "promoted_at",
        "effective_date",
        "notes",
        "created_at",
        "updated_at",
    )

    @admin.display(ordering="student__wksa_id")
    def student_wksa_id(self, obj: Promotion) -> str:
        return obj.student.wksa_id

    @admin.display(ordering="grading_candidate__session__grading_date")
    def session(self, obj: Promotion) -> object:
        return obj.grading_candidate.session

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_delete_permission(
        self,
        request: HttpRequest,
        obj: Promotion | None = None,
    ) -> bool:
        return False

    def save_model(
        self,
        request: HttpRequest,
        obj: Promotion,
        form: ModelForm,
        change: bool,
    ) -> None:
        if change and form.changed_data:
            raise DjangoValidationError(
                "Promotion records are immutable after creation.",
            )
        super().save_model(request, obj, form, change)
