from __future__ import annotations

from typing import cast

from django.db.models import Q, QuerySet
from rest_framework.viewsets import ReadOnlyModelViewSet

from accounts.models import User
from accounts.permissions import CanViewAuditLog, HasRequiredPermissions
from audit.models import AuditAction, AuditEvent
from audit.serializers import AuditEventSerializer
from kukgrade.filtering import filter_choice, filter_date, filter_exact, filter_uuid


class AuditEventViewSet(ReadOnlyModelViewSet):
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
        "retrieve": (),
    }

    def get_queryset(self) -> QuerySet[AuditEvent]:
        # User-management events are excluded per row rather than through
        # permission_map, since it depends on the row's own action, not the
        # request method. A direct retrieve of an excluded id 404s, same as
        # any other object outside the caller's queryset.
        queryset = (
            AuditEvent.objects.visible_to(cast(User, self.request.user))
            .select_related("actor")
            .order_by("-occurred_at", "-pk")
        )

        params = self.request.query_params
        queryset = filter_choice(
            queryset,
            params.get("action"),
            "action",
            AuditAction.values,
        )
        queryset = filter_exact(queryset, params.get("entity_type"), "entity_type")
        queryset = filter_exact(queryset, params.get("entity_id"), "entity_id")
        queryset = filter_uuid(queryset, params.get("actor"), "actor_id")
        queryset = filter_date(
            queryset,
            params.get("occurred_from"),
            "occurred_at__date__gte",
        )
        queryset = filter_date(
            queryset,
            params.get("occurred_to"),
            "occurred_at__date__lte",
        )

        search = params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(summary__icontains=search)
                | Q(entity_type__icontains=search)
                | Q(entity_id__icontains=search)
                | Q(actor_email__icontains=search)
                | Q(actor_name__icontains=search)
            )
        return queryset
