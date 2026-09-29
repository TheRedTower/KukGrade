from __future__ import annotations

from rest_framework import mixins
from rest_framework.viewsets import GenericViewSet

from accounts.permissions import HasRequiredPermissions
from ranks.models import Rank
from ranks.serializers import RankSerializer


class RankViewSet(mixins.ListModelMixin, GenericViewSet):
    queryset = (
        Rank.objects.filter(active=True).with_next_active_rank().order_by("order")
    )
    serializer_class = RankSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("ranks.view_rank",),
    }
