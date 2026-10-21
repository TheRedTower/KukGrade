from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from data_imports.mappings import (
    STUDENT_FIELD_LABELS,
    STUDENT_OPTIONAL_FIELDS,
    STUDENT_TARGET_FIELDS,
    STUDENT_WHOLE_FILE_FIELDS,
    suggest_column_mapping,
)
from data_imports.models import ImportBatch, ImportRow
from data_imports.services import (
    ROW_COUNT_NAMES,
    CreateImportBatchResult,
    ImportStep,
    StudentImportRowOutcome,
    extra_values,
    next_step,
    roster_cells,
    roster_file_values,
    row_counts,
)
from students.models import Student


class ImportRowCountsSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    ready = serializers.IntegerField()
    review_required = serializers.IntegerField()
    skip_existing = serializers.IntegerField()
    excluded = serializers.IntegerField()


class ImportFieldSerializer(serializers.Serializer):
    """One field of KukGrade's a roster's columns are matched to."""

    field = serializers.CharField()
    name = serializers.CharField(help_text="The field's name on screen.")
    needed = serializers.BooleanField(help_text="Every student must have it.")
    whole_file = serializers.BooleanField(
        help_text="It can be given once for the whole file.",
    )


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
    defaults = serializers.SerializerMethodField(
        help_text="A roster's whole-file value for a field, where a row has none.",
    )
    extra_columns = serializers.SerializerMethodField(
        help_text="A roster's columns kept as each student's extra information.",
    )
    sheet = serializers.SerializerMethodField(
        help_text="A roster workbook's sheet being read; blank for a CSV.",
    )
    sheet_names = serializers.SerializerMethodField(
        help_text="Every sheet a roster workbook has, to choose another.",
    )
    sheet_error = serializers.SerializerMethodField(
        help_text=(
            "Why the selected roster sheet could not be read; choose another sheet."
        ),
    )
    suggested_mapping = serializers.SerializerMethodField(
        help_text="A roster's likely column for each field, from its headings.",
    )
    target_fields = serializers.SerializerMethodField(
        help_text="The fields a roster's columns are matched to; empty otherwise.",
    )
    rank_mappings = serializers.SerializerMethodField(
        help_text=(
            "A historical import's chosen rank for each spelling, by the "
            "spelling lowercased; a spelling not here is left as written."
        ),
    )
    grading_sheets = serializers.SerializerMethodField(
        help_text="A historical workbook's grading sheets that were read.",
    )
    warnings = serializers.SerializerMethodField(
        help_text="What the reading of the file left out, such as an unknown sheet.",
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
            "defaults",
            "extra_columns",
            "sheet",
            "sheet_names",
            "sheet_error",
            "suggested_mapping",
            "target_fields",
            "rank_mappings",
            "grading_sheets",
            "warnings",
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

    def get_defaults(self, batch: ImportBatch) -> dict[str, str]:
        return dict(batch.configuration_json.get("defaults", {}))

    def get_extra_columns(self, batch: ImportBatch) -> list[str]:
        return list(batch.configuration_json.get("extra_columns", []))

    def get_sheet(self, batch: ImportBatch) -> str:
        return str(batch.configuration_json.get("sheet", ""))

    def get_sheet_names(self, batch: ImportBatch) -> list[str]:
        return list(batch.configuration_json.get("sheet_names", []))

    def get_sheet_error(self, batch: ImportBatch) -> str:
        return str(batch.configuration_json.get("sheet_error", ""))

    def get_suggested_mapping(self, batch: ImportBatch) -> dict[str, str]:
        if batch.kind != ImportBatch.Kind.STUDENT_ROSTER:
            return {}
        return suggest_column_mapping(self.get_detected_headers(batch))

    @extend_schema_field(ImportFieldSerializer(many=True))
    def get_target_fields(self, batch: ImportBatch) -> list[dict[str, Any]]:
        if batch.kind != ImportBatch.Kind.STUDENT_ROSTER:
            return []
        return [
            {
                "field": field,
                "name": STUDENT_FIELD_LABELS[field],
                "needed": field not in STUDENT_OPTIONAL_FIELDS,
                "whole_file": field in STUDENT_WHOLE_FILE_FIELDS,
            }
            for field in STUDENT_TARGET_FIELDS
        ]

    def get_rank_mappings(self, batch: ImportBatch) -> dict[str, str]:
        return dict(batch.configuration_json.get("rank_mappings", {}))

    def get_grading_sheets(self, batch: ImportBatch) -> list[str]:
        return list(batch.configuration_json.get("grading_sheets", []))

    def get_warnings(self, batch: ImportBatch) -> list[str]:
        return list(batch.configuration_json.get("warnings", []))

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
            "testing_for_rank, outcome, report, section and note."
        ),
    )
    issues = serializers.ListField(
        child=serializers.CharField(),
        help_text=(
            "A roster row's problems, or a historical record's reasons to look "
            "at it (none of which stop the import)."
        ),
    )
    issue_fields = serializers.ListField(
        child=serializers.CharField(),
        help_text="The fields the issues are about (a roster's), to mark them.",
    )
    corrected_fields = serializers.SerializerMethodField(
        help_text="The fields whose value is the importer's fix, not the file's.",
    )
    extra = serializers.SerializerMethodField(
        help_text="The row's values in the columns kept as extra information.",
    )
    cells = serializers.SerializerMethodField(
        help_text=(
            "A roster row's every cell by column heading, as the file has it, "
            "the columns not imported included; empty for historical gradings."
        ),
    )
    file_values = serializers.SerializerMethodField(
        help_text=(
            "A roster row's matched fields as the file has them, before any "
            "fix; empty for historical gradings."
        ),
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
            "issue_fields",
            "corrected_fields",
            "extra",
            "cells",
            "file_values",
            "created_id",
        ]
        read_only_fields = fields

    def get_corrected_fields(self, row: ImportRow) -> list[str]:
        return sorted(row.correction)

    def _is_roster(self) -> bool:
        return self.context.get("kind") == ImportBatch.Kind.STUDENT_ROSTER

    def get_cells(self, row: ImportRow) -> dict[str, str]:
        return roster_cells(row.raw) if self._is_roster() else {}

    def get_file_values(self, row: ImportRow) -> dict[str, str]:
        if not self._is_roster():
            return {}
        return roster_file_values(row.raw, self.context.get("column_mapping", {}))

    def get_extra(self, row: ImportRow) -> dict[str, str]:
        # The batch's kept columns come in the context (ImportBatchViewSet).
        return extra_values(row.raw, self.context.get("extra_columns", []))


