from __future__ import annotations

from rest_framework.viewsets import ReadOnlyModelViewSet

from accounts.permissions import HasRequiredPermissions
from ranks.models import Rank
from ranks.serializers import RankSerializer


class RankViewSet(ReadOnlyModelViewSet):
    queryset = Rank.objects.filter(active=True).order_by("order")
    serializer_class = RankSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("ranks.view_rank",),
        "retrieve": ("ranks.view_rank",),
    }
