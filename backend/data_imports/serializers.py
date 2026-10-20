from __future__ import annotations

from typing import Any

from rest_framework import serializers

from data_imports.mappings import STUDENT_REQUIRED_TARGET_FIELDS, STUDENT_TARGET_FIELDS
from data_imports.models import ImportBatch
from data_imports.services import CreateImportBatchResult, StudentImportRowOutcome


class ImportBatchSerializer(serializers.ModelSerializer):
    # Declared rather than inferred from JSONField, which would type it as
    # "anything": summary_json only ever holds safe counts.
    summary_json = serializers.DictField(
        child=serializers.IntegerField(), read_only=True
    )

    class Meta:
        model = ImportBatch
        fields = ["id", "summary_json"]
        read_only_fields = fields


class ImportBatchCreatedSerializer(serializers.ModelSerializer):
    """The new batch's id, plus one-shot creation-response extras: a
    duplicate-hash warning and the file's own headers, so the frontend can
    build its mapping step without a second request. Not persisted state."""

    already_imported_warning = serializers.SerializerMethodField()
    detected_headers = serializers.SerializerMethodField()
    suggested_mapping = serializers.SerializerMethodField()

    class Meta:
        model = ImportBatch
        fields = [
            "id",
            "already_imported_warning",
            "detected_headers",
            "suggested_mapping",
        ]
        read_only_fields = fields

    def _creation(self) -> CreateImportBatchResult:
        creation: CreateImportBatchResult = self.context["creation"]
        return creation

    def get_already_imported_warning(self, obj: Any) -> bool:
        return self._creation().already_imported_warning

    def get_detected_headers(self, obj: Any) -> list[str]:
        return self._creation().detected_headers

    def get_suggested_mapping(self, obj: Any) -> dict[str, str]:
        return self._creation().suggested_mapping


class ImportBatchCreateSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=ImportBatch.Kind.choices)
    file = serializers.FileField()


def _validate_column_mapping(value: dict[str, str]) -> None:
    unknown = set(value) - set(STUDENT_TARGET_FIELDS)
    if unknown:
        raise serializers.ValidationError(
            f"Unknown field(s): {', '.join(sorted(unknown))}."
        )
    missing = [
        field for field in STUDENT_REQUIRED_TARGET_FIELDS if not value.get(field)
    ]
    if missing:
        raise serializers.ValidationError(
            f"Choose a column for: {', '.join(missing)}.",
        )


class StudentImportCorrectionSerializer(serializers.Serializer):
    """One row's corrected values, by target field; any may be left out."""

    wksa_id = serializers.CharField(required=False, allow_blank=True)
    first_name = serializers.CharField(required=False, allow_blank=True)
    last_name = serializers.CharField(required=False, allow_blank=True)
    date_of_birth = serializers.CharField(required=False, allow_blank=True)
    current_rank = serializers.CharField(required=False, allow_blank=True)
    status = serializers.CharField(required=False, allow_blank=True)


class StudentImportSerializer(serializers.Serializer):
    """Shared request shape for the preview and commit actions."""

    column_mapping = serializers.DictField(
        child=serializers.CharField(allow_blank=True),
        validators=[_validate_column_mapping],
    )
    # Keyed by row number. Each correction declares the target fields it may
    # carry, so the schema - and the generated frontend type - name them.
    corrections = serializers.DictField(
        child=StudentImportCorrectionSerializer(),
        required=False,
        default=dict,
    )


class StudentImportRowResultSerializer(serializers.Serializer):
    row_number = serializers.IntegerField()
    outcome = serializers.ChoiceField(choices=StudentImportRowOutcome.choices)
    wksa_id = serializers.CharField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    date_of_birth_display = serializers.CharField()
    current_rank_text = serializers.CharField()
    status = serializers.CharField()
    issues = serializers.ListField(child=serializers.CharField())


class StudentImportPreviewSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    ready = serializers.IntegerField()
    review_required = serializers.IntegerField()
    skip_existing = serializers.IntegerField()
    rows = StudentImportRowResultSerializer(many=True)


class LegacyImportSerializer(serializers.Serializer):
    """Shared request shape for the historical preview and commit actions.

    Keys are the source rank text exactly as it appeared in the workbook
    (case-insensitive on the service side); a null/omitted value explicitly
    means "leave unresolved" - never a block on committing that row
    (import Decision 4, unlike the student roster importer's required rank).
    """

    rank_mappings = serializers.DictField(
        child=serializers.CharField(allow_null=True, allow_blank=True, required=False),
        required=False,
        default=dict,
    )


class RankMappingSuggestionSerializer(serializers.Serializer):
    source_text = serializers.CharField()
    suggested_rank_code = serializers.CharField(allow_null=True)


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
