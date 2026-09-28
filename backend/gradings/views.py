from __future__ import annotations

from typing import cast

from django.db.models import QuerySet
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.exceptions import MethodNotAllowed
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet, ReadOnlyModelViewSet

from accounts.models import User
from accounts.permissions import (
    CanMakeFinalGradingDecision,
    CanOverrideLockedSession,
    CanPromoteStudent,
    HasRequiredPermissions,
)
from gradings.legacy_services import (
    resolve_legacy_current_rank,
    resolve_legacy_testing_for_rank,
    unlink_legacy_record_from_student,
)
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    LegacyGradingRecord,
    Promotion,
)
from gradings.serializers import (
    BulkAssessmentGenerationResultSerializer,
    BulkAssessmentGenerationSerializer,
    BulkAssessmentStartResultSerializer,
    BulkAssessmentStartSerializer,
    BulkCandidateRegistrationResultSerializer,
    BulkCandidateRegistrationSerializer,
    BulkCandidateStatusUpdateResultSerializer,
    BulkCandidateStatusUpdateSerializer,
    BulkPromotionResultSerializer,
    BulkPromotionSerializer,
    CandidateAssessmentItemSerializer,
    CandidateAssessmentSerializer,
    CandidateAssessmentSummarySerializer,
    CandidateOutcomeFinaliseSerializer,
    CandidateOutcomeProposalSerializer,
    CandidateOutcomeSerializer,
    CandidatePromotionSerializer,
    GradingCandidateSerializer,
    GradingSessionSerializer,
    LegacyGradingRecordSerializer,
    LinkLegacyRecordSerializer,
    LockedCandidateWithdrawalSerializer,
    PromotionSerializer,
    ResolveLegacyRankSerializer,
    VoidLegacyRecordSerializer,
)
from gradings.services import (
    bulk_generate_candidate_assessments,
    bulk_promote_candidates,
    bulk_register_candidates,
    bulk_start_candidate_assessments,
    bulk_update_candidate_status,
    candidate_assessment_summary,
    create_candidate_outcome,
    delete_candidate,
    delete_candidate_assessment,
    delete_grading_session,
    generate_candidate_assessment,
    reopen_candidate_assessment,
)
from kukgrade.filtering import boolean, by_id, by_uuid, choice, exact, on_date, search
from syllabus.models import AgeBand, SyllabusItem


class GradingSessionViewSet(ModelViewSet):
    serializer_class = GradingSessionSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("gradings.view_gradingsession",),
        "retrieve": ("gradings.view_gradingsession",),
        "create": ("gradings.add_gradingsession",),
        "update": ("gradings.change_gradingsession",),
        "partial_update": ("gradings.change_gradingsession",),
        "destroy": ("gradings.delete_gradingsession",),
    }

    query_filters = (
        choice("status", "status", GradingSession.Status.values),
        on_date("grading_date", "grading_date"),
        on_date("grading_date_from", "grading_date__gte"),
        on_date("grading_date_to", "grading_date__lte"),
        search("search", ("title", "location")),
    )

    def get_queryset(self) -> QuerySet[GradingSession]:
        return GradingSession.objects.select_related("created_by").order_by(
            "-grading_date",
            "created_at",
        )

    def destroy(self, request: Request, *args: object, **kwargs: object) -> Response:
        instance = self.get_object()
        delete_grading_session(instance, actor=cast(User, request.user))
        return Response(status=status.HTTP_204_NO_CONTENT)


