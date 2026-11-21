"""The grading records an emergency look may need, view-only
(kukgrade.admin_mixins.ViewOnlyAdmin): sessions, candidates, assessments and
their items, outcomes and promotions.

The other grading models are left out on purpose, as the app already shows
each where it belongs: item comments and mark changes (an assessment's
history), staged decisions (a Master's drafts before they are recorded),
historical records (the imports pages) and set-aside names (one person's
note on the linking page).
"""

from __future__ import annotations

from django.contrib import admin

from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    Promotion,
    candidate_order,
)
from kukgrade.admin_mixins import ViewOnlyAdmin


@admin.register(GradingSession)
class GradingSessionAdmin(ViewOnlyAdmin):
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


@admin.register(CandidateAssessment)
class CandidateAssessmentAdmin(ViewOnlyAdmin):
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

    @admin.display(ordering="candidate__student__last_name")
    def student(self, obj: CandidateAssessment) -> object:
        return obj.candidate.student

    @admin.display(ordering="candidate__session__grading_date")
    def session(self, obj: CandidateAssessment) -> object:
        return obj.candidate.session


@admin.register(CandidateAssessmentItem)
class CandidateAssessmentItemAdmin(ViewOnlyAdmin):
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
    ordering = ("assessment", "position")
    list_select_related = (
        "assessment__candidate__session",
        "assessment__candidate__student",
        "assessor",
    )

    @admin.display(ordering="assessment__candidate__student__last_name")
    def student(self, obj: CandidateAssessmentItem) -> object:
        return obj.assessment.candidate.student


@admin.register(GradingCandidate)
class GradingCandidateAdmin(ViewOnlyAdmin):
    list_display = (
        "session",
        "student",
        "from_rank",
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
    ordering = candidate_order()
    list_select_related = ("session", "student", "from_rank", "testing_for_rank")


@admin.register(CandidateOutcome)
class CandidateOutcomeAdmin(ViewOnlyAdmin):
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

    @admin.display(ordering="candidate__student__last_name")
    def student(self, obj: CandidateOutcome) -> object:
        return obj.candidate.student

    @admin.display(ordering="candidate__session__grading_date")
    def session(self, obj: CandidateOutcome) -> object:
        return obj.candidate.session

    @admin.display(ordering="candidate__testing_for_rank__order")
    def testing_rank(self, obj: CandidateOutcome) -> object:
        return obj.candidate.testing_for_rank


@admin.register(Promotion)
class PromotionAdmin(ViewOnlyAdmin):
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

    @admin.display(ordering="student__wksa_id")
    def student_wksa_id(self, obj: Promotion) -> str:
        return obj.student.wksa_id

    @admin.display(ordering="grading_candidate__session__grading_date")
    def session(self, obj: Promotion) -> object:
        return obj.grading_candidate.session
