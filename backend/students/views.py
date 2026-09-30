from __future__ import annotations

from typing import Any, cast

from django.db.models import QuerySet
from django.utils import timezone
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from accounts.models import User
from accounts.permissions import HasRequiredPermissions
from gradings.age import students_in_age_band
from gradings.models import GradingCandidate
from gradings.read_models import student_rank_timeline, unified_student_grading_history
from kukgrade.filtering import (
    QueryFilter,
    by_id,
    choices_in,
    exact,
    search,
)
from students.models import Student
from students.serializers import (
    StudentGradingHistorySerializer,
    StudentListSerializer,
    StudentRankHistorySerializer,
    StudentSerializer,
)
from students.services import delete_student
from syllabus.models import AgeBand


def _in_age_band(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
    if value not in AgeBand.values:
        return queryset.none()
    return students_in_age_band(queryset, value, timezone.localdate())


def _eligible_for_session(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
    if not value.isdecimal():
        return queryset.none()
    registered = GradingCandidate.objects.filter(session_id=int(value)).values(
        "student"
    )
    return queryset.exclude(status=Student.Status.LEFT).exclude(pk__in=registered)


_AGE_BAND = QueryFilter(
    "age_band",
    _in_age_band,
    {"type": "string", "enum": sorted(AgeBand.values)},
    "The age band the student is in today.",
)
_ELIGIBLE_FOR_SESSION = QueryFilter(
    "eligible_for_session",
    _eligible_for_session,
    {"type": "integer"},
    "Students who could still be registered for this grading session: "
    "not Left and not already one of its candidates.",
)


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

    query_filters = (
        choices_in("status", "status", Student.Status.values),
        exact("current_rank_code", "current_rank__code"),
        by_id("current_rank", "current_rank_id"),
        _AGE_BAND,
        _ELIGIBLE_FOR_SESSION,
        search("search", ("first_name", "last_name", "wksa_id")),
    )

    def get_queryset(self) -> QuerySet[Student]:
        return Student.objects.select_related("current_rank").order_by(
            "last_name",
            "first_name",
            "wksa_id",
        )

    def destroy(self, request: Request, *args: object, **kwargs: object) -> Response:
        instance = self.get_object()
        delete_student(instance, cast(User, request.user))
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
