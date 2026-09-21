from __future__ import annotations

from rest_framework import serializers

from syllabus.models import SyllabusItem, SyllabusRequirement
from syllabus.services import EffectiveSyllabusRequirement, normalize_chart_notation


class SyllabusItemSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(
        source="get_category_display",
        read_only=True,
    )

    class Meta:
        model = SyllabusItem
        fields = (
            "id",
            "code",
            "name",
            "korean_name",
            "category",
            "category_display",
            "description",
            "active",
        )
        read_only_fields = fields


class SyllabusRequirementSerializer(serializers.ModelSerializer):
    rank_code = serializers.CharField(source="rank.code", read_only=True)
    rank_name = serializers.CharField(source="rank.name", read_only=True)
    rank_order = serializers.IntegerField(source="rank.order", read_only=True)
    item_code = serializers.CharField(source="item.code", read_only=True)
    item_name = serializers.CharField(source="item.name", read_only=True)
    item_korean_name = serializers.CharField(source="item.korean_name", read_only=True)
    category = serializers.CharField(source="item.category", read_only=True)
    category_display = serializers.CharField(
        source="item.get_category_display",
        read_only=True,
    )
    display_range = serializers.CharField(read_only=True)

    class Meta:
        model = SyllabusRequirement
        fields = (
            "id",
            "rank",
            "rank_code",
            "rank_name",
            "rank_order",
            "age_band",
            "item",
            "item_code",
            "item_name",
            "item_korean_name",
            "category",
            "category_display",
            "start_number",
            "end_number",
            "display_range",
            "sequence",
            "required",
            "active",
            "notes",
        )
        read_only_fields = fields


class EffectiveSyllabusRequirementSerializer(serializers.Serializer):
    """One cumulative Technique/Form row for a selected rank and age band.

    Wraps `syllabus.services.EffectiveSyllabusRequirement`: `requirement` is
    the effective (latest applicable) `SyllabusRequirement` row, so most
    fields are simple dotted lookups into it, same shape as
    `SyllabusRequirementSerializer` where they overlap. `introduced_rank`,
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
    sequence = serializers.IntegerField(source="requirement.sequence", read_only=True)
    start_number = serializers.IntegerField(
        source="requirement.start_number",
        read_only=True,
        allow_null=True,
    )
    end_number = serializers.IntegerField(
        source="requirement.end_number",
        read_only=True,
        allow_null=True,
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
