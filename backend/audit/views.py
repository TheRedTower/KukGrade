from __future__ import annotations

from typing import Any, cast

from django.apps import apps
from django.db.models import (
    Case,
    IntegerField,
    OuterRef,
    QuerySet,
    Subquery,
    TextField,
    When,
)
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Cast
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from accounts.models import User
from accounts.permissions import CanViewAuditLog, HasRequiredPermissions
from audit.models import AuditAction, AuditEntity, AuditEvent, hidden_actions
from audit.serializers import (
    AuditEventSerializer,
    AuditLabelsSerializer,
    AuditSubjectSerializer,
    student_id_of,
)
from audit.subjects import describe, events_of
from kukgrade.filtering import QueryFilter, choice, exact, on_date
from kukgrade.search import ExactOnly, apply_search, full_name_of, label_of
from kukgrade.viewsets import KukGradeViewSet


def _students() -> Any:
    # Looked up by name so the log keeps no import of the apps it records.
    return apps.get_model("students", "Student")


def _student_name_of_event() -> Subquery:
    """The current name of the student an event is about, for the search to read.

    Events hold no names, so the search looks the student up by the id the event
    carries: its own, for a student's event, or the one in its details.
    """
    return Subquery(
        _students()
        .objects.filter(pk=OuterRef("_subject_student"))
        .annotate(name=full_name_of())
        .values("name")[:1],
        output_field=TextField(),
    )


def _apply_search(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
    subject = Case(
        When(
            entity_type=AuditEntity.STUDENT,
            entity_id__regex=r"^[0-9]+$",
            then=Cast("entity_id", IntegerField()),
        ),
        default=Cast(KeyTextTransform("student_id", "metadata"), IntegerField()),
        output_field=IntegerField(),
    )
    return apply_search(
        queryset.annotate(_subject_student=subject),
        value,
        (
            ExactOnly("summary"),
            ExactOnly("entity_id"),
            "actor_email",
            "actor_name",
            ExactOnly(label_of("action", AuditAction.choices)),
            ExactOnly(label_of("entity_type", AuditEntity.choices)),
            _student_name_of_event(),
        ),
    )


class AuditEventViewSet(mixins.ListModelMixin, KukGradeViewSet[AuditEvent]):
    """Read-only by construction: the model refuses writes from every path."""

    serializer_class = AuditEventSerializer
    # Gated by CanViewAuditLog (accounts.permissions.can_view_audit_log):
    # audit.view_auditevent (Administrator group) or either per-user
    # authority that reads the log.
    # permission_map is authenticated-is-enough so HasRequiredPermissions
    # still answers a wrong-method request with 405 rather than a misleading
    # 403.
    permission_classes = [HasRequiredPermissions, CanViewAuditLog]
    permission_map = {
        "list": (),
        "labels": (),
        "subject": (),
    }

    query_filters = (
        choice("action", "action", AuditAction.values),
        choice("entity_type", "entity_type", AuditEntity.values),
        exact("entity_id", "entity_id"),
        on_date("occurred_from", "occurred_at__date__gte"),
        on_date("occurred_to", "occurred_at__date__lte"),
        QueryFilter(
            "subject",
            events_of,
            description=(
                "The history of one record and everything that belongs to it: "
                "`session:ID`, `student:ID`, `candidate:ID` or `user:ID`."
            ),
        ),
        QueryFilter(
            "search",
            _apply_search,
            description=(
                "Every word, in the summary, record number, actor, the kind of event "
                "or record, or the current name of the student the event is about "
                "(read now: events hold no names)."
            ),
        ),
    )

    def paginate_queryset(self, queryset: QuerySet[Any]) -> list[Any] | None:
        page = super().paginate_queryset(queryset)
        # The page's students are read once, so a name costs one query however
        # many events there are.
        events = page if page is not None else []
        ids = {i for i in map(student_id_of, events) if i is not None}
        self._student_names = {
            student.pk: student.full_name
            for student in _students().objects.filter(pk__in=ids)
        }
        return page

    def get_serializer_context(self) -> dict[str, Any]:
        return {
            **super().get_serializer_context(),
            "student_names": getattr(self, "_student_names", {}),
        }

    def get_queryset(self) -> QuerySet[AuditEvent]:
        # User-management events are excluded per row rather than through
        # permission_map, since it depends on the row's own action, not the
        # request method.
        return (
            # No join to actor: the response reads the actor_email/actor_name
            # copies, which outlive the user.
            AuditEvent.objects.visible_to(cast(User, self.request.user)).order_by(
                "-occurred_at", "-pk"
            )
        )

    @extend_schema(
        parameters=[OpenApiParameter("subject", str, required=True)],
        responses=AuditSubjectSerializer,
    )
    @action(detail=False, pagination_class=None, filter_backends=[])
    def subject(self, request: Request) -> Response:
        """What a history is of: the record's current name and where to open it."""
        return Response(
            AuditSubjectSerializer(
                describe(request.query_params.get("subject", "")),
            ).data,
        )

    @extend_schema(responses=AuditLabelsSerializer)
    @action(detail=False, pagination_class=None)
    def labels(self, request: Request) -> Response:
        """The event and record types the caller may filter by, with their
        names - the same events visible_to() lets them read."""
        hidden = hidden_actions(cast(User, request.user))
        return Response(
            AuditLabelsSerializer(
                {
                    "actions": [
                        {"value": value, "label": label}
                        for value, label in AuditAction.choices
                        if value not in hidden
                    ],
                    "entities": [
                        {"value": value, "label": label}
                        for value, label in AuditEntity.choices
                    ],
                },
            ).data,
        )
