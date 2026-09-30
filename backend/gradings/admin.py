from __future__ import annotations

from typing import Any, cast

from django.contrib import admin, messages
from django.core.exceptions import ValidationError as DjangoValidationError
from django.forms import ModelForm
from django.http import HttpRequest

from accounts.models import User
from gradings.assessment_services import (
    update_candidate_assessment,
    update_candidate_assessment_item,
)
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    Promotion,
)
from gradings.services import (
    apply_candidate_update,
    create_grading_session,
    delete_candidate,
    delete_grading_session,
    register_candidate,
    update_grading_session,
    validate_candidate_can_be_deleted,
    validate_grading_session_transition,
    validate_session_can_be_deleted,
)
from kukgrade.admin_mixins import ServiceDeleteMixin


class GradingSessionAdminForm(ModelForm):
    class Meta:
        model = GradingSession
        fields = (
            "title",
            "grading_date",
            "status",
            "location",
            "notes",
            "cancellation_reason",
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
                else:
                    # This form has already validated the transition against
                    # the persisted state above. Without this,
                    # ModelForm._post_clean() calls instance.full_clean()
                    # with the new status already applied, and the model's
                    # own guard rejects any status change outright - the
                    # form would never validate at all, for any transition,
                    # and save_model()'s own routing through
                    # transition_grading_session() would never be reached.
                    self.instance._allow_status_transition = True
        return cleaned_data


class StateGatedDeleteMixin(ServiceDeleteMixin):
    """Applies the service deletion rule to both admin delete paths.

    The change page hides Delete when the rule refuses, and the changelist
    bulk action refuses as a whole rather than part-deleting a selection.
    Without this, admin bulk delete walked past rules the API enforced -
    and instructors now hold the delete permissions, so the changelist is
    the most reachable way to reach them. The delete itself runs through
    the service (ServiceDeleteMixin, KG-036, KG-A03).
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
        # actor threaded through so a validator that grants an administrator
        # extra power (e.g. validate_session_can_be_deleted) sees the same
        # acting user the API does, rather than always evaluating as if no
        # one were logged in. Validators that ignore actor (e.g.
        # validate_candidate_can_be_deleted) are unaffected.
        return self._is_deletable(obj, actor=cast(User, request.user))

    def delete_queryset(self, request: HttpRequest, queryset: Any) -> None:
        actor = cast(User, request.user)
        blocked = [obj for obj in queryset if not self._is_deletable(obj, actor=actor)]
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
        super().delete_queryset(request, queryset)

    def _is_deletable(self, obj: Any, actor: User | None = None) -> bool:
        try:
            type(self).deletion_validator(obj, actor=actor)
        except DjangoValidationError:
            return False
        return True


@admin.register(GradingSession)
class GradingSessionAdmin(StateGatedDeleteMixin, admin.ModelAdmin):
    deletion_validator = staticmethod(validate_session_can_be_deleted)
    deletion_service = staticmethod(delete_grading_session)
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
        if not change:
            # Routed through the same service the API uses to create a
            # session, so an admin-created session is audited too (KG-036).
            created = create_grading_session(
                title=obj.title,
                grading_date=obj.grading_date,
                location=obj.location,
                notes=obj.notes,
                created_by=obj.created_by,
            )
            obj.pk = created.pk
            obj.refresh_from_db()
            return

        # The same service the API edits through: only the changed fields are
        # written, onto the locked row, and a status change becomes a
        # transition rather than a plain field write (KG-A12).
        changed_data = set(form.changed_data)
        update_grading_session(
            obj,
            changes={field: getattr(obj, field) for field in changed_data - {"status"}},
            target_status=obj.status if "status" in changed_data else None,
            reason=obj.cancellation_reason,
            actor=cast(User, request.user),
        )
        obj.refresh_from_db()


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
                actor=cast(User, request.user),
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
    ordering = ("assessment", "position")
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
        "position",
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
            "withdrawal_reason",
            "withdrawal_note",
        )


@admin.register(GradingCandidate)
class GradingCandidateAdmin(StateGatedDeleteMixin, admin.ModelAdmin):
    deletion_validator = staticmethod(validate_candidate_can_be_deleted)
    deletion_service = staticmethod(delete_candidate)
    form = GradingCandidateAdminForm
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
    ordering = ("session__grading_date", "student__last_name", "student__first_name")
    list_select_related = ("session", "student", "from_rank", "testing_for_rank")
    readonly_fields = ("from_rank", "age_band")

    def get_readonly_fields(
        self,
        request: HttpRequest,
        obj: GradingCandidate | None = None,
    ) -> tuple[str, ...]:
        # A registration's student is fixed once it exists.
        if obj is not None:
            return (*self.readonly_fields, "student")
        return tuple(self.readonly_fields)

    def save_model(
        self,
        request: HttpRequest,
        obj: GradingCandidate,
        form: ModelForm,
        change: bool,
    ) -> None:
        # Routed through the same services the API uses, so an admin-created
        # or admin-edited candidate is audited too, attributed to whoever is
        # signed into admin (KG-036).
        if not change:
            created = register_candidate(
                session=obj.session,
                student=obj.student,
                testing_for_rank=obj.testing_for_rank,
                notes=obj.notes,
                actor=cast(User, request.user),
            )
            obj.pk = created.pk
            obj.refresh_from_db()
            return

        changed_data = set(form.changed_data)
        apply_candidate_update(
            obj,
            session=obj.session if "session" in changed_data else None,
            testing_for_rank=(
                obj.testing_for_rank if "testing_for_rank" in changed_data else None
            ),
            status=obj.status if "status" in changed_data else None,
            notes=obj.notes if "notes" in changed_data else None,
            withdrawal_reason=form.cleaned_data.get("withdrawal_reason"),
            withdrawal_note=form.cleaned_data.get("withdrawal_note"),
            actor=cast(User, request.user),
        )


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
