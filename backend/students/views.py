from datetime import date

from django.db.models import Q, QuerySet
from django.utils import timezone
from rest_framework import mixins
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from accounts.permissions import HasRequiredPermissions
from gradings.services import student_rank_timeline, unified_student_grading_history
from students.models import Student
from students.serializers import (
    StudentGradingHistorySerializer,
    StudentListSerializer,
    StudentRankHistorySerializer,
    StudentSerializer,
)
from syllabus.models import AgeBand


def _safe_date(year: int, month: int, day: int) -> date:
    try:
        return date(year, month, day)
    except ValueError:
        return date(year, 2, 28)


class StudentViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    GenericViewSet[Student],
):
    # No delete: every relationship to a student is PROTECT, and history is
    # retained by decision. No PUT: partial_update covers every real edit
    # and a full-replace endpoint has no client that needs it. Excluding
    # 'put' and 'delete' here, rather than just omitting DestroyModelMixin,
    # is what actually returns 405 for them - the router still binds them
    # to any mixin method that exists, and http_method_names is what
    # dispatch checks before that binding is used.
    http_method_names = ["get", "post", "patch", "head", "options"]
    permission_classes = [HasRequiredPermissions]
    serializer_class = StudentSerializer
    permission_map = {
        "list": ("students.view_student",),
        "retrieve": ("students.view_student",),
        "create": ("students.add_student",),
        "partial_update": ("students.change_student",),
        "rank_history": ("students.view_student", "gradings.view_promotion"),
        "grading_history": (
            "students.view_student",
            "gradings.view_candidateoutcome",
            "gradings.view_legacygradingrecord",
        ),
    }

    def get_serializer_class(self) -> type:
        if self.action == "list":
            return StudentListSerializer
        if self.action == "rank_history":
            return StudentRankHistorySerializer
        if self.action == "grading_history":
            return StudentGradingHistorySerializer
        return StudentSerializer

    def get_queryset(self) -> QuerySet[Student]:
        queryset = Student.objects.select_related("current_rank").order_by(
            "last_name",
            "first_name",
            "wksa_id",
        )

        status_filter = self.request.query_params.get("status")
        if status_filter in Student.Status.values:
            queryset = queryset.filter(status=status_filter)
        elif status_filter:
            queryset = queryset.none()

        age_band = self.request.query_params.get("age_band")
        if age_band in AgeBand.values:
            today = timezone.localdate()
            if age_band == AgeBand.AGE_8_AND_UNDER:
                cutoff = _safe_date(today.year - 9, today.month, today.day)
                queryset = queryset.filter(date_of_birth__gt=cutoff)
            elif age_band == AgeBand.AGE_9_TO_12:
                lower = _safe_date(today.year - 13, today.month, today.day)
                upper = _safe_date(today.year - 9, today.month, today.day)
                queryset = queryset.filter(
                    date_of_birth__gt=lower, date_of_birth__lte=upper
                )
            elif age_band == AgeBand.AGE_13_TO_17:
                lower = _safe_date(today.year - 18, today.month, today.day)
                upper = _safe_date(today.year - 13, today.month, today.day)
                queryset = queryset.filter(
                    date_of_birth__gt=lower, date_of_birth__lte=upper
                )
            elif age_band == AgeBand.AGE_18_AND_OVER:
                cutoff = _safe_date(today.year - 18, today.month, today.day)
                queryset = queryset.filter(date_of_birth__lte=cutoff)
        elif age_band:
            queryset = queryset.none()

        current_rank_code = self.request.query_params.get("current_rank_code")
        if current_rank_code:
            queryset = queryset.filter(current_rank__code=current_rank_code)

        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(
                Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(wksa_id__icontains=search),
            )

        return queryset

    @action(detail=True, methods=["get"], url_path="rank-history")
    def rank_history(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        student = self.get_object()
        serializer = StudentRankHistorySerializer(student_rank_timeline(student))
        return Response(serializer.data)

    @action(detail=True, methods=["get"], url_path="grading-history")
    def grading_history(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        student = self.get_object()
        serializer = StudentGradingHistorySerializer(
            unified_student_grading_history(student),
        )
        return Response(serializer.data)
