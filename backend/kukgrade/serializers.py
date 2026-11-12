"""Serializers shared across apps."""

from __future__ import annotations

from typing import Any

from django.db import models
from rest_framework import serializers


class ChoiceSerializer(serializers.Serializer):
    """One of a set of choices, as every list of them is served: the value
    sent back, and its name."""

    # A subclass may narrow it to its own choices (a ChoiceField).
    value: serializers.Field = serializers.CharField()
    # DRF lifts declared fields off the class, so this does not replace
    # Field.label at runtime; the stubs cannot know that.
    label = serializers.CharField()  # type: ignore[assignment]


_NEVER_SAVES = (
    "A serializer never saves: the view hands what it checked to the app's "
    "service (kukgrade.viewsets)."
)


# A model's shape on the wire: it reads, checks and serves, and never saves, so
# no write can skip the service that owns the model's rules and audit events.
# DRF's own would write the row directly. (A comment, not a docstring: the
# schema would publish a docstring as every subclass's description.)
class ModelSerializer[M: models.Model](serializers.ModelSerializer[M]):
    def create(self, validated_data: dict[str, Any]) -> Any:
        raise TypeError(_NEVER_SAVES)

    def update(self, instance: Any, validated_data: dict[str, Any]) -> Any:
        raise TypeError(_NEVER_SAVES)
