from __future__ import annotations

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from ranks.models import Rank
from syllabus.models import (
    AGE_BAND_PROGRAMME,
    CORE_CATEGORIES,
    AgeBand,
    Programme,
    age_band_description,
)
from syllabus.services import EffectiveSyllabusRequirement


class EffectiveSyllabusRequirementSerializer(serializers.Serializer):
    """One cumulative row for a selected rank and age band, in syllabus order.

    Wraps `syllabus.services.EffectiveSyllabusRequirement`: `requirement` is
    the effective (latest applicable) `SyllabusRequirement` row, so most
    fields are simple dotted lookups into it. `introduced_rank`,
    `effective_since_rank` and `is_new_at_rank` are the provenance the
    backend derives.
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
    category_is_core = serializers.SerializerMethodField(
        help_text=(
            "Whether the category is one of the six core grading areas every "
            "rank shares, rather than rank-specific content."
        ),
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
    notation = serializers.CharField(read_only=True)
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

    def get_category_is_core(self, obj: EffectiveSyllabusRequirement) -> bool:
        return obj.requirement.item.category in CORE_CATEGORIES


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
        return age_band_description(code)

    @extend_schema_field(serializers.ChoiceField(choices=Programme.choices))
    def get_programme(self, code: str) -> str:
        return AGE_BAND_PROGRAMME[code].value

    def get_programme_display(self, code: str) -> str:
        return AGE_BAND_PROGRAMME[code].label


class EffectiveSyllabusQuerySerializer(serializers.Serializer):
    """GET requirements/effective/: the rank and age band asked about."""

    rank_code = serializers.CharField(
        error_messages={
            "required": "rank_code is required.",
            "blank": "rank_code is required.",
        },
    )
    age_band = serializers.ChoiceField(
        choices=AgeBand.choices,
        error_messages={
            "required": "Choose an age group.",
            "blank": "Choose an age group.",
            "invalid_choice": "Choose an age group.",
        },
    )

    def validate_rank_code(self, code: str) -> Rank:
        rank = Rank.objects.filter(code=code, active=True).first()
        if rank is None:
            raise serializers.ValidationError("No active rank matches this code.")
        return rank