class GradingCandidateViewSet(ModelViewSet):
    serializer_class = GradingCandidateSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("gradings.view_gradingcandidate",),
        "retrieve": ("gradings.view_gradingcandidate",),
        "create": ("gradings.add_gradingcandidate",),
        "update": ("gradings.change_gradingcandidate",),
        "partial_update": ("gradings.change_gradingcandidate",),
        "destroy": ("gradings.delete_gradingcandidate",),
        # These create other models, so they are named for what they make
        # rather than for the candidate they hang off.
        "generate_assessment": ("gradings.add_candidateassessment",),
        "create_outcome": ("gradings.add_candidateoutcome",),
        "bulk_register": ("gradings.add_gradingcandidate",),
        "bulk_generate_assessments": ("gradings.add_candidateassessment",),
        "bulk_update_status": ("gradings.change_gradingcandidate",),
        # The sensitive half is enforced by CanOverrideLockedSession on the
        # action itself, which also gives a clearer message.
        "withdraw": ("gradings.change_gradingcandidate",),
    }

    query_filters = (
        by_id("session", "session_id"),
        exact("student_wksa_id", "student__wksa_id"),
        exact("testing_for_rank_code", "testing_for_rank__code"),
        choice("age_band", "age_band", AgeBand.values),
        choice("status", "status", GradingCandidate.Status.values),
    )

    def get_queryset(self) -> QuerySet[GradingCandidate]:
        return GradingCandidate.objects.select_related(
            "session",
            "student",
            "from_rank",
            "testing_for_rank",
            "withdrawn_by",
        ).order_by(
            "session__grading_date",
            "student__last_name",
            "student__first_name",
        )

    def destroy(self, request: Request, *args: object, **kwargs: object) -> Response:
        instance = self.get_object()
        delete_candidate(instance, actor=cast(User, request.user))
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=None, responses={201: CandidateAssessmentSerializer})
    @action(detail=True, methods=["post"], url_path="generate-assessment")
    def generate_assessment(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        candidate = self.get_object()
        assessment = generate_candidate_assessment(candidate, cast(User, request.user))
        serializer = CandidateAssessmentSerializer(
            assessment,
            context={"request": request},
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        request=BulkCandidateRegistrationSerializer,
        responses=BulkCandidateRegistrationResultSerializer,
    )
    @action(detail=False, methods=["post"], url_path="bulk-register")
    def bulk_register(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        input_serializer = BulkCandidateRegistrationSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        created, errors = bulk_register_candidates(
            session=input_serializer.validated_data["session"],
            rows=input_serializer.validated_data["candidates"],
            actor=cast(User, request.user),
            generate_assessments=input_serializer.validated_data[
                "generate_assessments"
            ],
        )
        result = BulkCandidateRegistrationResultSerializer(
            {
                "created": [
                    {"candidate": candidate, "assessment": assessment}
                    for candidate, assessment in created
                ],
                "errors": errors,
            },
            context={"request": request},
        )
        return Response(result.data)

    @extend_schema(
        request=BulkAssessmentGenerationSerializer,
        responses=BulkAssessmentGenerationResultSerializer,
    )
    @action(detail=False, methods=["post"], url_path="bulk-generate-assessments")
    def bulk_generate_assessments(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        input_serializer = BulkAssessmentGenerationSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        created, errors = bulk_generate_candidate_assessments(
            candidates=input_serializer.validated_data["candidates"],
            generated_by=cast(User, request.user),
        )
        result = BulkAssessmentGenerationResultSerializer(
            {"created": created, "errors": errors},
            context={"request": request},
        )
        return Response(result.data)

    @extend_schema(
        request=BulkCandidateStatusUpdateSerializer,
        responses=BulkCandidateStatusUpdateResultSerializer,
    )
    @action(detail=False, methods=["post"], url_path="bulk-update-status")
    def bulk_update_status(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        input_serializer = BulkCandidateStatusUpdateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        updated, errors = bulk_update_candidate_status(
            candidates=input_serializer.validated_data["candidates"],
            new_status=input_serializer.validated_data["status"],
            withdrawal_reason=input_serializer.validated_data.get("withdrawal_reason"),
            withdrawal_note=input_serializer.validated_data.get("withdrawal_note"),
            actor=cast(User, request.user),
        )
        result = BulkCandidateStatusUpdateResultSerializer(
            {"updated": updated, "errors": errors},
            context={"request": request},
        )
        return Response(result.data)

    @extend_schema(
        request=LockedCandidateWithdrawalSerializer,
        responses=GradingCandidateSerializer,
    )
    @action(
        detail=True,
        methods=["post"],
        permission_classes=[HasRequiredPermissions, CanOverrideLockedSession],
    )
    def withdraw(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        candidate = self.get_object()
        serializer = LockedCandidateWithdrawalSerializer(
            candidate,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        return Response(
            GradingCandidateSerializer(updated, context={"request": request}).data,
        )

    @extend_schema(request=None, responses={201: CandidateOutcomeSerializer})
    @action(detail=True, methods=["post"], url_path="create-outcome")
    def create_outcome(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        candidate = self.get_object()
        outcome = create_candidate_outcome(candidate, cast(User, request.user))
        serializer = CandidateOutcomeSerializer(outcome, context={"request": request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class CandidateAssessmentViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    GenericViewSet,
):
    serializer_class = CandidateAssessmentSerializer
    permission_classes = [HasRequiredPermissions]
    http_method_names = ["get", "patch", "post", "delete", "head", "options"]
    permission_map = {
        "list": ("gradings.view_candidateassessment",),
        "retrieve": ("gradings.view_candidateassessment",),
        "partial_update": ("gradings.change_candidateassessment",),
        "bulk_start": ("gradings.change_candidateassessment",),
        "reopen": ("gradings.change_candidateassessment",),
        "summary": ("gradings.view_candidateassessment",),
        "destroy": ("gradings.delete_candidateassessment",),
    }

    query_filters = (
        by_id("candidate", "candidate_id"),
        by_id("session", "candidate__session_id"),
        exact("student_wksa_id", "candidate__student__wksa_id"),
        exact("testing_for_rank_code", "candidate__testing_for_rank__code"),
        choice("status", "status", CandidateAssessment.Status.values),
    )

    def get_queryset(self) -> QuerySet[CandidateAssessment]:
        return (
            CandidateAssessment.objects.select_related(
                "candidate__session",
                "candidate__student",
                "candidate__testing_for_rank",
                "generated_by",
            )
            .prefetch_related("items")
            .order_by(
                "candidate__session__grading_date",
                "candidate__student__last_name",
                "candidate__student__first_name",
            )
        )

    def destroy(self, request: Request, *args: object, **kwargs: object) -> Response:
        instance = self.get_object()
        delete_candidate_assessment(instance, cast(User, request.user))
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=None, responses=CandidateAssessmentSerializer)
    @action(detail=True, methods=["post"])
    def reopen(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        """Return a completed assessment to in-progress while the session is open."""
        assessment = reopen_candidate_assessment(
            self.get_object(),
            cast(User, request.user),
        )
        return Response(
            CandidateAssessmentSerializer(
                assessment,
                context={"request": request},
            ).data,
        )

    @extend_schema(responses=CandidateAssessmentSummarySerializer)
    @action(detail=True, methods=["get"])
    def summary(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        """Category and overall rollup for one assessment, at any status.

        The same service and response shape as the outcome endpoint's
        `summary`, reached by assessment rather than by outcome. A
        `CandidateOutcome` cannot exist until the session is `LOCKED` and the
        assessment `COMPLETED`, so the outcome route is unreachable while an
        assessment is being scored or reviewed - which is exactly when the
        scoring and completion screens need these counts. See FDR-046.
        """
        summary = candidate_assessment_summary(self.get_object())
        return Response(CandidateAssessmentSummarySerializer(summary).data)

    @extend_schema(
        request=BulkAssessmentStartSerializer,
        responses=BulkAssessmentStartResultSerializer,
    )
    @action(detail=False, methods=["post"], url_path="bulk-start")
    def bulk_start(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        input_serializer = BulkAssessmentStartSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        started, errors = bulk_start_candidate_assessments(
            assessments=input_serializer.validated_data["assessments"],
            actor=cast(User, request.user),
        )
        result = BulkAssessmentStartResultSerializer(
            {"started": started, "errors": errors},
            context={"request": request},
        )
        return Response(result.data)


class CandidateAssessmentItemViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    GenericViewSet,
):
    serializer_class = CandidateAssessmentItemSerializer
    permission_classes = [HasRequiredPermissions]
    http_method_names = ["get", "patch", "head", "options"]
    permission_map = {
        "list": ("gradings.view_candidateassessmentitem",),
        "retrieve": ("gradings.view_candidateassessmentitem",),
        "partial_update": ("gradings.change_candidateassessmentitem",),
    }

    query_filters = (
        by_id("assessment", "assessment_id"),
        by_id("candidate", "assessment__candidate_id"),
        by_id("session", "assessment__candidate__session_id"),
        exact("item_code", "item_code"),
        choice("category", "category", SyllabusItem.Category.values),
        choice("result", "result", CandidateAssessmentItem.Result.values),
        boolean("required", "required"),
    )

    def get_queryset(self) -> QuerySet[CandidateAssessmentItem]:
        return CandidateAssessmentItem.objects.select_related(
            "assessment__candidate__session",
            "assessment__candidate__student",
            "assessment__candidate__testing_for_rank",
            "source_requirement",
            "source_item",
            "source_rank",
            "assessor",
        ).order_by("requirement_sequence", "item_name", "pk")


class CandidateOutcomeViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    GenericViewSet,
):
    serializer_class = CandidateOutcomeSerializer
    permission_classes = [HasRequiredPermissions]
    http_method_names = ["get", "patch", "post", "head", "options"]
    permission_map = {
        "list": ("gradings.view_candidateoutcome",),
        "retrieve": ("gradings.view_candidateoutcome",),
        "partial_update": ("gradings.change_candidateoutcome",),
        "propose": ("gradings.change_candidateoutcome",),
        "summary": ("gradings.view_candidateoutcome",),
        # The sensitive half of these two is enforced by the dedicated
        # permission class on the action, which also gives a better message.
        "finalise": ("gradings.view_candidateoutcome",),
        "promote": ("gradings.view_candidateoutcome",),
        "bulk_promote": ("gradings.view_candidateoutcome",),
    }

    query_filters = (
        by_id("session", "candidate__session_id"),
        by_id("candidate", "candidate_id"),
        exact("student_wksa_id", "candidate__student__wksa_id"),
        exact("testing_for_rank_code", "candidate__testing_for_rank__code"),
        choice("status", "status", CandidateOutcome.Status.values),
        choice("proposed_outcome", "proposed_outcome", CandidateOutcome.Outcome.values),
        choice("final_outcome", "final_outcome", CandidateOutcome.Outcome.values),
        by_uuid("proposed_by", "proposed_by_id"),
        by_uuid("decided_by", "decided_by_id"),
    )

    def get_queryset(self) -> QuerySet[CandidateOutcome]:
        return CandidateOutcome.objects.select_related(
            "candidate__session",
            "candidate__student",
            "candidate__testing_for_rank",
            "assessment",
            "proposed_by",
            "decided_by",
        ).order_by(
            "candidate__session__grading_date",
            "candidate__student__last_name",
            "candidate__student__first_name",
        )

    def partial_update(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        # PATCH is routed here by the router but is only meaningful on the
        # propose and finalise actions, so the method genuinely is not
        # allowed on the detail route. 405 rather than 400, and it flows
        # through the shared error envelope.
        raise MethodNotAllowed(
            "PATCH",
            detail=(
                "Candidate outcomes are read-only except through the propose "
                "and finalise actions."
            ),
        )

    @extend_schema(
        request=CandidateOutcomeProposalSerializer,
        responses=CandidateOutcomeSerializer,
    )
    @action(detail=True, methods=["patch"])
    def propose(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        outcome = self.get_object()
        serializer = CandidateOutcomeProposalSerializer(
            outcome,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        response_serializer = CandidateOutcomeSerializer(
            updated,
            context={"request": request},
        )
        return Response(response_serializer.data)

    @extend_schema(
        request=CandidateOutcomeFinaliseSerializer,
        responses=CandidateOutcomeSerializer,
    )
    @action(
        detail=True,
        methods=["patch"],
        permission_classes=[HasRequiredPermissions, CanMakeFinalGradingDecision],
    )
    def finalise(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        outcome = self.get_object()
        serializer = CandidateOutcomeFinaliseSerializer(
            outcome,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        response_serializer = CandidateOutcomeSerializer(
            updated,
            context={"request": request},
        )
        return Response(response_serializer.data)

    @extend_schema(responses=CandidateAssessmentSummarySerializer)
    @action(detail=True, methods=["get"])
    def summary(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        outcome = self.get_object()
        summary = candidate_assessment_summary(outcome.assessment)
        return Response(CandidateAssessmentSummarySerializer(summary).data)

    @extend_schema(
        request=CandidatePromotionSerializer,
        responses={201: PromotionSerializer},
    )
    @action(
        detail=True,
        methods=["post"],
        permission_classes=[HasRequiredPermissions, CanPromoteStudent],
    )
    def promote(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        outcome = self.get_object()
        serializer = CandidatePromotionSerializer(
            outcome,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        promotion = serializer.save()
        response_serializer = PromotionSerializer(
            promotion,
            context={"request": request},
        )
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        request=BulkPromotionSerializer,
        responses=BulkPromotionResultSerializer,
    )
    @action(
        detail=False,
        methods=["post"],
        url_path="bulk-promote",
        permission_classes=[HasRequiredPermissions, CanPromoteStudent],
    )
    def bulk_promote(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        input_serializer = BulkPromotionSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        promoted, errors = bulk_promote_candidates(
            outcomes=input_serializer.validated_data["outcomes"],
            actor=cast(User, request.user),
        )
        result = BulkPromotionResultSerializer(
            {"promoted": promoted, "errors": errors},
            context={"request": request},
        )
        return Response(result.data)


class PromotionViewSet(ReadOnlyModelViewSet):
    serializer_class = PromotionSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("gradings.view_promotion",),
        "retrieve": ("gradings.view_promotion",),
    }

    query_filters = (
        by_id("student", "student_id"),
        exact("student_wksa_id", "student__wksa_id"),
        exact("from_rank_code", "from_rank__code"),
        exact("to_rank_code", "to_rank__code"),
        by_id("session", "grading_candidate__session_id"),
        on_date("effective_date", "effective_date"),
        on_date("effective_date_from", "effective_date__gte"),
        on_date("effective_date_to", "effective_date__lte"),
        by_uuid("promoted_by", "promoted_by_id"),
    )

    def get_queryset(self) -> QuerySet[Promotion]:
        return Promotion.objects.select_related(
            "student__current_rank",
            "outcome",
            "grading_candidate__session",
            "from_rank",
            "to_rank",
            "promoted_by",
        ).order_by("-effective_date", "-promoted_at", "-pk")


class LegacyGradingRecordViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    GenericViewSet,
):
    """Historical import records - read for both roles, reconciliation
    (link/unlink/resolve-rank/void) administrator-only (import Decisions 1
    and 15). No ordinary create/update/delete: rows are only ever
    created by data_imports.services.commit_legacy_grading_import, and only
    ever changed through the five gradings.legacy_services functions."""

    serializer_class = LegacyGradingRecordSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("gradings.view_legacygradingrecord",),
        "retrieve": ("gradings.view_legacygradingrecord",),
        "link_student": ("gradings.can_reconcile_imported_history",),
        "unlink_student": ("gradings.can_reconcile_imported_history",),
        "resolve_current_rank": ("gradings.can_reconcile_imported_history",),
        "resolve_testing_for_rank": ("gradings.can_reconcile_imported_history",),
        "void": ("gradings.can_reconcile_imported_history",),
    }

    query_filters = (
        by_id("student", "student_id"),
        boolean("linked", "student__isnull", invert=True),
        boolean("voided", "is_void"),
        exact("record_kind", "record_kind"),
        by_id("source_batch", "source_batch_id"),
    )

    def get_queryset(self) -> QuerySet[LegacyGradingRecord]:
        return LegacyGradingRecord.objects.select_related(
            "student",
            "current_rank",
            "testing_for_rank",
            "voided_by",
            "source_batch",
        ).order_by("-cycle_year", "-cycle_month", "source_sheet", "source_locator")

    @extend_schema(
        request=LinkLegacyRecordSerializer,
        responses=LegacyGradingRecordSerializer,
    )
    @action(detail=True, methods=["post"], url_path="link-student")
    def link_student(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        record_ = self.get_object()
        serializer = LinkLegacyRecordSerializer(
            record_,
            data=request.data,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        return Response(LegacyGradingRecordSerializer(updated).data)

    @extend_schema(request=None, responses=LegacyGradingRecordSerializer)
    @action(detail=True, methods=["post"], url_path="unlink-student")
    def unlink_student(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        record_ = self.get_object()
        updated = unlink_legacy_record_from_student(
            record_,
            actor=cast(User, request.user),
        )
        return Response(LegacyGradingRecordSerializer(updated).data)

    @extend_schema(
        request=ResolveLegacyRankSerializer,
        responses=LegacyGradingRecordSerializer,
    )
    @action(detail=True, methods=["post"], url_path="resolve-current-rank")
    def resolve_current_rank(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        record_ = self.get_object()
        serializer = ResolveLegacyRankSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        updated = resolve_legacy_current_rank(
            record_,
            serializer.validated_data["rank"],
            actor=cast(User, request.user),
        )
        return Response(LegacyGradingRecordSerializer(updated).data)

    @extend_schema(
        request=ResolveLegacyRankSerializer,
        responses=LegacyGradingRecordSerializer,
    )
    @action(detail=True, methods=["post"], url_path="resolve-testing-for-rank")
    def resolve_testing_for_rank(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        record_ = self.get_object()
        serializer = ResolveLegacyRankSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        updated = resolve_legacy_testing_for_rank(
            record_,
            serializer.validated_data["rank"],
            actor=cast(User, request.user),
        )
        return Response(LegacyGradingRecordSerializer(updated).data)

    @extend_schema(
        request=VoidLegacyRecordSerializer,
        responses=LegacyGradingRecordSerializer,
    )
    @action(detail=True, methods=["post"])
    def void(self, request: Request, *args: object, **kwargs: object) -> Response:
        record_ = self.get_object()
        serializer = VoidLegacyRecordSerializer(
            record_,
            data=request.data,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        return Response(LegacyGradingRecordSerializer(updated).data)
