from __future__ import annotations

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from syllabus.models import (
    AGE_BAND_DESCRIPTION,
    AGE_BAND_PROGRAMME,
    AgeBand,
    Programme,
)
from syllabus.services import EffectiveSyllabusRequirement, normalize_chart_notation


class EffectiveSyllabusRequirementSerializer(serializers.Serializer):
    """One cumulative row for a selected rank and age band, in syllabus order.

    Wraps `syllabus.services.EffectiveSyllabusRequirement`: `requirement` is
    the effective (latest applicable) `SyllabusRequirement` row, so most
    fields are simple dotted lookups into it. `introduced_rank`,
    `effective_since_rank` and `is_new_at_rank` are the provenance FDR-041
    requires the backend to derive.
    """

    item_code = serializers.CharField(source="requirement.item.code", read_only=True)
    item_name = serializers.CharField(source="requirement.item.name", read_only=True)
    item_korean_name = serializers.CharField(
        source="requirement.item.korean_name",
        read_only=True,
    )
    category = serializers.CharField(source="requirement.item.category", read_only=True)
    category_display = serializers.CharField(
        source="requirement.item.get_category_display",
        read_only=True,
    )
    # "required" collides with Field.required (whether the input itself is
    # mandatory) only in the type stubs, not at runtime - DRF serializers
    # commonly have a field named this for exactly this reason.
    required = serializers.BooleanField(  # type: ignore[assignment]
        source="requirement.required",
        read_only=True,
    )
    display_range = serializers.CharField(
        source="requirement.display_range", read_only=True
    )
    notation = serializers.SerializerMethodField()
    notes = serializers.CharField(source="requirement.notes", read_only=True)
    introduced_rank_code = serializers.CharField(
        source="introduced_rank.code",
        read_only=True,
    )
    introduced_rank_name = serializers.CharField(
        source="introduced_rank.name",
        read_only=True,
    )
    effective_since_rank_code = serializers.CharField(
        source="effective_since_rank.code",
        read_only=True,
    )
    effective_since_rank_name = serializers.CharField(
        source="effective_since_rank.name",
        read_only=True,
    )
    is_new_at_rank = serializers.BooleanField(read_only=True)

    def get_notation(self, obj: EffectiveSyllabusRequirement) -> str:
        return normalize_chart_notation(obj.requirement.notes)


class AgeBandSerializer(serializers.Serializer[str]):
    """One age band, from its code: label, description and programme."""

    code = serializers.ChoiceField(choices=AgeBand.choices, source="*", read_only=True)
    name = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    programme = serializers.SerializerMethodField()
    programme_display = serializers.SerializerMethodField()

    def get_name(self, code: str) -> str:
        return AgeBand(code).label

    def get_description(self, code: str) -> str:
        return AGE_BAND_DESCRIPTION[code]

    @extend_schema_field(serializers.ChoiceField(choices=Programme.choices))
    def get_programme(self, code: str) -> str:
        return AGE_BAND_PROGRAMME[code].value

    def get_programme_display(self, code: str) -> str:
        return AGE_BAND_PROGRAMME[code].label
