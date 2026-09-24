from __future__ import annotations

from typing import cast

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q, QuerySet
from django.utils import timezone
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from accounts.models import User
from accounts.permissions import HasRequiredPermissions
from gradings.services import (
    age_band_birth_date_bounds,
    student_rank_timeline,
    unified_student_grading_history,
)
from kukgrade.exceptions import raise_drf_validation_error
from kukgrade.filtering import filter_choice, filter_exact
from students.models import Student
from students.serializers import (
    StudentGradingHistorySerializer,
    StudentListSerializer,
    StudentRankHistorySerializer,
    StudentSerializer,
)
from students.services import delete_student
from syllabus.models import AgeBand


class StudentViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    GenericViewSet[Student],
):
    # No PUT: partial_update covers every real edit and a full-replace
    # endpoint has no client that needs it. Excluding 'put' here, rather
    # than just omitting an UpdateModelMixin's put support, is what
    # actually returns 405 for it - the router still binds it to any mixin
    # method that exists, and http_method_names is what dispatch checks
    # before that binding is used. DELETE is the administrator-only hard
    # delete (students.services.delete_student) - see
    # accounts.groups._DATA_CLEANUP_PERMISSIONS.
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    permission_classes = [HasRequiredPermissions]
    serializer_class = StudentSerializer
    permission_map = {
        "list": ("students.view_student",),
        "retrieve": ("students.view_student",),
        "create": ("students.add_student",),
        "partial_update": ("students.change_student",),
        "destroy": ("students.delete_student",),
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

        params = self.request.query_params
        queryset = filter_choice(
            queryset,
            params.get("status"),
            "status",
            Student.Status.values,
        )
        queryset = filter_exact(
            queryset,
            params.get("current_rank_code"),
            "current_rank__code",
        )

        age_band = params.get("age_band")
        if age_band in AgeBand.values:
            born_after, born_on_or_before = age_band_birth_date_bounds(
                age_band,
                timezone.localdate(),
            )
            if born_after is not None:
                queryset = queryset.filter(date_of_birth__gt=born_after)
            if born_on_or_before is not None:
                queryset = queryset.filter(date_of_birth__lte=born_on_or_before)
        elif age_band:
            queryset = queryset.none()

        search = params.get("search")
        if search:
            queryset = queryset.filter(
                Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(wksa_id__icontains=search),
            )

        return queryset

    def destroy(self, request: Request, *args: object, **kwargs: object) -> Response:
        instance = self.get_object()
        try:
            delete_student(instance, cast(User, request.user))
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)

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
