from __future__ import annotations

from rest_framework import serializers


class SchoolSerializer(serializers.Serializer):
    club_name = serializers.CharField()
    school_id_prefix = serializers.CharField(
        help_text="The school's own prefix in student IDs, such as 123-4.",
    )


class AboutSerializer(serializers.Serializer):
    version = serializers.CharField(help_text="The version of KukGrade running.")
    commit = serializers.CharField(
        help_text="The commit it was built from; blank when run from a checkout.",
    )
    built_at = serializers.DateTimeField(
        allow_null=True,
        help_text="When it was built; null when run from a checkout.",
    )
    time_zone = serializers.CharField(help_text="The club's time zone.")
    database = serializers.ChoiceField(
        choices=["ok", "unavailable"],
        help_text="Whether the database answers right now.",
    )
    repository_url = serializers.CharField(
        help_text="Where the source code is published."
    )
    issues_url = serializers.CharField(
        help_text="Where problems are reported in public."
    )
    releases_url = serializers.CharField(
        help_text="Where each version's release notes are."
    )
    support_email = serializers.CharField(help_text="Where to ask for help.")
    security_email = serializers.CharField(
        help_text="Where to report a security weakness."
    )
    licence = serializers.CharField(help_text="The licence, as an SPDX identifier.")
    copyright = serializers.CharField(help_text="The copyright notice.")
    school = SchoolSerializer(
        required=False,
        help_text="Present only for administrators: the school's settings, read-only.",
    )


class DocumentSerializer(serializers.Serializer):
    slug = serializers.CharField()
    title = serializers.CharField()
    format = serializers.ChoiceField(
        choices=["text", "markdown"],
        help_text="How `content` is written: plain text, or Markdown.",
    )
    content = serializers.CharField(
        help_text="The document, exactly as the repository holds it.",
    )
    source_url = serializers.CharField(help_text="The same document in the repository.")


class PledgePointSerializer(serializers.Serializer):
    english = serializers.CharField()
    korean = serializers.CharField()


class PledgeSerializer(serializers.Serializer):
    title = serializers.CharField()
    points = PledgePointSerializer(many=True)


class CreditSerializer(serializers.Serializer):
    name = serializers.CharField()
    version = serializers.CharField()
    summary = serializers.CharField(help_text="The project's own one-line description.")
    licence = serializers.CharField()
    homepage = serializers.CharField(help_text="Blank when the project gives none.")


class CreditsSerializer(serializers.Serializer):
    available = serializers.BooleanField(
        help_text="False when this copy was not built with its credits (a checkout).",
    )
    server = CreditSerializer(many=True)
    browser = CreditSerializer(many=True)
