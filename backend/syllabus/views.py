from __future__ import annotations

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from accounts.permissions import HasRequiredPermissions
from ranks.models import Rank
from syllabus.models import AgeBand
from syllabus.serializers import (
    AgeBandSerializer,
    EffectiveSyllabusRequirementSerializer,
)
from syllabus.services import (
    EffectiveSyllabusRequirement,
    effective_syllabus_requirements,
)


class AgeBandViewSet(GenericViewSet):
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


class SyllabusRequirementViewSet(GenericViewSet):
    """Requirements are read only as the cumulative `effective` view."""

    serializer_class = EffectiveSyllabusRequirementSerializer
    permission_classes = [HasRequiredPermissions]
    permission_map = {
        "effective": ("syllabus.view_syllabusrequirement",),
    }

    @extend_schema(
        parameters=[
            OpenApiParameter("rank_code", str, required=True),
            OpenApiParameter(
                "age_band", str, required=True, enum=sorted(AgeBand.values)
            ),
        ],
        responses=EffectiveSyllabusRequirementSerializer(many=True),
    )
    @action(detail=False, methods=["get"])
    def effective(self, request: Request, *args: object, **kwargs: object) -> Response:
        """Everything a grading for this rank and age band assesses, in order.

        The same rows assessment generation snapshots - see `syllabus.
        services.effective_syllabus_requirements` for the accumulation
        policy. Empty when no syllabus is recorded for the rank.
        """
        rank_code = request.query_params.get("rank_code")
        age_band = request.query_params.get("age_band")

        errors: dict[str, list[str]] = {}
        rank: Rank | None = None
        if not rank_code:
            errors["rank_code"] = ["rank_code is required."]
        else:
            rank = Rank.objects.filter(code=rank_code, active=True).first()
            if rank is None:
                errors["rank_code"] = ["No active rank matches this code."]
        if age_band not in AgeBand.values:
            errors["age_band"] = ["A valid age_band is required."]
        if errors:
            raise serializers.ValidationError(errors)

        # No errors means rank_code resolved to a real rank and age_band was
        # one of AgeBand.values, so neither can be None here.
        assert rank is not None
        assert age_band is not None
        effective = effective_syllabus_requirements(rank=rank, age_band=age_band)

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
