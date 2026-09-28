from __future__ import annotations

from django.db.models import Case, IntegerField, QuerySet, Value, When
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet

from accounts.permissions import HasRequiredPermissions
from kukgrade.filtering import choice, exact
from ranks.models import Rank
from syllabus.models import AgeBand, SyllabusItem, SyllabusRequirement
from syllabus.serializers import (
    EffectiveSyllabusRequirementSerializer,
    SyllabusItemSerializer,
    SyllabusRequirementSerializer,
)
from syllabus.services import (
    EffectiveSyllabusRequirement,
    effective_syllabus_requirements,
)

# Alphabetical category order (BREAKING before ETIQUETTE) does not match the
# WKSA chart's own header sequence - Etiquette, Fundamentals, Hand
# techniques, Kicking, Falling, Breaking, then Techniques and Forms. This
# annotation sorts by that declared `Category.values` order instead, so
# FDR-041's core-grading-areas strip can rely on the API's own ordering
# rather than a frontend-owned sequence.
_CATEGORY_DISPLAY_ORDER = Case(
    *[
        When(category=code, then=Value(index))
        for index, code in enumerate(SyllabusItem.Category.values)
    ],
    output_field=IntegerField(),
)


class SyllabusItemViewSet(ReadOnlyModelViewSet):
    queryset = (
        SyllabusItem.objects.filter(active=True)
        .annotate(_category_order=_CATEGORY_DISPLAY_ORDER)
        .order_by("_category_order", "name", "code")
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
        "effective": ("syllabus.view_syllabusrequirement",),
    }

    query_filters = (
        exact("rank_code", "rank__code"),
        choice("age_band", "age_band", AgeBand.values),
    )

    def get_queryset(self) -> QuerySet[SyllabusRequirement]:
        return (
            SyllabusRequirement.objects.filter(active=True, item__active=True)
            .select_related("rank", "item")
            .order_by("rank__order", "age_band", "sequence", "item__name")
        )

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
        """Cumulative Technique/Form requirements examinable through a rank.

        FDR-041 / SCR-025: the plain list above only ever returns rows
        attached directly to one rank, which cannot express that a later
        rank's mapping for the same item extends or restates an earlier
        one. This mode does - see `syllabus.services.
        effective_syllabus_requirements` for the accumulation policy.
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
