from __future__ import annotations

from rest_framework import serializers

from audit.models import AuditEvent


class AuditEventSerializer(serializers.ModelSerializer):
    action_display = serializers.CharField(source="get_action_display", read_only=True)
    actor_email = serializers.EmailField(source="actor.email", read_only=True)
    actor_name = serializers.CharField(source="actor.get_full_name", read_only=True)

    class Meta:
        model = AuditEvent
        fields = (
            "id",
            "occurred_at",
            "action",
            "action_display",
            "entity_type",
            "entity_id",
            "actor",
            "actor_email",
            "actor_name",
            "summary",
            "metadata",
        )
        read_only_fields = fields
