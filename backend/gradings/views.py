from __future__ import annotations

from typing import Any, cast

from django.db.models import Prefetch, Q, QuerySet, prefetch_related_objects
from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.serializers import BaseSerializer

from accounts.models import User
from accounts.permissions import (
    DELETE_ANY_SESSION_PERMISSION,
    CanMakeFinalGradingDecision,
    CanOverrideLockedSession,
    CanPromoteStudent,
    HasRequiredPermissions,
)
from gradings.assessment_services import (
    add_item_comment,
    bulk_generate_candidate_assessments,
    bulk_start_candidate_assessments,
    delete_candidate_assessment,
    generate_candidate_assessment,
    update_candidate_assessment,
    update_candidate_assessment_item,
)
from gradings.exports import pdf
from gradings.exports.records import export_records
from gradings.exports.sheets import export_sheets
from gradings.exports.summary import export_summary
from gradings.legacy_matching import (
    SET_ASIDE_CHOICES,
    SHEET_NOTE_NAME,
    Suggestion,
    group_key,
    people_groups,
    suggest_for_groups,
)
from gradings.legacy_services import (
    bulk_link_legacy_records,
    bulk_unlink_legacy_records,
    link_legacy_record_to_student,
    put_back_name,
    resolve_legacy_rank,
    set_aside_keys,
    set_aside_names,
    unlink_legacy_record_from_student,
    void_legacy_record,
)
from gradings.models import (
    ROSTER_OPEN,
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    LegacyGradingRecord,
    candidate_order,
)
from gradings.outcome_services import (
    bulk_promote_candidates,
    discard_staged_decision,
    finalise_candidate_outcome,
    promote_candidate,
    promotion_eligibility_for_session,
    propose_for_candidate,
    stage_final_decision,
    staged_decisions_for_session,
)
from gradings.read_models import (
    candidate_assessment_summary,
    item_remarks,
    with_overall_counts,
)
from gradings.serializers import (
    AssessmentItemCommentRequestSerializer,
    AssessmentItemCommentSerializer,
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
    BulkUnlinkLegacyRecordsSerializer,
    CandidateAssessmentItemSavedSerializer,
    CandidateAssessmentItemSerializer,
    CandidateAssessmentSerializer,
    CandidateAssessmentSummarySerializer,
    CandidateExportSerializer,
    CandidateOutcomeFinaliseSerializer,
    CandidateOutcomeProposalSerializer,
    CandidateOutcomeSerializer,
    CandidatePromotionSerializer,
    GradingCandidateRosterSerializer,
    GradingCandidateSerializer,
    GradingSessionSerializer,
    GradingYearsSerializer,
    KeptStagedDecisionSerializer,
    LegacyGradingRecordSerializer,
    LegacyPeopleSummarySerializer,
    LegacyPersonSerializer,
    LegacyRecordCountsSerializer,
    LinkLegacyRecordSerializer,
    LockedCandidateWithdrawalSerializer,
    PromotionEligibilitySerializer,
    PromotionSerializer,
    ResolveLegacyRankSerializer,
    SessionQuerySerializer,
    SetAsideNamesSerializer,
    StagedDecisionDiscardQuerySerializer,
    StagedDecisionSerializer,
    VoidLegacyRecordSerializer,
    WithdrawalReasonSerializer,
)
from gradings.services import (
    ALREADY_IN_SESSION,
    REGISTERED_ELSEWHERE,
    AlreadyRegistered,
    apply_candidate_update,
    archive_grading_session,
    bulk_register_candidates,
    bulk_update_candidate_status,
    create_grading_session,
    delete_candidate,
    delete_grading_session,
    restore_grading_session,
    update_grading_session,
    with_session_progress,
    withdraw_locked_candidate,
)
from kukgrade.filtering import (
    QueryFilter,
    boolean,
    by_id,
    choices_in,
    exact,
    in_year,
    on_date,
    ordered_by,
    read_by_view,
    read_query,
)
from kukgrade.search import (
    ExactOnly,
    date_words,
    full_name_of,
    label_of,
    search,
    squashed,
)
from kukgrade.viewsets import KukGradeViewSet, ServiceDestroyMixin, run_bulk

