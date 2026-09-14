from __future__ import annotations

import uuid
from datetime import date

from django.db.models import QuerySet
from rest_framework.viewsets import ReadOnlyModelViewSet

from accounts.permissions import HasRequiredPermissions
from audit.models import AuditAction, AuditEvent
from audit.serializers import AuditEventSerializer


def parse_date_filter(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


class AuditEventViewSet(ReadOnlyModelViewSet):
    """Read-only by construction: the model refuses writes from every path."""

    serializer_class = AuditEventSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("audit.view_auditevent",),
        "retrieve": ("audit.view_auditevent",),
    }

    def get_queryset(self) -> QuerySet[AuditEvent]:
        queryset = AuditEvent.objects.select_related("actor").order_by(
            "-occurred_at",
            "-pk",
        )

        action = self.request.query_params.get("action")
        if action in AuditAction.values:
            queryset = queryset.filter(action=action)
        elif action:
            return queryset.none()

        entity_type = self.request.query_params.get("entity_type")
        if entity_type:
            queryset = queryset.filter(entity_type=entity_type)

        entity_id = self.request.query_params.get("entity_id")
        if entity_id:
            queryset = queryset.filter(entity_id=entity_id)

        actor = self.request.query_params.get("actor")
        if actor:
            try:
                queryset = queryset.filter(actor_id=uuid.UUID(actor))
            except ValueError:
                return queryset.none()

        occurred_from_value = self.request.query_params.get("occurred_from")
        occurred_from = parse_date_filter(occurred_from_value)
        if occurred_from:
            queryset = queryset.filter(occurred_at__date__gte=occurred_from)
        elif occurred_from_value:
            return queryset.none()

        occurred_to_value = self.request.query_params.get("occurred_to")
        occurred_to = parse_date_filter(occurred_to_value)
        if occurred_to:
            queryset = queryset.filter(occurred_at__date__lte=occurred_to)
        elif occurred_to_value:
            return queryset.none()

        return queryset
