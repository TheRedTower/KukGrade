from __future__ import annotations

from datetime import date
from typing import cast

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import QuerySet
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from accounts.models import User
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    GradingCandidate,
    GradingSession,
)
from gradings.serializers import (
    CandidateAssessmentItemSerializer,
    CandidateAssessmentSerializer,
    GradingCandidateSerializer,
    GradingSessionSerializer,
    raise_drf_validation_error,
)
from gradings.services import (
    generate_candidate_assessment,
    validate_candidate_can_be_deleted,
    validate_session_can_be_deleted,
)
from syllabus.models import AgeBand, SyllabusItem


def parse_date_filter(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


class GradingSessionViewSet(ModelViewSet):
    serializer_class = GradingSessionSerializer
    permission_classes = [IsAuthenticated]

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
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)
        self.perform_destroy(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)


class GradingCandidateViewSet(ModelViewSet):
    serializer_class = GradingCandidateSerializer
    permission_classes = [IsAuthenticated]

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
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)
        self.perform_destroy(instance)
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


class CandidateAssessmentViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    GenericViewSet,
):
    serializer_class = CandidateAssessmentSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "patch", "head", "options"]

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
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "patch", "head", "options"]

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
