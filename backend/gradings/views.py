from __future__ import annotations

from collections.abc import Mapping
from typing import Any, cast

from django.db.models import Q, QuerySet
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
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
from gradings.assessment_services import (
    bulk_generate_candidate_assessments,
    bulk_start_candidate_assessments,
    delete_candidate_assessment,
    generate_candidate_assessment,
    reopen_candidate_assessment,
)
from gradings.legacy_matching import (
    SHEET_NOTE_NAME,
    PersonGroup,
    group_key,
    group_records,
    suggest_for_groups,
)
from gradings.legacy_services import (
    bulk_link_legacy_records,
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
from gradings.outcome_services import (
    bulk_promote_candidates,
    create_candidate_outcome,
    promotion_eligibility_for_session,
)
from gradings.read_models import candidate_assessment_summary, with_overall_counts
from gradings.serializers import (
    BulkAssessmentGenerationResultSerializer,
    BulkAssessmentGenerationSerializer,
    BulkAssessmentStartResultSerializer,
    BulkAssessmentStartSerializer,
    BulkCandidateRegistrationResultSerializer,
    BulkCandidateRegistrationSerializer,
    BulkCandidateStatusUpdateResultSerializer,
    BulkCandidateStatusUpdateSerializer,
    BulkLinkLegacyRecordsSerializer,
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
    GradingYearsSerializer,
    LegacyGradingRecordSerializer,
    LegacyPeopleSummarySerializer,
    LegacyPersonSerializer,
    LinkLegacyRecordSerializer,
    LockedCandidateWithdrawalSerializer,
    PromotionEligibilitySerializer,
    PromotionSerializer,
    ResolveLegacyRankSerializer,
    VoidLegacyRecordSerializer,
    WithdrawalReasonSerializer,
)
from gradings.services import (
    bulk_register_candidates,
    bulk_update_candidate_status,
    delete_candidate,
    delete_grading_session,
    with_session_progress,
)
from kukgrade.filtering import (
    QueryFilter,
    boolean,
    by_id,
    choices_in,
    exact,
    on_date,
    ordered_by,
    search,
)

_PEOPLE_PARAMETERS = frozenset(
    {
        "batch",
        "linked",
        "search",
        "suggestion",
        "group_keys",
        "exclude_group_keys",
        "page",
        "page_size",
        "format",
    },
)
_PEOPLE_SUMMARY_PARAMETERS = frozenset(
    {"batch", "search", "exclude_group_keys", "format"},
)
_PEOPLE_SUGGESTIONS = ("clear", "choose", "none")
_PEOPLE_KEY_LIMIT = 100
_PEOPLE_BATCH = OpenApiParameter(
    "batch", int, description="Only records from this import."
)
_PEOPLE_SEARCH = OpenApiParameter(
    "search", str, description="Part of the name as written."
)
_PEOPLE_EXCLUDE = OpenApiParameter(
    "exclude_group_keys",
    str,
    description="Leave these names out (comma-separated group keys).",
)


def _records_for_group(
    queryset: QuerySet[LegacyGradingRecord], key: str
) -> QuerySet[LegacyGradingRecord]:
    """Apply the same name grouping used by the people endpoint."""
    if key != group_key(key):
        return queryset.none()
    names = queryset.order_by().values_list("source_name", flat=True).distinct()
    matching = [name for name in names if group_key(name) == key]
    return queryset.filter(source_name__in=matching)


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
        "years": ("gradings.view_gradingsession",),
    }

    query_filters = (
        choices_in("status", "status", GradingSession.Status.values),
        on_date("grading_date_from", "grading_date__gte"),
        on_date("grading_date_to", "grading_date__lte"),
        search("search", ("title", "location")),
        ordered_by(
            "ordering",
            {
                "grading_date": ("grading_date", "created_at"),
                "-grading_date": ("-grading_date", "created_at"),
            },
            "Newest first unless given.",
        ),
    )

    def get_queryset(self) -> QuerySet[GradingSession]:
        sessions = GradingSession.objects.order_by("-grading_date", "created_at")
        # Only a read serialises the instance it loaded: a write loads the row
        # to act on it, and its response is annotated afresh by the serializer.
        if self.action in ("list", "retrieve"):
            return with_session_progress(sessions)
        return sessions

    def destroy(self, request: Request, *args: object, **kwargs: object) -> Response:
        instance = self.get_object()
        delete_grading_session(instance, actor=cast(User, request.user))
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        request=None,
        responses=GradingYearsSerializer,
        filters=False,
    )
    @action(detail=False, methods=["get"], pagination_class=None)
    def years(self, request: Request) -> Response:
        """Every year that has a grading session, newest first."""
        years = GradingSession.objects.order_by().dates(
            "grading_date", "year", order="DESC"
        )
        return Response({"years": [d.year for d in years]})


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
            "session",
            "assessment",
            "outcome",
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
        choices_in("status", "status", CandidateAssessment.Status.values),
    )

    def get_queryset(self) -> QuerySet[CandidateAssessment]:
        assessments = CandidateAssessment.objects.select_related(
            "candidate__student",
            "generated_by",
        )
        # A list needs only each assessment's counts; an object action may
        # summarise by category, so it reads the items.
        assessments = (
            with_overall_counts(assessments)
            if self.action == "list"
            else assessments.prefetch_related("items")
        )
        return assessments.order_by(
            "candidate__session__grading_date",
            "candidate__student__last_name",
            "candidate__student__first_name",
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

        Served here rather than recounted by the client, so scoring, review
        and the final-decision board all read the same counts. See FDR-046.
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
        ).order_by("assessment_id", "position")


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
        "promotion_eligibility": ("gradings.view_candidateoutcome",),
    }

    query_filters = (
        by_id("session", "candidate__session_id"),
        by_id("candidate", "candidate_id"),
    )

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
        parameters=[OpenApiParameter("session", int, required=True)],
        responses=PromotionEligibilitySerializer(many=True),
    )
    @action(
        detail=False,
        methods=["get"],
        url_path="promotion-eligibility",
        filter_backends=[],
        pagination_class=None,
    )
    def promotion_eligibility(
        self, request: Request, *args: object, **kwargs: object
    ) -> Response:
        raw_session = request.query_params.get("session", "")
        if not raw_session.isdecimal() or int(raw_session) < 1:
            raise ValidationError({"session": ["Choose a grading session."]})
        rows = promotion_eligibility_for_session(int(raw_session))
        return Response(PromotionEligibilitySerializer(rows, many=True).data)

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