_PEOPLE_BATCH = by_id("batch", "source_batch_id", "Only records from this import.")
_PEOPLE_SET_ASIDE = read_by_view(
    "set_aside",
    {"type": "string", "enum": list(SET_ASIDE_CHOICES)},
    "Only, or all but, the names the viewer has put aside for now.",
)
_PEOPLE_FILTERS = (
    _PEOPLE_BATCH,
    boolean(
        "linked",
        Q(student__isnull=False),
        "Only people whose records are (or are not) linked.",
    ),
    read_by_view("search", description="Part of the name as written."),
    read_by_view(
        "suggestion",
        {"type": "string", "enum": sorted(Suggestion.values)},
        "Only people whose suggested students are this clear.",
    ),
    _PEOPLE_SET_ASIDE,
)
_PEOPLE_SUMMARY_FILTERS = (_PEOPLE_BATCH, _PEOPLE_SET_ASIDE)


def _records_for_group(
    queryset: QuerySet[LegacyGradingRecord], key: str
) -> QuerySet[LegacyGradingRecord]:
    """Apply the same name grouping used by the people endpoint."""
    if key != group_key(key):
        return queryset.none()
    names = queryset.order_by().values_list("source_name", flat=True).distinct()
    matching = [name for name in names if group_key(name) == key]
    return queryset.filter(source_name__in=matching)


class WithdrawalReasonViewSet(KukGradeViewSet[GradingCandidate]):
    """The reasons a candidate can be withdrawn for, as every withdrawal
    control lists them."""

    serializer_class = WithdrawalReasonSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {"list": ("gradings.view_gradingcandidate",)}

    def list(self, request: Request) -> Response:
        # Paginated like every list endpoint, as the syllabus age bands are.
        page: list[dict[str, str]] | None = self.paginate_queryset(
            [  # type: ignore[arg-type]
                {"value": value, "label": label}
                for value, label in GradingCandidate.WithdrawalReason.choices
            ],
        )
        return self.get_paginated_response(self.get_serializer(page, many=True).data)


