from __future__ import annotations

import uuid
from typing import cast

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import QuerySet
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
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    Promotion,
)
from gradings.serializers import (
    CandidateAssessmentItemSerializer,
    CandidateAssessmentSerializer,
    CandidateOutcomeFinaliseSerializer,
    CandidateOutcomeProposalSerializer,
    CandidateOutcomeSerializer,
    CandidatePromotionSerializer,
    GradingCandidateSerializer,
    GradingSessionSerializer,
    LockedCandidateWithdrawalSerializer,
    PromotionSerializer,
    raise_drf_validation_error,
)
from gradings.services import (
    candidate_assessment_summary,
    create_candidate_outcome,
    delete_candidate,
    delete_grading_session,
    generate_candidate_assessment,
    validate_candidate_can_be_deleted,
    validate_session_can_be_deleted,
)
from kukgrade.filtering import parse_date_filter
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

    def get_queryset(self) -> QuerySet[GradingSession]:
        queryset = GradingSession.objects.select_related("created_by").order_by(
            "-grading_date",
            "created_at",
        )

        status_filter = self.request.query_params.get("status")
        if status_filter in GradingSession.Status.values:
            queryset = queryset.filter(status=status_filter)
        elif status_filter:
            queryset = queryset.none()

        grading_date_value = self.request.query_params.get("grading_date")
        grading_date = parse_date_filter(grading_date_value)
        if grading_date:
            queryset = queryset.filter(grading_date=grading_date)
        elif grading_date_value:
            return queryset.none()

        grading_date_from_value = self.request.query_params.get("grading_date_from")
        grading_date_from = parse_date_filter(grading_date_from_value)
        if grading_date_from:
            queryset = queryset.filter(grading_date__gte=grading_date_from)
        elif grading_date_from_value:
            return queryset.none()

        grading_date_to_value = self.request.query_params.get("grading_date_to")
        grading_date_to = parse_date_filter(grading_date_to_value)
        if grading_date_to:
            queryset = queryset.filter(grading_date__lte=grading_date_to)
        elif grading_date_to_value:
            return queryset.none()

        if (
            grading_date_from is not None
            and grading_date_to is not None
            and grading_date_from > grading_date_to
        ):
            return queryset.none()

        return queryset

    def destroy(self, request: Request, *args: object, **kwargs: object) -> Response:
        instance = self.get_object()
        try:
            validate_session_can_be_deleted(instance)
            delete_grading_session(instance, actor=cast(User, request.user))
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)
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
        # The sensitive half is enforced by CanOverrideLockedSession on the
        # action itself, which also gives a clearer message.
        "withdraw": ("gradings.change_gradingcandidate",),
    }

    def get_queryset(self) -> QuerySet[GradingCandidate]:
        queryset = (
            GradingCandidate.objects.select_related(
                "session",
                "student",
                "testing_for_rank",
            )
            .all()
            .order_by(
                "session__grading_date",
                "student__last_name",
                "student__first_name",
            )
        )

        session = self.request.query_params.get("session")
        if session and session.isdecimal():
            queryset = queryset.filter(session_id=int(session))
        elif session:
            queryset = queryset.none()

        student_wksa_id = self.request.query_params.get("student_wksa_id")
        if student_wksa_id:
            queryset = queryset.filter(student__wksa_id=student_wksa_id)

        testing_for_rank_code = self.request.query_params.get("testing_for_rank_code")
        if testing_for_rank_code:
            queryset = queryset.filter(testing_for_rank__code=testing_for_rank_code)

        age_band = self.request.query_params.get("age_band")
        if age_band in AgeBand.values:
            queryset = queryset.filter(age_band=age_band)
        elif age_band:
            queryset = queryset.none()

        status_filter = self.request.query_params.get("status")
        if status_filter in GradingCandidate.Status.values:
            queryset = queryset.filter(status=status_filter)
        elif status_filter:
            queryset = queryset.none()

        return queryset

    def destroy(self, request: Request, *args: object, **kwargs: object) -> Response:
        instance = self.get_object()
        try:
            validate_candidate_can_be_deleted(instance)
            delete_candidate(instance, actor=cast(User, request.user))
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="generate-assessment")
    def generate_assessment(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        candidate = self.get_object()
        try:
            assessment = generate_candidate_assessment(
                candidate, cast(User, request.user)
            )
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)
        serializer = CandidateAssessmentSerializer(
            assessment,
            context={"request": request},
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

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

    @action(detail=True, methods=["post"], url_path="create-outcome")
    def create_outcome(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        candidate = self.get_object()
        try:
            outcome = create_candidate_outcome(candidate, cast(User, request.user))
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)
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
    http_method_names = ["get", "patch", "head", "options"]
    permission_map = {
        "list": ("gradings.view_candidateassessment",),
        "retrieve": ("gradings.view_candidateassessment",),
        "partial_update": ("gradings.change_candidateassessment",),
    }

    def get_queryset(self) -> QuerySet[CandidateAssessment]:
        queryset = (
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

        candidate = self.request.query_params.get("candidate")
        if candidate and candidate.isdecimal():
            queryset = queryset.filter(candidate_id=int(candidate))
        elif candidate:
            queryset = queryset.none()

        session = self.request.query_params.get("session")
        if session and session.isdecimal():
            queryset = queryset.filter(candidate__session_id=int(session))
        elif session:
            queryset = queryset.none()

        student_wksa_id = self.request.query_params.get("student_wksa_id")
        if student_wksa_id:
            queryset = queryset.filter(candidate__student__wksa_id=student_wksa_id)

        testing_for_rank_code = self.request.query_params.get("testing_for_rank_code")
        if testing_for_rank_code:
            queryset = queryset.filter(
                candidate__testing_for_rank__code=testing_for_rank_code,
            )

        status_filter = self.request.query_params.get("status")
        if status_filter in CandidateAssessment.Status.values:
            queryset = queryset.filter(status=status_filter)
        elif status_filter:
            queryset = queryset.none()

        return queryset


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

    def get_queryset(self) -> QuerySet[CandidateAssessmentItem]:
        queryset = (
            CandidateAssessmentItem.objects.select_related(
                "assessment__candidate__session",
                "assessment__candidate__student",
                "assessment__candidate__testing_for_rank",
                "source_requirement",
                "source_item",
                "source_rank",
                "assessor",
            )
            .all()
            .order_by("requirement_sequence", "item_name", "pk")
        )

        assessment = self.request.query_params.get("assessment")
        if assessment and assessment.isdecimal():
            queryset = queryset.filter(assessment_id=int(assessment))
        elif assessment:
            queryset = queryset.none()

        candidate = self.request.query_params.get("candidate")
        if candidate and candidate.isdecimal():
            queryset = queryset.filter(assessment__candidate_id=int(candidate))
        elif candidate:
            queryset = queryset.none()

        session = self.request.query_params.get("session")
        if session and session.isdecimal():
            queryset = queryset.filter(assessment__candidate__session_id=int(session))
        elif session:
            queryset = queryset.none()

        item_code = self.request.query_params.get("item_code")
        if item_code:
            queryset = queryset.filter(item_code=item_code)

        category = self.request.query_params.get("category")
        if category in SyllabusItem.Category.values:
            queryset = queryset.filter(category=category)
        elif category:
            queryset = queryset.none()

        result = self.request.query_params.get("result")
        if result in CandidateAssessmentItem.Result.values:
            queryset = queryset.filter(result=result)
        elif result:
            queryset = queryset.none()

        required = self.request.query_params.get("required")
        if required in {"true", "1", "yes"}:
            queryset = queryset.filter(required=True)
        elif required in {"false", "0", "no"}:
            queryset = queryset.filter(required=False)
        elif required:
            queryset = queryset.none()

        return queryset


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
    }

    def get_queryset(self) -> QuerySet[CandidateOutcome]:
        queryset = (
            CandidateOutcome.objects.select_related(
                "candidate__session",
                "candidate__student",
                "candidate__testing_for_rank",
                "assessment",
                "proposed_by",
                "decided_by",
            )
            .all()
            .order_by(
                "candidate__session__grading_date",
                "candidate__student__last_name",
                "candidate__student__first_name",
            )
        )

        session = self.request.query_params.get("session")
        if session and session.isdecimal():
            queryset = queryset.filter(candidate__session_id=int(session))
        elif session:
            queryset = queryset.none()

        candidate = self.request.query_params.get("candidate")
        if candidate and candidate.isdecimal():
            queryset = queryset.filter(candidate_id=int(candidate))
        elif candidate:
            queryset = queryset.none()

        student_wksa_id = self.request.query_params.get("student_wksa_id")
        if student_wksa_id:
            queryset = queryset.filter(candidate__student__wksa_id=student_wksa_id)

        testing_for_rank_code = self.request.query_params.get("testing_for_rank_code")
        if testing_for_rank_code:
            queryset = queryset.filter(
                candidate__testing_for_rank__code=testing_for_rank_code,
            )

        status_filter = self.request.query_params.get("status")
        if status_filter in CandidateOutcome.Status.values:
            queryset = queryset.filter(status=status_filter)
        elif status_filter:
            queryset = queryset.none()

        proposed_outcome = self.request.query_params.get("proposed_outcome")
        if proposed_outcome in CandidateOutcome.Outcome.values:
            queryset = queryset.filter(proposed_outcome=proposed_outcome)
        elif proposed_outcome:
            queryset = queryset.none()

        final_outcome = self.request.query_params.get("final_outcome")
        if final_outcome in CandidateOutcome.Outcome.values:
            queryset = queryset.filter(final_outcome=final_outcome)
        elif final_outcome:
            queryset = queryset.none()

        proposed_by = self.request.query_params.get("proposed_by")
        if proposed_by:
            try:
                queryset = queryset.filter(proposed_by_id=uuid.UUID(proposed_by))
            except ValueError:
                queryset = queryset.none()

        decided_by = self.request.query_params.get("decided_by")
        if decided_by:
            try:
                queryset = queryset.filter(decided_by_id=uuid.UUID(decided_by))
            except ValueError:
                queryset = queryset.none()

        return queryset

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

    @action(detail=True, methods=["get"])
    def summary(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        outcome = self.get_object()
        return Response(candidate_assessment_summary(outcome.assessment))

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


class PromotionViewSet(ReadOnlyModelViewSet):
    serializer_class = PromotionSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("gradings.view_promotion",),
        "retrieve": ("gradings.view_promotion",),
    }

    def get_queryset(self) -> QuerySet[Promotion]:
        queryset = (
            Promotion.objects.select_related(
                "student__current_rank",
                "outcome",
                "grading_candidate__session",
                "from_rank",
                "to_rank",
                "promoted_by",
            )
            .all()
            .order_by("-effective_date", "-promoted_at", "-pk")
        )

        student = self.request.query_params.get("student")
        if student and student.isdecimal():
            queryset = queryset.filter(student_id=int(student))
        elif student:
            queryset = queryset.none()

        student_wksa_id = self.request.query_params.get("student_wksa_id")
        if student_wksa_id:
            queryset = queryset.filter(student__wksa_id=student_wksa_id)

        from_rank_code = self.request.query_params.get("from_rank_code")
        if from_rank_code:
            queryset = queryset.filter(from_rank__code=from_rank_code)

        to_rank_code = self.request.query_params.get("to_rank_code")
        if to_rank_code:
            queryset = queryset.filter(to_rank__code=to_rank_code)

        session = self.request.query_params.get("session")
        if session and session.isdecimal():
            queryset = queryset.filter(grading_candidate__session_id=int(session))
        elif session:
            queryset = queryset.none()

        effective_date_value = self.request.query_params.get("effective_date")
        effective_date = parse_date_filter(effective_date_value)
        if effective_date:
            queryset = queryset.filter(effective_date=effective_date)
        elif effective_date_value:
            return queryset.none()

        effective_date_from_value = self.request.query_params.get(
            "effective_date_from",
        )
        effective_date_from = parse_date_filter(effective_date_from_value)
        if effective_date_from:
            queryset = queryset.filter(effective_date__gte=effective_date_from)
        elif effective_date_from_value:
            return queryset.none()

        effective_date_to_value = self.request.query_params.get("effective_date_to")
        effective_date_to = parse_date_filter(effective_date_to_value)
        if effective_date_to:
            queryset = queryset.filter(effective_date__lte=effective_date_to)
        elif effective_date_to_value:
            return queryset.none()

        if (
            effective_date_from is not None
            and effective_date_to is not None
            and effective_date_from > effective_date_to
        ):
            return queryset.none()

        promoted_by = self.request.query_params.get("promoted_by")
        if promoted_by:
            try:
                queryset = queryset.filter(promoted_by_id=uuid.UUID(promoted_by))
            except ValueError:
                queryset = queryset.none()

        return queryset
