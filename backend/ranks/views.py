from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ReadOnlyModelViewSet

from ranks.models import Rank
from ranks.serializers import RankSerializer


class RankViewSet(ReadOnlyModelViewSet):
    queryset = Rank.objects.filter(active=True).order_by("order")
    serializer_class = RankSerializer
    permission_classes = [IsAuthenticated]