def _apply_archived(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
    if value == "only":
        return queryset.filter(archived_at__isnull=False)
    if value == "exclude":
        return queryset.filter(archived_at__isnull=True)
    if value == "include":
        return queryset
    return queryset.none()


# What reading a grading's records takes: whoever can may also download them
# as a PDF (owner, 2026-11-13).
_READS_RECORDS = (
    "gradings.view_gradingsession",
    "gradings.view_gradingcandidate",
    "gradings.view_candidateassessment",
    "gradings.view_candidateassessmentitem",
    "gradings.view_candidateoutcome",
)


class GradingSessionViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    ServiceDestroyMixin,
    KukGradeViewSet[GradingSession],
):
    delete_service = staticmethod(delete_grading_session)

    def perform_create(self, serializer: BaseSerializer[GradingSession]) -> None:
        asked = serializer.validated_data
        serializer.instance = create_grading_session(
            title=str(asked["title"]),
            grading_date=asked["grading_date"],
            location=str(asked.get("location", "")),
            notes=str(asked.get("notes", "")),
            created_by=self.actor,
            status=cast(str | None, asked.get("status")),
        )

    def perform_update(self, serializer: BaseSerializer[GradingSession]) -> None:
        changes = dict(serializer.validated_data)
        target_status = cast(str | None, changes.pop("status", None))
        reason = cast(str, changes.pop("cancellation_reason", ""))
        serializer.instance = update_grading_session(
            cast(GradingSession, serializer.instance),
            changes=changes,
            target_status=target_status,
            reason=reason,
            actor=self.actor,
        )

    serializer_class = GradingSessionSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("gradings.view_gradingsession",),
        "retrieve": ("gradings.view_gradingsession",),
        "create": ("gradings.add_gradingsession",),
        "partial_update": ("gradings.change_gradingsession",),
        "destroy": ("gradings.delete_gradingsession",),
        "years": ("gradings.view_gradingsession",),
        # Whether the actor may is each service's own rule, with its own message.
        "archive": (DELETE_ANY_SESSION_PERMISSION,),
        "restore": (DELETE_ANY_SESSION_PERMISSION,),
        # Whoever can open the records may print them (owner, 2026-11-13).
        "export_records": _READS_RECORDS,
        "export_summary": _READS_RECORDS,
        "export_grading_sheets": _READS_RECORDS,
    }

    query_filters = (
        choices_in("status", "status", GradingSession.Status.values),
        boolean(
            "roster_open",
            ROSTER_OPEN,
            "Only sessions that accept candidates (draft or open), or only "
            "those that no longer do.",
        ),
        on_date("grading_date_from", "grading_date__gte"),
        on_date("grading_date_to", "grading_date__lte"),
        in_year("year", "grading_date", "Only sessions held in this year."),
        search(
            "search",
            (
                "title",
                "location",
                ExactOnly("notes"),
                # What the list shows, so what is on the screen can be typed:
                # "locked", "october", "2026", "25 oct".
                ExactOnly(label_of("status", GradingSession.Status.choices)),
                ExactOnly(date_words("grading_date")),
            ),
            "The title, location, notes, status and date of a session.",
        ),
        QueryFilter(
            "archived",
            _apply_archived,
            {"type": "string", "enum": ["exclude", "include", "only"]},
            "Archived sessions are left out unless asked for: `include` lists them "
            "with the rest, `only` lists just those.",
        ),
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
        # A list leaves archived sessions out unless asked; one session is
        # always reachable, so a link to an archived grading still opens it.
        if self.action == "list" and "archived" not in self.request.query_params:
            sessions = sessions.filter(archived_at__isnull=True)
        # Only a read serialises the instance it loaded: a write loads the row
        # to act on it, and its response is annotated afresh by the serializer.
        if self.action in ("list", "retrieve"):
            return with_session_progress(sessions)
        return sessions

    @extend_schema(request=None, responses=GradingSessionSerializer)
    @action(detail=True, methods=["post"])
    def archive(self, request: Request, *args: object, **kwargs: object) -> Response:
        """Hide a finished session from the lists. Nothing is erased."""
        archived = archive_grading_session(self.get_object(), cast(User, request.user))
        return Response(self.get_serializer(archived).data)

    @extend_schema(request=None, responses=GradingSessionSerializer)
    @action(detail=True, methods=["post"])
    def restore(self, request: Request, *args: object, **kwargs: object) -> Response:
        """Bring an archived session back into the lists."""
        restored = restore_grading_session(self.get_object(), cast(User, request.user))
        return Response(self.get_serializer(restored).data)

    @extend_schema(
        request=CandidateExportSerializer,
        responses={
            (200, "application/pdf"): OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="The records, one candidate after another.",
            ),
        },
    )
    @action(detail=True, methods=["post"], url_path="exports/records")
    def export_records(
        self, request: Request, *args: object, **kwargs: object
    ) -> HttpResponse:
        """Download the sealed records of the candidates chosen as one PDF,
        all or nothing."""
        payload = CandidateExportSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        made = export_records(
            self.get_object(), payload.validated_data["candidates"], self.actor
        )
        return pdf.response(made.document, made.content)

    @extend_schema(
        request=None,
        responses={
            (200, "application/pdf"): OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="Who passed and who did not, and passes by rank.",
            ),
        },
    )
    @action(detail=True, methods=["post"], url_path="exports/summary")
    def export_summary(
        self, request: Request, *args: object, **kwargs: object
    ) -> HttpResponse:
        """Download the session's summary as a PDF, once it is locked."""
        made = export_summary(self.get_object(), self.actor)
        return pdf.response(made.document, made.content)

    @extend_schema(
        request=CandidateExportSerializer,
        responses={
            (200, "application/pdf"): OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description="The grading form for each candidate, a page each.",
            ),
        },
    )
    @action(detail=True, methods=["post"], url_path="exports/grading-sheets")
    def export_grading_sheets(
        self, request: Request, *args: object, **kwargs: object
    ) -> HttpResponse:
        """Print the grading sheets of the candidates chosen as one PDF, while
        the grading is a draft or open, all or nothing."""
        payload = CandidateExportSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        made = export_sheets(
            self.get_object(), payload.validated_data["candidates"], self.actor
        )
        return pdf.response(made.document, made.content)

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
    ServiceDestroyMixin,
    KukGradeViewSet[GradingCandidate],
):
    """Registrations are created by bulk-register only. PATCH and DELETE
    change or remove one while its session is draft or open."""

    delete_service = staticmethod(delete_candidate)

    def perform_update(self, serializer: BaseSerializer[GradingCandidate]) -> None:
        serializer.instance = apply_candidate_update(
            cast(GradingCandidate, serializer.instance),
            session=cast(
                GradingSession | None,
                serializer.validated_data.get("session"),
            ),
            actor=self.actor,
        )

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
        "propose_outcome": (
            "gradings.add_candidateoutcome",
            "gradings.change_candidateoutcome",
        ),
        "bulk_register": ("gradings.add_gradingcandidate",),
        "bulk_generate_assessments": ("gradings.add_candidateassessment",),
        "bulk_update_status": ("gradings.change_gradingcandidate",),
        # The sensitive half is enforced by CanOverrideLockedSession on the
        # action itself, which also gives a clearer message.
        "withdraw": ("gradings.change_gradingcandidate",),
    }

    query_filters = (
        by_id("session", "session_id"),
        boolean(
            "withdrawn",
            Q(status=GradingCandidate.Status.WITHDRAWN),
            "Only withdrawn candidates, or only those still being graded.",
        ),
        search(
            "search",
            (
                "student__first_name",
                "student__last_name",
                full_name_of("student__first_name", "student__last_name"),
                "student__wksa_id",
                squashed("student__wksa_id"),
                ExactOnly("from_rank__name"),
                ExactOnly("testing_for_rank__name"),
                ExactOnly(label_of("status", GradingCandidate.Status.choices)),
            ),
            "A candidate's name, WKSA ID, ranks or status.",
        ),
    )

    def get_serializer_class(self) -> type[BaseSerializer[Any]]:
        # The list and one registration carry the assessment, the outcome and
        # the next action; what a write returns is the registration alone.
        if self.action in {"list", "retrieve"}:
            return GradingCandidateRosterSerializer
        return super().get_serializer_class()

    def get_queryset(self) -> QuerySet[GradingCandidate]:
        candidates = GradingCandidate.objects.select_related(
            "student",
            "from_rank",
            "testing_for_rank",
            "session",
            "outcome__assessment",
            "outcome__proposed_by",
            "outcome__decided_by",
            "promotion__student",
            "promotion__to_rank",
        )
        if self.action in {"list", "retrieve"}:
            candidates = candidates.prefetch_related(
                Prefetch(
                    "assessment",
                    queryset=with_overall_counts(
                        CandidateAssessment.objects.select_related(
                            "candidate__student",
                            "candidate__session",
                            "candidate__outcome",
                            "generated_by",
                        ),
                    ),
                ),
            )
        else:
            candidates = candidates.select_related("assessment")
        return candidates.order_by(*candidate_order())

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
        def register(asked: dict[str, Any]) -> dict[str, Any]:
            codes: dict[str, set[str]] = {}
            created, errors = bulk_register_candidates(
                session=asked["session"],
                rows=asked["candidates"],
                actor=self.actor,
                generate_assessments=asked["generate_assessments"],
                codes=codes,
            )
            return {
                "created": [
                    {"candidate": candidate, "assessment": assessment}
                    for candidate, assessment in created
                ],
                "errors": errors,
                "already_registered": {
                    student: AlreadyRegistered.THIS_SESSION
                    if ALREADY_IN_SESSION in row_codes
                    else AlreadyRegistered.ANOTHER_GRADING
                    for student, row_codes in codes.items()
                    if row_codes & {ALREADY_IN_SESSION, REGISTERED_ELSEWHERE}
                },
            }

        return run_bulk(
            request,
            request_serializer=BulkCandidateRegistrationSerializer,
            result_serializer=BulkCandidateRegistrationResultSerializer,
            run=register,
        )

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
        def generate(asked: dict[str, Any]) -> dict[str, Any]:
            created, errors = bulk_generate_candidate_assessments(
                candidates=asked["candidates"],
                generated_by=self.actor,
            )
            return {"created": created, "errors": errors}

        return run_bulk(
            request,
            request_serializer=BulkAssessmentGenerationSerializer,
            result_serializer=BulkAssessmentGenerationResultSerializer,
            run=generate,
        )

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
        def update(asked: dict[str, Any]) -> dict[str, Any]:
            updated, errors = bulk_update_candidate_status(
                candidates=asked["candidates"],
                new_status=asked["status"],
                withdrawal_reason=asked.get("withdrawal_reason"),
                withdrawal_note=asked.get("withdrawal_note"),
                actor=self.actor,
            )
            return {"updated": updated, "errors": errors}

        return run_bulk(
            request,
            request_serializer=BulkCandidateStatusUpdateSerializer,
            result_serializer=BulkCandidateStatusUpdateResultSerializer,
            run=update,
        )

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
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        updated = withdraw_locked_candidate(
            candidate,
            reason=str(serializer.validated_data["withdrawal_reason"]),
            note=str(serializer.validated_data.get("withdrawal_note", "")),
            actor=self.actor,
        )
        return Response(
            GradingCandidateSerializer(updated, context={"request": request}).data,
        )

    @extend_schema(
        request=CandidateOutcomeProposalSerializer,
        responses=CandidateOutcomeSerializer,
    )
    @action(detail=True, methods=["post"], url_path="propose-outcome")
    def propose_outcome(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        candidate = self.get_object()
        serializer = CandidateOutcomeProposalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        outcome = propose_for_candidate(
            candidate,
            proposed_outcome=str(serializer.validated_data["proposed_outcome"]),
            proposal_notes=str(serializer.validated_data.get("proposal_notes", "")),
            actor=cast(User, request.user),
        )
        return Response(
            CandidateOutcomeSerializer(outcome, context={"request": request}).data,
        )


class CandidateAssessmentViewSet(
    mixins.ListModelMixin,
    mixins.UpdateModelMixin,
    ServiceDestroyMixin,
    KukGradeViewSet[CandidateAssessment],
):
    serializer_class = CandidateAssessmentSerializer
    permission_classes = [HasRequiredPermissions]
    delete_service = staticmethod(delete_candidate_assessment)

    def perform_update(self, serializer: BaseSerializer[CandidateAssessment]) -> None:
        serializer.instance = update_candidate_assessment(
            cast(CandidateAssessment, serializer.instance),
            status=cast(str | None, serializer.validated_data.get("status")),
            notes=cast(str | None, serializer.validated_data.get("notes")),
            actor=self.actor,
        )

    permission_map = {
        "list": ("gradings.view_candidateassessment",),
        "partial_update": ("gradings.change_candidateassessment",),
        "bulk_start": ("gradings.change_candidateassessment",),
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
            "candidate__session",
            "candidate__outcome",
            "generated_by",
        )
        # A list needs only each assessment's counts; an object action may
        # summarise by category, so it reads the items.
        assessments = (
            with_overall_counts(assessments)
            if self.action == "list"
            else assessments.prefetch_related("items")
        )
        return assessments.order_by(*candidate_order("candidate__"))

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
        and the final-decision board all read the same counts.
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
        def start(asked: dict[str, Any]) -> dict[str, Any]:
            started, errors = bulk_start_candidate_assessments(
                assessments=asked["assessments"],
                actor=self.actor,
            )
            return {"started": started, "errors": errors}

        return run_bulk(
            request,
            request_serializer=BulkAssessmentStartSerializer,
            result_serializer=BulkAssessmentStartResultSerializer,
            run=start,
        )


class CandidateAssessmentItemViewSet(
    mixins.ListModelMixin,
    mixins.UpdateModelMixin,
    KukGradeViewSet[CandidateAssessmentItem],
):
    serializer_class = CandidateAssessmentItemSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("gradings.view_candidateassessmentitem",),
        "partial_update": ("gradings.change_candidateassessmentitem",),
        "comments": ("gradings.change_candidateassessmentitem",),
    }

    query_filters = (by_id("assessment", "assessment_id"),)

    def perform_update(
        self,
        serializer: BaseSerializer[CandidateAssessmentItem],
    ) -> None:
        saved = update_candidate_assessment_item(
            cast(CandidateAssessmentItem, serializer.instance),
            result=cast(str | None, serializer.validated_data.get("result")),
            reason=str(serializer.validated_data.get("reason", "")),
            assessor=self.actor,
        )
        # Served as the list serves it: its comments and changes read once each.
        prefetch_related_objects([saved], *item_remarks())
        serializer.instance = saved

    def get_serializer_class(self) -> type[BaseSerializer[Any]]:
        # A mark returns the assessment's counts too; the list does not.
        if self.action == "partial_update":
            return CandidateAssessmentItemSavedSerializer
        return super().get_serializer_class()

    @extend_schema(
        request=CandidateAssessmentItemSerializer,
        responses=CandidateAssessmentItemSavedSerializer,
    )
    def partial_update(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        """Mark an item, and get the assessment's counts back with it."""
        return super().partial_update(request, *args, **kwargs)

    def get_queryset(self) -> QuerySet[CandidateAssessmentItem]:
        return (
            # The assessment and its session decide whether a change needs a
            # reason and whether a mark can be cleared (reason_required, can_clear).
            CandidateAssessmentItem.objects.select_related(
                "assessor",
                "assessment__candidate__session",
            )
            .prefetch_related(*item_remarks())
            .order_by("assessment_id", "position")
        )

    @extend_schema(
        request=AssessmentItemCommentRequestSerializer,
        responses={201: AssessmentItemCommentSerializer},
    )
    @action(detail=True, methods=["post"])
    def comments(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        item = self.get_object()
        serializer = AssessmentItemCommentRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = add_item_comment(
            item,
            str(serializer.validated_data["body"]),
            cast(User, request.user),
        )
        return Response(
            AssessmentItemCommentSerializer(comment).data,
            status=status.HTTP_201_CREATED,
        )


class CandidateOutcomeViewSet(KukGradeViewSet[CandidateOutcome]):
    serializer_class = CandidateOutcomeSerializer
    permission_classes = [HasRequiredPermissions]
    # A Master's staged decision is a draft kept whole: PUT replaces it.
    http_method_names = [*KukGradeViewSet.http_method_names, "put"]
    permission_map = {
        "staged_decision": ("gradings.view_candidateoutcome",),
        "staged_decisions": ("gradings.view_candidateoutcome",),
        # The sensitive half of these two is enforced by the dedicated
        # permission class on the action, which also gives a better message.
        "finalise": ("gradings.view_candidateoutcome",),
        "promote": ("gradings.view_candidateoutcome",),
        "bulk_promote": ("gradings.view_candidateoutcome",),
        "promotion_eligibility": ("gradings.view_candidateoutcome",),
    }

    def get_queryset(self) -> QuerySet[CandidateOutcome]:
        return CandidateOutcome.objects.select_related(
            "proposed_by",
            "decided_by",
        )

    @extend_schema(
        parameters=[SessionQuerySerializer],
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
        session = read_query(request, SessionQuerySerializer)["session"]
        rows = promotion_eligibility_for_session(session)
        return Response(PromotionEligibilitySerializer(rows, many=True).data)

    @extend_schema(
        parameters=[SessionQuerySerializer],
        responses=KeptStagedDecisionSerializer(many=True),
    )
    @action(
        detail=False,
        methods=["get"],
        url_path="staged-decisions",
        filter_backends=[],
        pagination_class=None,
        permission_classes=[HasRequiredPermissions, CanMakeFinalGradingDecision],
    )
    def staged_decisions(
        self, request: Request, *args: object, **kwargs: object
    ) -> Response:
        """The viewer's own decisions staged in a session and not yet recorded."""
        session = read_query(request, SessionQuerySerializer)["session"]
        staged = staged_decisions_for_session(session, cast(User, request.user))
        return Response(KeptStagedDecisionSerializer(staged, many=True).data)

    @extend_schema(
        methods=["PUT"],
        request=StagedDecisionSerializer,
        responses=StagedDecisionSerializer,
    )
    @extend_schema(
        methods=["DELETE"],
        parameters=[StagedDecisionDiscardQuerySerializer],
        request=None,
        responses={204: None},
    )
    @action(
        detail=True,
        methods=["put", "delete"],
        url_path="staged-decision",
        permission_classes=[HasRequiredPermissions, CanMakeFinalGradingDecision],
    )
    def staged_decision(
        self, request: Request, *args: object, **kwargs: object
    ) -> Response:
        """Keep, or drop, the viewer's chosen decision until it is recorded."""
        outcome = self.get_object()
        if request.method == "DELETE":
            revision = read_query(request, StagedDecisionDiscardQuerySerializer)[
                "revision"
            ]
            discard_staged_decision(outcome, cast(User, request.user), revision)
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = StagedDecisionSerializer(
            data=request.data,
            context={"request": request, "outcome": outcome},
        )
        serializer.is_valid(raise_exception=True)
        staged = stage_final_decision(
            outcome,
            final_outcome=str(serializer.validated_data["final_outcome"]),
            decision_notes=str(serializer.validated_data.get("decision_notes", "")),
            conditional_requirements=str(
                serializer.validated_data.get("conditional_requirements", ""),
            ),
            actor=self.actor,
            revision=int(serializer.validated_data["revision"]),
        )
        return Response(StagedDecisionSerializer(staged).data)

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
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        updated = finalise_candidate_outcome(
            outcome,
            final_outcome=str(serializer.validated_data["final_outcome"]),
            decision_notes=str(serializer.validated_data.get("decision_notes", "")),
            conditional_requirements=str(
                serializer.validated_data.get("conditional_requirements", ""),
            ),
            actor=self.actor,
        )
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
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        promotion = promote_candidate(
            outcome,
            actor=self.actor,
            notes=str(serializer.validated_data.get("notes", "")),
        )
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
        def promote(asked: dict[str, Any]) -> dict[str, Any]:
            promoted, errors = bulk_promote_candidates(
                outcomes=asked["outcomes"],
                actor=self.actor,
            )
            return {"promoted": promoted, "errors": errors}

        return run_bulk(
            request,
            request_serializer=BulkPromotionSerializer,
            result_serializer=BulkPromotionResultSerializer,
            run=promote,
        )


# Someone's record, not yet linked: a voided record and a sheet note are
# no one's, so neither waits (legacy_matching leaves both out too).
_AWAITING_LINK_Q = Q(student__isnull=True, is_void=False) & ~Q(
    source_name=SHEET_NOTE_NAME
)
_AWAITING_LINK = boolean(
    "awaiting_link",
    _AWAITING_LINK_Q,
    "Someone's record not yet linked to a student: not voided, not a sheet note.",
)

_NEEDS_RANK = boolean(
    "needs_rank",
    LegacyGradingRecord.rank_unmatched(),
    "Records with a rank written but not yet matched to one of KukGrade's.",
)


class LegacyGradingRecordViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    KukGradeViewSet[LegacyGradingRecord],
):
    """Historical import records - read for both roles, reconciliation
    (link/unlink/resolve-rank/void) administrator-only. No ordinary
    create/update/delete: rows are only ever created by
    data_imports.services.commit_legacy_grading_import, and only ever changed
    through gradings.legacy_services."""

    serializer_class = LegacyGradingRecordSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("gradings.view_legacygradingrecord",),
        "retrieve": ("gradings.view_legacygradingrecord",),
        "link_student": ("gradings.can_reconcile_imported_history",),
        "unlink_student": ("gradings.can_reconcile_imported_history",),
        "resolve_rank": ("gradings.can_reconcile_imported_history",),
        "void": ("gradings.can_reconcile_imported_history",),
        "people": ("gradings.can_reconcile_imported_history",),
        "people_summary": ("gradings.can_reconcile_imported_history",),
        "counts": ("gradings.view_legacygradingrecord",),
        "bulk_link": ("gradings.can_reconcile_imported_history",),
        "bulk_unlink": ("gradings.can_reconcile_imported_history",),
        "set_aside": ("gradings.can_reconcile_imported_history",),
    }

    query_filters = (
        boolean("linked", Q(student__isnull=False)),
        boolean("voided", Q(is_void=True)),
        by_id("batch", "source_batch_id", "Records from this import."),
        _NEEDS_RANK,
        _AWAITING_LINK,
        exact("source_name", "source_name__iexact", "The name exactly as written."),
        QueryFilter(
            "group_key",
            _records_for_group,
            description="The stable name-group key served by the people list.",
        ),
        search("search", ("source_name",), "The name as written."),
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
        updated = link_legacy_record_to_student(
            record_,
            serializer.validated_data["student"],
            actor=self.actor,
            replace=serializer.validated_data["replace"],
        )
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
    @action(detail=True, methods=["post"], url_path="resolve-rank")
    def resolve_rank(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        record_ = self.get_object()
        serializer = ResolveLegacyRankSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        updated = resolve_legacy_rank(
            record_,
            serializer.validated_data["field"],
            serializer.validated_data["rank"],
            actor=cast(User, request.user),
        )
        return Response(LegacyGradingRecordSerializer(updated).data)

    def _people_records(self) -> QuerySet[LegacyGradingRecord]:
        """The records the people list is about, narrowed by its filters:
        voided records are no one's."""
        return self.filter_queryset(
            LegacyGradingRecord.objects.select_related(
                "student",
                "current_rank",
                "testing_for_rank",
            ).filter(is_void=False),
        )

    def _aside(self) -> list[str]:
        """The names the viewer has put aside, when the list asks about them."""
        if not self.request.query_params.get("set_aside"):
            return []
        return set_aside_keys(cast(User, self.request.user))

    @extend_schema(responses=LegacyPersonSerializer(many=True))
    @action(detail=False, methods=["get"], query_filters=_PEOPLE_FILTERS)
    def people(self, request: Request, *args: object, **kwargs: object) -> Response:
        """Records grouped by the name as written, with suggested students.

        Suggestions only: nothing is linked until a person confirms it.
        Voided records and sheet notes are left out.
        Only the names on the page are scored for suggested students, unless
        the list is filtered by how clear those are, which needs them all.
        """
        params = request.query_params
        groups = people_groups(
            self._people_records(),
            search_term=params.get("search", ""),
            suggestion=params.get("suggestion", ""),
            set_aside=params.get("set_aside", ""),
            aside=self._aside(),
        )
        page: list[Any] | None = self.paginate_queryset(groups)  # type: ignore[arg-type]
        assert page is not None
        if page and not params.get("suggestion"):
            suggest_for_groups(page)
        return self.get_paginated_response(LegacyPersonSerializer(page, many=True).data)

    @extend_schema(responses=LegacyRecordCountsSerializer)
    @action(
        detail=False,
        methods=["get"],
        pagination_class=None,
        query_filters=(by_id("batch", "source_batch_id", "Only this import's."),),
    )
    def counts(self, request: Request, *args: object, **kwargs: object) -> Response:
        """How many records still wait for a student, counted in one query."""
        records = self.filter_queryset(LegacyGradingRecord.objects.all())
        return Response(
            LegacyRecordCountsSerializer(
                {"awaiting_link": records.filter(_AWAITING_LINK_Q).count()},
            ).data,
        )

    @extend_schema(responses=LegacyPeopleSummarySerializer)
    @action(
        detail=False,
        methods=["get"],
        url_path="people-summary",
        pagination_class=None,
        query_filters=_PEOPLE_SUMMARY_FILTERS,
    )
    def people_summary(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        """How many names still wait, by how clear their suggestions are; how
        many have every record linked, or any; and how many the viewer has put
        aside."""
        records = self._people_records()
        waiting = people_groups(
            records.filter(student__isnull=True),
            set_aside=request.query_params.get("set_aside", ""),
            aside=self._aside(),
        )
        suggest_for_groups(waiting)
        counts = {kind: 0 for kind in Suggestion.values}
        for group in waiting:
            counts[group.suggestion] += 1
        # Every name, linked or not, to find the ones with nothing left to
        # link: a name partly linked counts once, as still to link.
        linked = sum(
            1
            for group in people_groups(records)
            if all(record.student_id is not None for record in group.records)
        )
        unlinked = records.filter(student__isnull=True)
        put_aside = people_groups(
            unlinked,
            set_aside="only",
            aside=set_aside_keys(cast(User, request.user)),
        )
        return Response(
            LegacyPeopleSummarySerializer(
                {
                    "names": len(waiting),
                    "linked": linked,
                    "with_a_link": len(
                        people_groups(records.filter(student__isnull=False))
                    ),
                    "set_aside": len(put_aside),
                    **counts,
                },
            ).data,
        )

    @extend_schema(
        methods=["POST"],
        request=SetAsideNamesSerializer,
        responses=SetAsideNamesSerializer,
    )
    @extend_schema(
        methods=["DELETE"],
        parameters=[
            OpenApiParameter(
                "group_key", str, required=True, description="The name to put back."
            ),
        ],
        request=None,
        responses={204: None},
    )
    @action(
        detail=False,
        methods=["post", "delete"],
        url_path="people/set-aside",
        filter_backends=[],
        pagination_class=None,
    )
    def set_aside(self, request: Request, *args: object, **kwargs: object) -> Response:
        """Add to the viewer's own names put aside for now, or put one back."""
        viewer = cast(User, request.user)
        if request.method == "DELETE":
            key = request.query_params.get("group_key", "")
            if not key:
                raise ValidationError({"group_key": ["Choose a name to put back."]})
            put_back_name(viewer, key)
            return Response(status=status.HTTP_204_NO_CONTENT)
        payload = SetAsideNamesSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        keys = set_aside_names(viewer, payload.validated_data["group_keys"])
        return Response(SetAsideNamesSerializer({"group_keys": keys}).data)

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
        request=BulkUnlinkLegacyRecordsSerializer,
        responses=LegacyGradingRecordSerializer(many=True),
    )
    # Not paginated: the response is the records just unlinked, as a list.
    @action(
        detail=False,
        methods=["post"],
        url_path="bulk-unlink",
        filter_backends=[],
        pagination_class=None,
    )
    def bulk_unlink(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        """Unlink many records at once, all or nothing - Undo after a bulk link."""
        payload = BulkUnlinkLegacyRecordsSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        unlinked = bulk_unlink_legacy_records(
            payload.validated_data["records"],
            actor=cast(User, request.user),
        )
        fresh = self.get_queryset().filter(pk__in=[record.pk for record in unlinked])
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
        updated = void_legacy_record(
            record_,
            reason=str(serializer.validated_data["reason"]),
            actor=self.actor,
        )
        return Response(LegacyGradingRecordSerializer(updated).data)