class ImportMappingSerializer(serializers.Serializer):
    """POST /{id}/mapping/: how a roster maps onto KukGrade.

    A column for each field, a whole-file value for a field the file lacks
    (current_rank or status only), and the columns to keep as extra
    information. A needed field with neither is typed into each row as a fix.
    """

    column_mapping = serializers.DictField(
        child=serializers.CharField(allow_blank=True),
    )
    defaults = serializers.DictField(
        child=serializers.CharField(allow_blank=True),
        required=False,
        default=dict,
        help_text="current_rank and/or status, used where a row has none.",
    )
    extra_columns = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        default=list,
        help_text="The file's columns to keep as each student's extra information.",
    )

    def validate_defaults(self, value: dict[str, str]) -> dict[str, str]:
        if set(value) - set(STUDENT_WHOLE_FILE_FIELDS):
            raise serializers.ValidationError(
                "Only current rank and status can be given for the whole file.",
            )
        status = value.get("status", "").strip().upper()
        if status and status not in Student.Status.values:
            raise serializers.ValidationError(f"Status {status!r} is not recognised.")
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        mapping = attrs["column_mapping"]
        unknown = sorted(set(mapping) - set(STUDENT_TARGET_FIELDS))
        if unknown:
            raise serializers.ValidationError(
                {"column_mapping": [f"Unknown field(s): {', '.join(unknown)}."]},
            )
        # A needed field may have no column: each row's value is then typed in
        # as a fix, and the row needs attention until it is (owner,
        # 2026-10-20). Commit refuses while any row does.
        return attrs


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
    sheet = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="A roster workbook's sheet to read; else the one it opens on.",
    )


class ImportSheetSerializer(serializers.Serializer):
    """POST /{id}/sheet/: read a roster from another sheet of its workbook."""

    sheet = serializers.CharField()


class ImportRecordsVoidSerializer(serializers.Serializer):
    """POST /{id}/void-records/: void every record a historical import made."""

    reason = serializers.CharField(help_text="Why, kept on every record.")


class ImportRecordsVoidedSerializer(serializers.Serializer):
    voided = serializers.IntegerField(help_text="How many records were voided.")


def _validate_column_mapping(value: dict[str, str]) -> None:
    unknown = set(value) - set(STUDENT_TARGET_FIELDS)
    if unknown:
        raise serializers.ValidationError(
            f"Unknown field(s): {', '.join(sorted(unknown))}."
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
    doubtful = serializers.BooleanField(
        help_text="The source marks its own doubt, as in 'Red stripe?'.",
    )
    rows = serializers.IntegerField(help_text="How many rows use this text.")


class LegacyImportPreviewSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    grading_result = serializers.IntegerField()
    auxiliary_note = serializers.IntegerField()
    did_not_attend = serializers.IntegerField()
    unresolved_current_rank = serializers.IntegerField()
    unresolved_testing_for_rank = serializers.IntegerField()
    unresolved_outcome = serializers.IntegerField()
    excluded = serializers.IntegerField()
    worth_a_look = serializers.IntegerField(
        help_text="Records not left out that have issues: a reason to look.",
    )
    warnings = serializers.ListField(child=serializers.CharField())
    rank_suggestions = RankMappingSuggestionSerializer(many=True)
