from __future__ import annotations

from rest_framework import serializers

from ranks.models import BeltColour, Rank


class RankSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(
        source="get_category_display",
        read_only=True,
    )
    # The rank a student at this rank is graded for next, or null at the top.
    # Served so the frontend never works out rank progression itself.
    # Declared so the schema says blank - no stripe - is a served value.
    stripe_colour = serializers.ChoiceField(
        choices=BeltColour.choices,
        allow_blank=True,
        read_only=True,
    )
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
            "belt_colour",
            "stripe_colour",
            "stripe_count",
            "active",
            "next_rank",
        )
        read_only_fields = fields
