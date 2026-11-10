from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from accounts.permissions import HasRequiredPermissions
from kukgrade.filtering import read_query
from kukgrade.viewsets import KukGradeViewSet
from syllabus.models import AgeBand
from syllabus.serializers import (
    AgeBandSerializer,
    EffectiveSyllabusQuerySerializer,
    EffectiveSyllabusRequirementSerializer,
)
from syllabus.services import (
    EffectiveSyllabusRequirement,
    effective_syllabus_requirements,
)


class AgeBandViewSet(KukGradeViewSet[Any]):
    """The age bands in order, as reference data for every age-band control."""

    serializer_class = AgeBandSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {"list": ("syllabus.view_syllabusrequirement",)}

    def list(self, request: Request) -> Response:
        # Paginated like every list endpoint, as `effective` is below.
        page: list[str] | None = self.paginate_queryset(
            AgeBand.values,  # type: ignore[arg-type]
        )
        return self.get_paginated_response(self.get_serializer(page, many=True).data)


class SyllabusRequirementViewSet(KukGradeViewSet[Any]):
    """Requirements are read only as the cumulative `effective` view."""

    serializer_class = EffectiveSyllabusRequirementSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "effective": ("syllabus.view_syllabusrequirement",),
    }

    @extend_schema(
        parameters=[EffectiveSyllabusQuerySerializer],
        responses=EffectiveSyllabusRequirementSerializer(many=True),
    )
    @action(detail=False, methods=["get"])
    def effective(self, request: Request, *args: object, **kwargs: object) -> Response:
        """Everything a grading for this rank and age band assesses, in order.

        The same rows assessment generation snapshots - see `syllabus.
        services.effective_syllabus_requirements` for the accumulation
        policy. Empty when no syllabus is recorded for the rank.
        """
        asked = read_query(request, EffectiveSyllabusQuerySerializer)
        effective = effective_syllabus_requirements(
            rank=asked["rank_code"],
            age_band=asked["age_band"],
        )

        # Paginated like every other list endpoint (see kukgrade/pagination.py)
        # even though one rank's cumulative content is small - one envelope
        # shape for the whole API, not an exception per endpoint.
        # PageNumberPagination slices whatever sequence it is given; the
        # stub's QuerySet-only signature does not reflect that.
        page: list[EffectiveSyllabusRequirement] | None = self.paginate_queryset(
            effective,  # type: ignore[arg-type]
        )
        serializer = EffectiveSyllabusRequirementSerializer(page, many=True)
        return self.get_paginated_response(serializer.data)
