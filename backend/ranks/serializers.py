from __future__ import annotations

from rest_framework import serializers

from ranks.models import Rank


class RankSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(
        source="get_category_display",
        read_only=True,
    )
    # The rank a student at this rank is graded for next, or null at the top.
    # Served so the frontend never works out rank progression itself.
    next_rank = serializers.IntegerField(
        source="next_rank_id",
        read_only=True,
        allow_null=True,
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
            "next_rank",
        )
        read_only_fields = fields
