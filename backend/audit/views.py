from __future__ import annotations

from typing import cast

from django.db.models import QuerySet
from rest_framework import mixins
from rest_framework.viewsets import GenericViewSet

from accounts.models import User
from accounts.permissions import CanViewAuditLog, HasRequiredPermissions
from audit.models import AuditAction, AuditEntity, AuditEvent
from audit.serializers import AuditEventSerializer
from kukgrade.filtering import by_uuid, choice, exact, on_date, search


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
    }

    query_filters = (
        choice("action", "action", AuditAction.values),
        choice("entity_type", "entity_type", AuditEntity.values),
        exact("entity_id", "entity_id"),
        by_uuid("actor", "actor_id"),
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
            AuditEvent.objects.visible_to(cast(User, self.request.user))
            .select_related("actor")
            .order_by("-occurred_at", "-pk")
        )
