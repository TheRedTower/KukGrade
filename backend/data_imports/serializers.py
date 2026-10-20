from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from data_imports.mappings import STUDENT_REQUIRED_TARGET_FIELDS, STUDENT_TARGET_FIELDS
from data_imports.models import ImportBatch, ImportRow
from data_imports.services import (
    ROW_COUNT_NAMES,
    CreateImportBatchResult,
    ImportStep,
    StudentImportRowOutcome,
    next_step,
    row_counts,
)


class ImportRowCountsSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    ready = serializers.IntegerField()
    review_required = serializers.IntegerField()
    skip_existing = serializers.IntegerField()
    excluded = serializers.IntegerField()


class ImportBatchSerializer(serializers.ModelSerializer):
    """An import: what was uploaded, where it is up to, and its rows' counts."""

    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    uploaded_by_name = serializers.SerializerMethodField()
    committed_by_name = serializers.SerializerMethodField()
    next_step = serializers.SerializerMethodField(
        help_text="Where the import is up to, so a screen can resume it.",
    )
    detected_headers = serializers.SerializerMethodField(
        help_text="A roster's column headers, as in the file; empty otherwise.",
    )
    column_mapping = serializers.SerializerMethodField(
        help_text="A roster's chosen column for each KukGrade field.",
    )
    row_counts = serializers.SerializerMethodField()
    # Declared rather than inferred from JSONField, which would type it as
    # "anything": summary_json only ever holds safe counts.
    summary_json = serializers.DictField(
        child=serializers.IntegerField(), read_only=True
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
            "file_size",
            "uploaded_at",
            "uploaded_by_name",
            "committed_at",
            "committed_by_name",
            "cancelled_at",
            "next_step",
            "detected_headers",
            "column_mapping",
            "row_counts",
            "summary_json",
        ]
        read_only_fields = fields

    def get_uploaded_by_name(self, batch: ImportBatch) -> str:
        return batch.uploaded_by.get_full_name() or batch.uploaded_by.email

    def get_committed_by_name(self, batch: ImportBatch) -> str:
        user = batch.committed_by
        return (user.get_full_name() or user.email) if user else ""

    @extend_schema_field(serializers.ChoiceField(choices=ImportStep.choices))
    def get_next_step(self, batch: ImportBatch) -> str:
        return next_step(batch)

    def get_detected_headers(self, batch: ImportBatch) -> list[str]:
        return list(batch.configuration_json.get("detected_headers", []))

    def get_column_mapping(self, batch: ImportBatch) -> dict[str, str]:
        return dict(batch.configuration_json.get("column_mapping", {}))

    @extend_schema_field(ImportRowCountsSerializer)
    def get_row_counts(self, batch: ImportBatch) -> dict[str, int]:
        # Annotated by the batch list and detail (ImportBatchViewSet), so a
        # page of imports is counted in its one query.
        annotated = getattr(batch, "row_counts_annotated", None)
        if annotated is not None:
            return {name: getattr(batch, f"rows_{name}") for name in ROW_COUNT_NAMES}
        return row_counts(batch)


class ImportRowSerializer(serializers.ModelSerializer):
    """One stored row and what the last check made of it."""

    outcome_display = serializers.CharField(
        source="get_outcome_display", read_only=True
    )
    values = serializers.DictField(
        child=serializers.CharField(allow_blank=True),
        help_text=(
            "The row's values by KukGrade field, as checked - for a roster "
            "wksa_id, first_name, last_name, date_of_birth, current_rank and "
            "status; for historical gradings name, period, current_rank, "
            "testing_for_rank, outcome and report."
        ),
    )
    issues = serializers.ListField(child=serializers.CharField())
    corrected_fields = serializers.SerializerMethodField(
        help_text="The fields whose value is the importer's fix, not the file's.",
    )

    class Meta:
        model = ImportRow
        fields = [
            "row_number",
            "source_locator",
            "outcome",
            "outcome_display",
            "excluded",
            "values",
            "issues",
            "corrected_fields",
            "created_id",
        ]
        read_only_fields = fields

    def get_corrected_fields(self, row: ImportRow) -> list[str]:
        return sorted(row.correction)


class ImportMappingSerializer(serializers.Serializer):
    """POST /{id}/mapping/: a roster's column for each KukGrade field."""

    column_mapping = serializers.DictField(
        child=serializers.CharField(allow_blank=True),
    )

    def validate_column_mapping(self, value: dict[str, str]) -> dict[str, str]:
        _validate_column_mapping(value)
        return value


class ImportRowExclusionSerializer(serializers.Serializer):
    excluded = serializers.BooleanField(
        help_text="True leaves the row out of the import; false brings it back.",
    )


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


class ImportRowCorrectionSerializer(serializers.Serializer):
    """PATCH /{id}/rows/{row_number}/: a roster row's fixes, by field.

    A null value takes the fix away, so the file's own value is used again.
    """

    wksa_id = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    first_name = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    last_name = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    date_of_birth = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    current_rank = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    status = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if not attrs:
            raise serializers.ValidationError("Give at least one field to change.")
        return attrs


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
    excluded = serializers.IntegerField()
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
    excluded = serializers.IntegerField()
    warnings = serializers.ListField(child=serializers.CharField())
    rank_suggestions = RankMappingSuggestionSerializer(many=True)
