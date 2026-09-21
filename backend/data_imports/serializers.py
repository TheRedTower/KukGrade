from __future__ import annotations

from rest_framework import serializers

from data_imports.mappings import STUDENT_REQUIRED_TARGET_FIELDS, STUDENT_TARGET_FIELDS
from data_imports.models import ImportBatch


class ImportBatchSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    uploaded_by_email = serializers.EmailField(
        source="uploaded_by.email", read_only=True
    )
    committed_by_email = serializers.EmailField(
        source="committed_by.email",
        read_only=True,
        allow_null=True,
    )

    class Meta:
        model = ImportBatch
        fields = [
            "id",
            "kind",
            "kind_display",
            "status",
            "status_display",
            "original_filename",
            "sha256",
            "file_size",
            "uploaded_by_email",
            "uploaded_at",
            "committed_by_email",
            "committed_at",
            "cancelled_at",
            "summary_json",
            "configuration_json",
            "error_summary",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class ImportBatchCreateSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=ImportBatch.Kind.choices)
    file = serializers.FileField()


def _validate_column_mapping(value: dict[str, str]) -> None:
    unknown = set(value) - set(STUDENT_TARGET_FIELDS)
    if unknown:
        raise serializers.ValidationError(
            f"Unknown target field(s): {', '.join(sorted(unknown))}."
        )
    missing = [
        field for field in STUDENT_REQUIRED_TARGET_FIELDS if not value.get(field)
    ]
    if missing:
        raise serializers.ValidationError(
            f"Missing required column mapping for: {', '.join(missing)}.",
        )


class StudentImportRequestSerializer(serializers.Serializer):
    """Shared request shape for the preview and commit actions."""

    column_mapping = serializers.DictField(
        child=serializers.CharField(allow_blank=True),
        validators=[_validate_column_mapping],
    )
    corrections = serializers.DictField(
        child=serializers.DictField(child=serializers.CharField(allow_blank=True)),
        required=False,
        default=dict,
    )


class StudentImportRowResultSerializer(serializers.Serializer):
    row_number = serializers.IntegerField()
    outcome = serializers.CharField()
    wksa_id = serializers.CharField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    date_of_birth_display = serializers.CharField()
    current_rank_text = serializers.CharField()
    current_rank_code = serializers.CharField(allow_null=True)
    status = serializers.CharField()
    issues = serializers.ListField(child=serializers.CharField())
    existing_student_id = serializers.IntegerField(allow_null=True)
    existing_student_display = serializers.CharField(allow_null=True)


class StudentImportPreviewSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    ready = serializers.IntegerField()
    review_required = serializers.IntegerField()
    skip_existing = serializers.IntegerField()
    rows = StudentImportRowResultSerializer(many=True)
