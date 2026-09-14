from __future__ import annotations

from django.db.models import QuerySet
from rest_framework.viewsets import ReadOnlyModelViewSet

from accounts.permissions import HasRequiredPermissions
from syllabus.models import AgeBand, SyllabusItem, SyllabusRequirement
from syllabus.serializers import (
    SyllabusItemSerializer,
    SyllabusRequirementSerializer,
)


class SyllabusItemViewSet(ReadOnlyModelViewSet):
    queryset = SyllabusItem.objects.filter(active=True).order_by(
        "category",
        "name",
        "code",
    )
    serializer_class = SyllabusItemSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("syllabus.view_syllabusitem",),
        "retrieve": ("syllabus.view_syllabusitem",),
    }


class SyllabusRequirementViewSet(ReadOnlyModelViewSet):
    serializer_class = SyllabusRequirementSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "list": ("syllabus.view_syllabusrequirement",),
        "retrieve": ("syllabus.view_syllabusrequirement",),
    }

    def get_queryset(self) -> QuerySet[SyllabusRequirement]:
        queryset = (
            SyllabusRequirement.objects.filter(active=True, item__active=True)
            .select_related("rank", "item")
            .order_by("rank__order", "age_band", "sequence", "item__name")
        )

        rank_code = self.request.query_params.get("rank_code")
        if rank_code:
            queryset = queryset.filter(rank__code=rank_code)

        age_band = self.request.query_params.get("age_band")
        if age_band in AgeBand.values:
            queryset = queryset.filter(age_band=age_band)
        elif age_band:
            queryset = queryset.none()

        return queryset
