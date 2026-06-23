from __future__ import annotations

from django.contrib import admin
from django.forms import ModelForm
from django.http import HttpRequest

from gradings.models import GradingCandidate, GradingSession
from gradings.services import (
    build_candidate,
    update_candidate,
    validate_session_grading_date_change,
)


@admin.register(GradingSession)
class GradingSessionAdmin(admin.ModelAdmin):
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
        if change and "grading_date" in form.changed_data:
            validate_session_grading_date_change(obj)
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
