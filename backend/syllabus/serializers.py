from __future__ import annotations

from rest_framework import serializers

from syllabus.models import SyllabusItem, SyllabusRequirement


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
