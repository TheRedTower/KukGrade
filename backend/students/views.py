from __future__ import annotations

from datetime import date
from typing import Any, cast

from django.contrib.postgres.aggregates import StringAgg
from django.db.models import OuterRef, Q, QuerySet, Subquery, TextField
from django.utils import timezone
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from accounts.models import User
from accounts.permissions import HasRequiredPermissions
from gradings.age import with_age_band_on
from gradings.models import GradingCandidate, GradingSession
from gradings.read_models import (
    student_rank_timeline,
    unified_student_grading_history,
    with_current_grading,
)
from gradings.services import ranks_open_for_grading, unsettled_registrations
from kukgrade.filtering import (
    QueryFilter,
    by_id,
    choices_in,
    exact,
)
from kukgrade.search import ExactOnly, full_name_of, label_of, search, squashed
from students.models import PreviousWksaId, Student
from students.serializers import (
    StudentGradingHistorySerializer,
    StudentListSerializer,
    StudentRankHistorySerializer,
    StudentSerializer,
)
from students.services import delete_student
from syllabus.models import AgeBand


def _in_age_band(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
    # The list is annotated with each student's band on the list's date
    # (StudentViewSet.get_queryset), so the filter and the rows agree.
    if value not in AgeBand.values:
        return queryset.none()
    return queryset.filter(age_band_on_date=value)


def _eligible_for_session(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
    if not value.isdecimal():
        return queryset.none()
    registered = GradingCandidate.objects.filter(session_id=int(value)).values(
        "student"
    )
    # One grading at a time: a student still registered for another grading
    # that has not reached its result cannot be registered here.
    registered_elsewhere = unsettled_registrations().values("student")
    # A grading is per age band, so a student is open when their band on the
    # grading date has a syllabus for the rank they would test for.
    open_for_their_band = Q()
    for band in AgeBand.values:
        open_for_their_band |= Q(
            age_band_on_date=band,
            current_rank__in=ranks_open_for_grading(band),
        )
    return (
        queryset.exclude(status=Student.Status.LEFT)
        .exclude(pk__in=registered)
        .exclude(pk__in=registered_elsewhere)
        .filter(open_for_their_band)
    )


_AGE_BAND = QueryFilter(
    "age_band",
    _in_age_band,
    {"type": "string", "enum": sorted(AgeBand.values)},
    "The student's age band - on the session's grading date when "
    "eligible_for_session is given, as registration works it out, "
    "otherwise today.",
)
_ELIGIBLE_FOR_SESSION = QueryFilter(
    "eligible_for_session",
    _eligible_for_session,
    {"type": "integer"},
    "Students who could still be registered for this grading session: "
    "not Left, not already one of its candidates, not registered for "
    "another grading that has not reached its result, and at a rank whose "
    "next rank has a syllabus recorded for the student's age band on the "
    "grading date.",
)


def _previous_ids() -> Subquery:
    """Every ID the student held before, as one piece of text."""
    return Subquery(
        PreviousWksaId.objects.filter(student=OuterRef("pk"))
        .values("student")
        .annotate(ids=StringAgg("wksa_id", " "))
        .values("ids"),
        output_field=TextField(),
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
    # before that binding is used. DELETE is the administrator-only
    # delete (students.services.delete_student), which keeps a student with
    # history and erases only one with none - see
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
        by_id(
            "source_import",
            "source_import",
            "Only the students one import added.",
        ),
        search(
            "search",
            (
                "first_name",
                "last_name",
                full_name_of(),
                "wksa_id",
                # The ID without its hyphens, and any ID the student held before.
                squashed("wksa_id"),
                _previous_ids(),
                squashed(_previous_ids()),
                ExactOnly("current_rank__name"),
                ExactOnly(label_of("status", Student.Status.choices)),
            ),
            "A student's name, ID (current or previous, with or without hyphens), "
            "rank or status.",
        ),
    )

    _READABLE_ONCE_DELETED = frozenset({"retrieve", "rank_history", "grading_history"})

    def get_queryset(self) -> QuerySet[Student]:
        students = Student.objects.select_related("current_rank").order_by(
            "last_name",
            "first_name",
            "wksa_id",
        )
        if self.action not in self._READABLE_ONCE_DELETED:
            # A deleted student is gone from the lists and closed to
            # changes; only their page and history stay readable, so a past
            # grading can still show who it was.
            students = students.filter(deleted_at__isnull=True)
        if self.action == "list":
            return with_current_grading(
                with_age_band_on(students, self._age_band_date()),
            )
        return students.prefetch_related("previous_wksa_ids", "extra_information")

    def _age_band_date(self) -> date:
        """The date a list's age bands are worked out on.

        Registering for a session bands a student by their age on its
        grading date (gradings.age.resolve_age_band), so a list of who could
        be registered for one says the same - near a birthday, today's band
        and the grading's differ (audit F-33).
        """
        session_id = self.request.query_params.get("eligible_for_session", "")
        if session_id.isdecimal():
            grading_date = (
                GradingSession.objects.filter(pk=int(session_id))
                .values_list("grading_date", flat=True)
                .first()
            )
            if grading_date is not None:
                return grading_date
        return timezone.localdate()

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
