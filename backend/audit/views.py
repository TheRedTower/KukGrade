from __future__ import annotations

import uuid
from typing import cast

from django.db.models import Q, QuerySet
from rest_framework.viewsets import ReadOnlyModelViewSet

from accounts.models import User
from accounts.permissions import CanViewAuditLog, HasRequiredPermissions
from audit.models import USER_MANAGEMENT_ACTIONS, AuditAction, AuditEvent
from audit.serializers import AuditEventSerializer
from kukgrade.filtering import parse_date_filter


class AuditEventViewSet(ReadOnlyModelViewSet):
    """Read-only by construction: the model refuses writes from every path."""

    serializer_class = AuditEventSerializer
    # Gated by CanViewAuditLog (administrator or Master authority), not a
    # Django permission: no group carries a view_auditevent grant, since
    # that would need to reach a Master instructor without also reaching
    # every other instructor. permission_map is authenticated-is-enough so
    # HasRequiredPermissions still answers a wrong-method request with 405
    # rather than a misleading 403.
    permission_classes = [HasRequiredPermissions, CanViewAuditLog]
    permission_map = {
        "list": (),
        "retrieve": (),
    }

    def get_queryset(self) -> QuerySet[AuditEvent]:
        queryset = AuditEvent.objects.select_related("actor").order_by(
            "-occurred_at",
            "-pk",
        )

        # Logistics is an administrator concern, the same boundary the
        # Users API itself draws - excluded here rather than in
        # permission_map, since it depends on the row's own action, not the
        # request method. A direct retrieve of an excluded id 404s, same as
        # any other object outside the caller's queryset.
        if not cast(User, self.request.user).has_perm("accounts.view_user"):
            queryset = queryset.exclude(action__in=USER_MANAGEMENT_ACTIONS)

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

        search = self.request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(summary__icontains=search)
                | Q(entity_type__icontains=search)
                | Q(entity_id__icontains=search)
                | Q(actor__email__icontains=search)
                | Q(actor__first_name__icontains=search)
                | Q(actor__last_name__icontains=search)
            )

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
