from __future__ import annotations

from rest_framework import serializers

from ranks.models import Rank


class RankSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(
        source="get_category_display",
        read_only=True,
    )

    class Meta:
        model = Rank
        fields = (
            "id",
            "code",
            "name",
            "order",
            "category",
            "category_display",
            "active",
        )
        read_only_fields = fields
