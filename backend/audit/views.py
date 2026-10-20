from __future__ import annotations

from typing import cast

from django.db.models import QuerySet
from drf_spectacular.utils import extend_schema
from rest_framework import mixins
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from accounts.models import User
from accounts.permissions import CanViewAuditLog, HasRequiredPermissions
from audit.models import AuditAction, AuditEntity, AuditEvent, hidden_actions
from audit.serializers import AuditEventSerializer, AuditLabelsSerializer
from kukgrade.filtering import choice, exact, on_date, search


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
        search(
            "search",
            ("summary", "entity_type", "entity_id", "actor_email", "actor_name"),
        ),
    )

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
