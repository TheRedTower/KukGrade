from __future__ import annotations

from rest_framework import serializers

from ranks.models import BeltColour, Rank


class RankSerializer(serializers.ModelSerializer):
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

    has_syllabus = serializers.BooleanField(
        read_only=True,
        help_text=(
            "False for a rank with no syllabus recorded of its own (White, and "
            "the ranks above Jo Kyo Nim until their charts are in). Such a rank "
            "is left out of the syllabus screen and cannot be graded for."
        ),
    )

    class Meta:
        model = Rank
        fields = (
            "id",
            "code",
            "name",
            "order",
            "belt_colour",
            "stripe_colour",
            "stripe_count",
            "next_rank",
            "has_syllabus",
        )
        read_only_fields = fields
