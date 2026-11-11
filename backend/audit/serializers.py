from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from audit import tones
from audit.details import RankNames, event_details
from audit.models import AuditEntity, AuditEvent
from kukgrade.serializers import ChoiceSerializer, ModelSerializer


def student_id_of(event: AuditEvent) -> int | None:
    """The student an event is about: itself, or named in its metadata by id."""
    raw: Any = (
        event.entity_id
        if event.entity_type == AuditEntity.STUDENT
        else event.metadata.get("student_id")
    )
    try:
        return int(raw)
    except TypeError, ValueError:
        return None


class AuditDetailSerializer(serializers.Serializer):
    # DRF lifts declared fields off the class (see ChoiceSerializer).
    label = serializers.CharField(  # type: ignore[assignment]
        help_text="What the detail is, as a screen names it.",
    )
    value = serializers.CharField(help_text="What it was, in words.")


class AuditEventSerializer(ModelSerializer):
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
    tone = serializers.SerializerMethodField(
        help_text=(
            "How the event reads at a glance, from its action and the outcome "
            "it records: success, warning, info or neutral."
        ),
    )
    outcome_display = serializers.SerializerMethodField(
        help_text=(
            "The name of the grading outcome a proposal or final decision "
            "records; null for every other event."
        ),
    )

    details = serializers.SerializerMethodField(
        help_text=(
            "What the event recorded beyond its summary, as label and value pairs "
            "in words: no stored codes or ids."
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
            "tone",
            "outcome_display",
            "details",
        )
        read_only_fields = fields

    @extend_schema_field(serializers.ChoiceField(choices=tones.Tone.choices))
    def get_tone(self, event: AuditEvent) -> str:
        return tones.tone(event).value

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_outcome_display(self, event: AuditEvent) -> str | None:
        return tones.outcome_display(event)

    @extend_schema_field(AuditDetailSerializer(many=True))
    def get_details(self, event: AuditEvent) -> list[dict[str, str]]:
        # Rank names are read once for the page, not once per event.
        ranks = self.context.get("rank_names")
        if ranks is None:
            ranks = self.context["rank_names"] = RankNames.read()
        return event_details(event, ranks)

    def get_subject_name(self, event: AuditEvent) -> str:
        student_id = student_id_of(event)
        names: dict[int, str] = self.context.get("student_names", {})
        return names.get(student_id, "") if student_id is not None else ""


class AuditSubjectSerializer(serializers.Serializer):
    """GET /api/audit-events/subject/: what a history is of, named as it is now."""

    kind = serializers.CharField(
        allow_blank=True,
        help_text="session, student, candidate or user; blank for a malformed subject.",
    )
    id = serializers.CharField(help_text="The record's id.")
    session_id = serializers.IntegerField(
        allow_null=True,
        help_text="For a candidate, the grading it belongs to; null otherwise.",
    )
    name = serializers.CharField(
        allow_blank=True,
        help_text="The record's current name; blank once it no longer exists.",
    )
    exists = serializers.BooleanField(
        help_text="Whether the record still exists, so the app can open it.",
    )


class AuditLabelsSerializer(serializers.Serializer):
    """GET /api/audit-events/labels/: the names of the event and record
    types, so the audit screen's filters keep no list of their own."""

    actions = ChoiceSerializer(many=True)
    entities = ChoiceSerializer(many=True)
