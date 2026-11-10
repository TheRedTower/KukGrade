"""Serializers shared across apps."""

from __future__ import annotations

from rest_framework import serializers


class ChoiceSerializer(serializers.Serializer):
    """One of a set of choices, as every list of them is served: the value
    sent back, and its name."""

    # A subclass may narrow it to its own choices (a ChoiceField).
    value: serializers.Field = serializers.CharField()
    # DRF lifts declared fields off the class, so this does not replace
    # Field.label at runtime; the stubs cannot know that.
    label = serializers.CharField()  # type: ignore[assignment]
