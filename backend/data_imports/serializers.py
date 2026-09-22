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


class LegacyImportRequestSerializer(serializers.Serializer):
    """Shared request shape for the historical preview and commit actions.

    Keys are the source rank text exactly as it appeared in the workbook
    (case-insensitive on the service side); a null/omitted value explicitly
    means "leave unresolved" - never a block on committing that row
    (Decision 4/17, unlike the student roster importer's required rank).
    """

    rank_mappings = serializers.DictField(
        child=serializers.CharField(allow_null=True, allow_blank=True, required=False),
        required=False,
        default=dict,
    )


class RankMappingSuggestionSerializer(serializers.Serializer):
    source_text = serializers.CharField()
    suggested_rank_id = serializers.IntegerField(allow_null=True)
    suggested_rank_code = serializers.CharField(allow_null=True)


class CanonicalLegacyRowSerializer(serializers.Serializer):
    source_sheet = serializers.CharField()
    source_section = serializers.CharField()
    source_locator = serializers.CharField()
    cycle_year = serializers.IntegerField()
    cycle_month = serializers.IntegerField()
    record_kind = serializers.CharField()
    source_name = serializers.CharField()
    source_current_rank_text = serializers.CharField()
    source_testing_for_rank_text = serializers.CharField()
    source_outcome_text = serializers.CharField()
    outcome = serializers.CharField(allow_null=True)
    attendance_status = serializers.CharField()
    comments = serializers.CharField()
    admin_note = serializers.CharField()


class LegacyImportPreviewSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    grading_result = serializers.IntegerField()
    auxiliary_note = serializers.IntegerField()
    did_not_attend = serializers.IntegerField()
    unresolved_current_rank = serializers.IntegerField()
    unresolved_testing_for_rank = serializers.IntegerField()
    unresolved_outcome = serializers.IntegerField()
    warnings = serializers.ListField(child=serializers.CharField())
    rank_suggestions = RankMappingSuggestionSerializer(many=True)
    rows = CanonicalLegacyRowSerializer(many=True)
