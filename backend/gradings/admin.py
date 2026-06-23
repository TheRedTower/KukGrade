from __future__ import annotations

from typing import Any, cast

from django.contrib import admin
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.forms import ModelForm
from django.http import HttpRequest

from accounts.models import User
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    GradingCandidate,
    GradingSession,
)
from gradings.services import (
    build_candidate,
    transition_grading_session,
    update_candidate,
    update_candidate_assessment,
    update_candidate_assessment_item,
    validate_grading_session_transition,
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


@admin.register(GradingSession)
class GradingSessionAdmin(admin.ModelAdmin):
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
class GradingCandidateAdmin(admin.ModelAdmin):
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