def _needs_rank(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
    unresolved = Q(~Q(source_current_rank_text=""), current_rank__isnull=True) | Q(
        ~Q(source_testing_for_rank_text=""),
        testing_for_rank__isnull=True,
    )
    if value == "true":
        return queryset.filter(unresolved)
    if value == "false":
        return queryset.exclude(unresolved)
    return queryset.none()


def _awaiting_link(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
    # Someone's record, not yet linked: a voided record and a sheet note are
    # no one's, so neither waits (legacy_matching leaves both out too).
    awaiting = Q(student__isnull=True, is_void=False) & ~Q(source_name=SHEET_NOTE_NAME)
    if value == "true":
        return queryset.filter(awaiting)
    if value == "false":
        return queryset.exclude(awaiting)
    return queryset.none()


_AWAITING_LINK = QueryFilter(
    "awaiting_link",
    _awaiting_link,
    {"type": "boolean"},
    "Someone's record not yet linked to a student: not voided, not a sheet note.",
)

_NEEDS_RANK = QueryFilter(
    "needs_rank",
    _needs_rank,
    {"type": "boolean"},
    "Records with a rank written but not yet matched to one of KukGrade's.",
)


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
        "people": ("gradings.can_reconcile_imported_history",),
        "people_summary": ("gradings.can_reconcile_imported_history",),
        "bulk_link": ("gradings.can_reconcile_imported_history",),
    }

    query_filters = (
        boolean("linked", "student__isnull", invert=True),
        boolean("voided", "is_void"),
        by_id("batch", "source_batch_id", "Records from this import."),
        _NEEDS_RANK,
        _AWAITING_LINK,
        exact("source_name", "source_name__iexact", "The name exactly as written."),
        QueryFilter(
            "group_key",
            _records_for_group,
            description="The stable name-group key served by the people list.",
        ),
        search("search", ("source_name",), "Part of the name as written."),
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

    def _people_groups(
        self,
        params: Mapping[str, str],
        allowed: frozenset[str],
        *,
        linked: str | None = None,
    ) -> list[PersonGroup]:
        """The name groups the people list and its summary are both about."""
        unknown = sorted(set(params) - allowed)
        if unknown:
            raise ValidationError(
                {name: ["This list cannot be filtered that way."] for name in unknown},
            )
        suggestion = params.get("suggestion", "")
        if suggestion and suggestion not in _PEOPLE_SUGGESTIONS:
            raise ValidationError({"suggestion": ["Choose clear, choose or none."]})
        keys: dict[str, set[str]] = {}
        for name in ("group_keys", "exclude_group_keys"):
            keys[name] = {key for key in params.get(name, "").split(",") if key}
            if len(keys[name]) > _PEOPLE_KEY_LIMIT:
                raise ValidationError(
                    {name: [f"Give at most {_PEOPLE_KEY_LIMIT} names."]},
                )
        records = LegacyGradingRecord.objects.select_related(
            "student",
            "current_rank",
            "testing_for_rank",
        ).filter(is_void=False)
        batch = params.get("batch", "")
        if batch:
            records = (
                records.filter(source_batch_id=int(batch))
                if batch.isdecimal()
                else records.none()
            )
        linked = params.get("linked", "") if linked is None else linked
        if linked == "true":
            records = records.filter(student__isnull=False)
        elif linked == "false":
            records = records.filter(student__isnull=True)
        elif linked:
            records = records.none()
        groups = group_records(records.order_by("pk"))
        if keys["group_keys"]:
            groups = [group for group in groups if group.key in keys["group_keys"]]
        if keys["exclude_group_keys"]:
            groups = [
                group for group in groups if group.key not in keys["exclude_group_keys"]
            ]
        needle = params.get("search", "").strip().lower()
        if needle:
            groups = [
                group
                for group in groups
                if needle in group.key or needle in group.source_name.lower()
            ]
        if suggestion:
            suggest_for_groups(groups)
            groups = [group for group in groups if group.suggestion == suggestion]
        return groups

    @extend_schema(
        parameters=[
            _PEOPLE_BATCH,
            OpenApiParameter(
                "linked",
                bool,
                description="Only people whose records are (or are not) linked.",
            ),
            _PEOPLE_SEARCH,
            OpenApiParameter(
                "suggestion",
                str,
                enum=list(_PEOPLE_SUGGESTIONS),
                description="Only people whose suggested students are this clear.",
            ),
            OpenApiParameter(
                "group_keys",
                str,
                description="Only these names (comma-separated group keys).",
            ),
            _PEOPLE_EXCLUDE,
        ],
        responses=LegacyPersonSerializer(many=True),
    )
    @action(detail=False, methods=["get"], filter_backends=[])
    def people(self, request: Request, *args: object, **kwargs: object) -> Response:
        """Records grouped by the name as written, with suggested students.

        Suggestions only: nothing is linked until a person confirms it
        (import Decision 3). Voided records and sheet notes are left out.
        Only the names on the page are scored for suggested students, unless
        the list is filtered by how clear those are, which needs them all.
        """
        groups = self._people_groups(request.query_params, _PEOPLE_PARAMETERS)
        page: list[Any] | None = self.paginate_queryset(groups)  # type: ignore[arg-type]
        assert page is not None
        if page and not request.query_params.get("suggestion"):
            suggest_for_groups(page)
        return self.get_paginated_response(LegacyPersonSerializer(page, many=True).data)

    @extend_schema(
        parameters=[_PEOPLE_BATCH, _PEOPLE_SEARCH, _PEOPLE_EXCLUDE],
        responses=LegacyPeopleSummarySerializer,
    )
    @action(
        detail=False,
        methods=["get"],
        url_path="people-summary",
        filter_backends=[],
        pagination_class=None,
    )
    def people_summary(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        """How many names still wait, by how clear their suggested students are."""
        groups = self._people_groups(
            request.query_params.dict(),
            _PEOPLE_SUMMARY_PARAMETERS,
            linked="false",
        )
        suggest_for_groups(groups)
        counts = {kind: 0 for kind in _PEOPLE_SUGGESTIONS}
        for group in groups:
            counts[group.suggestion] += 1
        return Response(
            LegacyPeopleSummarySerializer(
                {"names": len(groups), **counts},
            ).data,
        )

    @extend_schema(
        request=BulkLinkLegacyRecordsSerializer,
        responses=LegacyGradingRecordSerializer(many=True),
    )
    # Not paginated: the response is the records just linked, as a list.
    @action(
        detail=False,
        methods=["post"],
        url_path="bulk-link",
        filter_backends=[],
        pagination_class=None,
    )
    def bulk_link(self, request: Request, *args: object, **kwargs: object) -> Response:
        """Link many records at once, all or nothing - one person's history to
        the student confirmed for it, say."""
        payload = BulkLinkLegacyRecordsSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        linked = bulk_link_legacy_records(
            [
                (link["record"], link["student"])
                for link in payload.validated_data["links"]
            ],
            actor=cast(User, request.user),
            replace=payload.validated_data["replace"],
        )
        fresh = self.get_queryset().filter(pk__in=[record.pk for record in linked])
        return Response(LegacyGradingRecordSerializer(fresh, many=True).data)

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
