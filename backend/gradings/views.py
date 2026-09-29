from __future__ import annotations

from typing import cast

from django.db.models import QuerySet
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet

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
    WithdrawalReasonSerializer,
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
from kukgrade.filtering import boolean, by_id, choice, on_date, search


class WithdrawalReasonViewSet(GenericViewSet):
    """The reasons a candidate can be withdrawn for, as every withdrawal
    control lists them."""

    serializer_class = WithdrawalReasonSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {"list": ("gradings.view_gradingcandidate",)}

    def list(self, request: Request) -> Response:
        # Paginated like every list endpoint, as the syllabus age bands are.
        page: list[str] | None = self.paginate_queryset(
            GradingCandidate.WithdrawalReason.values,  # type: ignore[arg-type]
        )
        return self.get_paginated_response(self.get_serializer(page, many=True).data)


class GradingSessionViewSet(ModelViewSet):
    # No PUT: partial_update covers every real edit.
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    serializer_class = GradingSessionSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("gradings.view_gradingsession",),
        "retrieve": ("gradings.view_gradingsession",),
        "create": ("gradings.add_gradingsession",),
        "partial_update": ("gradings.change_gradingsession",),
        "destroy": ("gradings.delete_gradingsession",),
    }

    query_filters = (
        choice("status", "status", GradingSession.Status.values),
        on_date("grading_date_from", "grading_date__gte"),
        on_date("grading_date_to", "grading_date__lte"),
        search("search", ("title", "location")),
    )

    def get_queryset(self) -> QuerySet[GradingSession]:
        return GradingSession.objects.order_by("-grading_date", "created_at")

    def destroy(self, request: Request, *args: object, **kwargs: object) -> Response:
        instance = self.get_object()
        delete_grading_session(instance, actor=cast(User, request.user))
        return Response(status=status.HTTP_204_NO_CONTENT)


class GradingCandidateViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    GenericViewSet,
):
    """Registrations are created by bulk-register only. PATCH and DELETE
    change or remove one while its session is draft or open."""

    # No PUT: partial_update covers every real edit.
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    serializer_class = GradingCandidateSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("gradings.view_gradingcandidate",),
        "retrieve": ("gradings.view_gradingcandidate",),
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

    query_filters = (by_id("session", "session_id"),)

    def get_queryset(self) -> QuerySet[GradingCandidate]:
        return GradingCandidate.objects.select_related(
            "student",
            "from_rank",
            "testing_for_rank",
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
    mixins.UpdateModelMixin,
    GenericViewSet,
):
    serializer_class = CandidateAssessmentSerializer
    permission_classes = [HasRequiredPermissions]
    http_method_names = ["get", "patch", "post", "delete", "head", "options"]
    permission_map = {
        "list": ("gradings.view_candidateassessment",),
        "partial_update": ("gradings.change_candidateassessment",),
        "bulk_start": ("gradings.change_candidateassessment",),
        "reopen": ("gradings.change_candidateassessment",),
        "summary": ("gradings.view_candidateassessment",),
        "destroy": ("gradings.delete_candidateassessment",),
    }

    query_filters = (
        by_id("candidate", "candidate_id"),
        by_id("session", "candidate__session_id"),
        choice("status", "status", CandidateAssessment.Status.values),
    )

    def get_queryset(self) -> QuerySet[CandidateAssessment]:
        return (
            CandidateAssessment.objects.select_related(
                "candidate__student",
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
    mixins.UpdateModelMixin,
    GenericViewSet,
):
    serializer_class = CandidateAssessmentItemSerializer
    permission_classes = [HasRequiredPermissions]
    http_method_names = ["get", "patch", "head", "options"]
    permission_map = {
        "list": ("gradings.view_candidateassessmentitem",),
        "partial_update": ("gradings.change_candidateassessmentitem",),
    }

    query_filters = (by_id("assessment", "assessment_id"),)

    def get_queryset(self) -> QuerySet[CandidateAssessmentItem]:
        return CandidateAssessmentItem.objects.select_related(
            "assessor",
        ).order_by("requirement_sequence", "item_name", "pk")


class CandidateOutcomeViewSet(
    mixins.ListModelMixin,
    GenericViewSet,
):
    serializer_class = CandidateOutcomeSerializer
    permission_classes = [HasRequiredPermissions]
    http_method_names = ["get", "patch", "post", "head", "options"]
    permission_map = {
        "list": ("gradings.view_candidateoutcome",),
        "propose": ("gradings.change_candidateoutcome",),
        # The sensitive half of these two is enforced by the dedicated
        # permission class on the action, which also gives a better message.
        "finalise": ("gradings.view_candidateoutcome",),
        "promote": ("gradings.view_candidateoutcome",),
        "bulk_promote": ("gradings.view_candidateoutcome",),
    }

    query_filters = (by_id("session", "candidate__session_id"),)

    def get_queryset(self) -> QuerySet[CandidateOutcome]:
        return CandidateOutcome.objects.select_related(
            "proposed_by",
            "decided_by",
        ).order_by(
            "candidate__session__grading_date",
            "candidate__student__last_name",
            "candidate__student__first_name",
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


class PromotionViewSet(mixins.ListModelMixin, GenericViewSet):
    serializer_class = PromotionSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("gradings.view_promotion",),
    }

    query_filters = (by_id("session", "grading_candidate__session_id"),)

    def get_queryset(self) -> QuerySet[Promotion]:
        return Promotion.objects.select_related(
            "student",
            "to_rank",
        ).order_by("-effective_date", "-promoted_at", "-pk")


class LegacyGradingRecordViewSet(
    mixins.ListModelMixin,
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
        "link_student": ("gradings.can_reconcile_imported_history",),
        "unlink_student": ("gradings.can_reconcile_imported_history",),
        "resolve_current_rank": ("gradings.can_reconcile_imported_history",),
        "resolve_testing_for_rank": ("gradings.can_reconcile_imported_history",),
        "void": ("gradings.can_reconcile_imported_history",),
    }

    query_filters = (
        boolean("linked", "student__isnull", invert=True),
        boolean("voided", "is_void"),
    )

    def get_queryset(self) -> QuerySet[LegacyGradingRecord]:
        return LegacyGradingRecord.objects.select_related(
            "student",
            "current_rank",
            "testing_for_rank",
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
