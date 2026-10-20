from __future__ import annotations

from rest_framework import serializers

from audit.models import AuditEvent


class AuditEventSerializer(serializers.ModelSerializer):
    action_display = serializers.CharField(source="get_action_display", read_only=True)
    entity_type_display = serializers.CharField(
        source="get_entity_type_display",
        read_only=True,
    )

    class Meta:
        model = AuditEvent
        fields = (
            "id",
            "occurred_at",
            "action",
            "action_display",
            "entity_type",
            "entity_type_display",
            "entity_id",
            "actor_email",
            "actor_name",
            "summary",
            "metadata",
        )
        read_only_fields = fields


class AuditChoiceSerializer(serializers.Serializer):
    value = serializers.CharField()
    # As in kukgrade/views.py: DRF lifts declared fields off the class.
    label = serializers.CharField()  # type: ignore[assignment]


class AuditLabelsSerializer(serializers.Serializer):
    """GET /api/audit-events/labels/: the names of the event and record
    types, so the audit screen's filters keep no list of their own."""

    actions = AuditChoiceSerializer(many=True)
    entities = AuditChoiceSerializer(many=True)
