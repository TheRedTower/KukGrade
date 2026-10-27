from __future__ import annotations

from django.db.models import Exists, OuterRef
from rest_framework import mixins
from rest_framework.viewsets import GenericViewSet

from accounts.permissions import HasRequiredPermissions
from ranks.models import Rank
from ranks.serializers import RankSerializer
from syllabus.models import SyllabusRequirement


class RankViewSet(mixins.ListModelMixin, GenericViewSet):
    # A rank has a recorded syllabus while it is at or below the highest rank
    # that has any requirement; the ranks above are served but flagged, so the
    # syllabus screen can leave them out until their content is recorded.
    queryset = (
        Rank.objects.filter(active=True)
        .with_next_active_rank()
        .annotate(
            has_syllabus=Exists(
                SyllabusRequirement.objects.filter(
                    active=True,
                    item__active=True,
                    rank__order__gte=OuterRef("order"),
                ),
            ),
        )
        .order_by("order")
    )
    serializer_class = RankSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("ranks.view_rank",),
    }
