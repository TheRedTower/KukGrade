from __future__ import annotations

from typing import Any, cast

from django.db.models import Q, QuerySet
from drf_spectacular.utils import extend_schema
from rest_framework import mixins
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from accounts.models import User
from accounts.permissions import CanViewAuditLog, HasRequiredPermissions
from audit.models import AuditAction, AuditEntity, AuditEvent, hidden_actions
from audit.serializers import (
    AuditEventSerializer,
    AuditLabelsSerializer,
    student_id_of,
)
from kukgrade.filtering import QueryFilter, choice, exact, on_date
from students.models import Student

_SEARCHED_FIELDS = ("summary", "entity_type", "entity_id", "actor_email", "actor_name")


def _apply_search(queryset: QuerySet[Any], value: str) -> QuerySet[Any]:
    """Each word must be found in an event's own text or in the current name of
    the student it is about. Names are not in the events, so the students whose
    name has the word are looked up and the events about them matched by id."""
    condition = Q()
    for word in value.split():
        in_event = Q()
        for lookup in _SEARCHED_FIELDS:
            in_event |= Q(**{f"{lookup}__icontains": word})
        ids = list(
            Student.objects.filter(
                Q(first_name__icontains=word) | Q(last_name__icontains=word),
            ).values_list("pk", flat=True)
        )
        if ids:
            in_event |= Q(
                entity_type=AuditEntity.STUDENT,
                entity_id__in=[str(pk) for pk in ids],
            ) | Q(metadata__student_id__in=ids)
        condition &= in_event
    return queryset.filter(condition)


class AuditEventViewSet(mixins.ListModelMixin, GenericViewSet):
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
    }

    query_filters = (
        choice("action", "action", AuditAction.values),
        choice("entity_type", "entity_type", AuditEntity.values),
        exact("entity_id", "entity_id"),
        on_date("occurred_from", "occurred_at__date__gte"),
        on_date("occurred_to", "occurred_at__date__lte"),
        QueryFilter(
            "search",
            _apply_search,
            description=(
                "Every word, in the summary, record, actor or the name of the "
                "student the event is about (read now: events hold no names)."
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
            for student in Student.objects.filter(pk__in=ids)
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
