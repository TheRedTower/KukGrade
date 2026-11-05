from __future__ import annotations

from typing import Any

from rest_framework import serializers

from audit.models import AuditEvent


def student_id_of(event: AuditEvent) -> int | None:
    """The student an event is about: itself, or named in its metadata by id."""
    raw: Any = (
        event.entity_id
        if event.entity_type == "Student"
        else event.metadata.get("student_id")
    )
    try:
        return int(raw)
    except TypeError, ValueError:
        return None


class AuditEventSerializer(serializers.ModelSerializer):
    action_display = serializers.CharField(source="get_action_display", read_only=True)
    entity_type_display = serializers.CharField(
        source="get_entity_type_display",
        read_only=True,
    )
    subject_name = serializers.SerializerMethodField(
        help_text=(
            "The current name of the student the event is about, read now: "
            "events hold no names. Blank once the student no longer exists."
        ),
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
            "subject_name",
            "metadata",
        )
        read_only_fields = fields

    def get_subject_name(self, event: AuditEvent) -> str:
        student_id = student_id_of(event)
        names: dict[int, str] = self.context.get("student_names", {})
        return names.get(student_id, "") if student_id is not None else ""


class AuditChoiceSerializer(serializers.Serializer):
    value = serializers.CharField()
    # As in kukgrade/views.py: DRF lifts declared fields off the class.
    label = serializers.CharField()  # type: ignore[assignment]


class AuditLabelsSerializer(serializers.Serializer):
    """GET /api/audit-events/labels/: the names of the event and record
    types, so the audit screen's filters keep no list of their own."""

    actions = AuditChoiceSerializer(many=True)
    entities = AuditChoiceSerializer(many=True)
