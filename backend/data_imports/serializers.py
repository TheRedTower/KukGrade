from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from accounts.people import named
from data_imports.mappings import (
    STUDENT_FIELD_LABELS,
    STUDENT_OPTIONAL_FIELDS,
    STUDENT_TARGET_FIELDS,
    STUDENT_WHOLE_FILE_FIELDS,
    suggest_column_mapping,
)
from data_imports.models import ImportBatch, ImportRow
from data_imports.services import (
    REVIEW_STEPS,
    ROW_COUNT_NAMES,
    CreateImportBatchResult,
    ImportStep,
    extra_values,
    next_step,
    review_step,
    roster_cells,
    roster_file_values,
    uncovered_fields,
)
from kukgrade.serializers import ModelSerializer

NOTHING_TO_CHANGE_MESSAGE = "Give at least one field to change."


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


class ImportSecondLookSerializer(serializers.Serializer):
    corrected = serializers.IntegerField(
        help_text="Added rows holding a fix of the importer's.",
    )
    given_status = serializers.IntegerField(
        help_text="Added rows the file gave no status, so one was given them.",
    )
    given_rank = serializers.IntegerField(
        help_text="Added rows the file gave no rank, so the whole-file rank was used.",
    )


class ImportBatchSerializer(ModelSerializer):
    """An import: what was uploaded, where it is up to, and its rows' counts."""

    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    uploaded_by_name = serializers.SerializerMethodField()
    committed_by_name = serializers.SerializerMethodField()
    next_step = serializers.SerializerMethodField(
        help_text=(
            "Where the import is up to, so a screen can resume it: one of the "
            "steps its kind serves (site settings, imports.kinds)."
        ),
    )
    review_step = serializers.SerializerMethodField(
        help_text=(
            "Where its review stands: REVIEW while rows need attention, "
            "otherwise CONFIRM."
        ),
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
    uncovered_fields = serializers.SerializerMethodField(
        help_text=(
            "A roster's needed fields that no saved column holds and no "
            "whole-file value gives, so each row's value is typed in."
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
            "review_step",
            "detected_headers",
            "column_mapping",
            "defaults",
            "extra_columns",
            "sheet",
            "sheet_names",
            "sheet_error",
            "suggested_mapping",
            "target_fields",
            "uncovered_fields",
            "grading_sheets",
            "warnings",
            "row_counts",
            "summary_json",
        ]
        read_only_fields = fields

    def get_uploaded_by_name(self, batch: ImportBatch) -> str:
        return named(batch.uploaded_by, batch.uploaded_by_title)

    def get_committed_by_name(self, batch: ImportBatch) -> str:
        return named(batch.committed_by, batch.committed_by_title)

    # Counted by ImportBatchViewSet's queryset (services.with_row_counts).
    def _rows_needing_review(self, batch: ImportBatch) -> int:
        return self.get_row_counts(batch)["review_required"]

    @extend_schema_field(serializers.ChoiceField(choices=ImportStep.choices))
    def get_next_step(self, batch: ImportBatch) -> str:
        return next_step(batch, rows_needing_review=self._rows_needing_review(batch))

    @extend_schema_field(serializers.ChoiceField(choices=REVIEW_STEPS))
    def get_review_step(self, batch: ImportBatch) -> str:
        return review_step(batch, rows_needing_review=self._rows_needing_review(batch))

    def get_detected_headers(self, batch: ImportBatch) -> list[str]:
        return batch.configuration.detected_headers

    def get_column_mapping(self, batch: ImportBatch) -> dict[str, str]:
        return batch.configuration.column_mapping

    def get_defaults(self, batch: ImportBatch) -> dict[str, str]:
        return batch.configuration.defaults

    def get_extra_columns(self, batch: ImportBatch) -> list[str]:
        return batch.configuration.extra_columns

    def get_sheet(self, batch: ImportBatch) -> str:
        return batch.configuration.sheet

    def get_sheet_names(self, batch: ImportBatch) -> list[str]:
        return batch.configuration.sheet_names

    def get_sheet_error(self, batch: ImportBatch) -> str:
        return batch.configuration.sheet_error

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

    def get_uncovered_fields(self, batch: ImportBatch) -> list[str]:
        return uncovered_fields(batch)

    def get_grading_sheets(self, batch: ImportBatch) -> list[str]:
        return batch.configuration.grading_sheets

    def get_warnings(self, batch: ImportBatch) -> list[str]:
        return batch.configuration.warnings

    @extend_schema_field(ImportRowCountsSerializer)
    def get_row_counts(self, batch: ImportBatch) -> dict[str, int]:
        # Every batch served is read through ImportBatchViewSet's queryset,
        # which counts them (services.with_row_counts).
        return {name: getattr(batch, f"rows_{name}") for name in ROW_COUNT_NAMES}


class ImportRowSerializer(ModelSerializer):
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
    A refusal names the part it is about: column_mapping, defaults or
    extra_columns.
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


class ImportRowExclusionSerializer(serializers.Serializer):
    excluded = serializers.BooleanField(
        help_text="True leaves the row out of the import; false brings it back.",
    )


class ImportBatchCreatedSerializer(ModelSerializer):
    """The new import's id, and whether this exact file was imported before -
    the one thing only the upload knows. Everything else, its headers and
    suggested matches included, is the import's own (batches/{id}/)."""

    already_imported_warning = serializers.SerializerMethodField()

    class Meta:
        model = ImportBatch
        fields = [
            "id",
            "already_imported_warning",
        ]
        read_only_fields = fields

    def _creation(self) -> CreateImportBatchResult:
        creation: CreateImportBatchResult = self.context["creation"]
        return creation

    def get_already_imported_warning(self, obj: Any) -> bool:
        return self._creation().already_imported_warning


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
            raise serializers.ValidationError(NOTHING_TO_CHANGE_MESSAGE)
        return attrs


class LegacyImportSerializer(serializers.Serializer):
    """The historical preview's request: the rank choices to save, if any.

    Keys are the source rank text exactly as it appeared in the workbook
    (case-insensitive on the service side); a null value explicitly means
    "leave unresolved" - never a block on committing that row, unlike the
    student roster importer's required rank. Left out, the stored choices
    are kept.
    """

    rank_mappings = serializers.DictField(
        child=serializers.CharField(allow_null=True, allow_blank=True, required=False),
        required=False,
    )


class RankMappingSuggestionSerializer(serializers.Serializer):
    source_text = serializers.CharField()
    suggested_rank_code = serializers.CharField(allow_null=True)
    doubtful = serializers.BooleanField(
        help_text="The source marks its own doubt, as in 'Red stripe?'.",
    )
    rows = serializers.IntegerField(help_text="How many rows use this text.")
    chosen_rank_code = serializers.CharField(
        allow_null=True,
        help_text="The rank chosen for this spelling, or null while it has none.",
    )


class LegacyImportPreviewSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    grading_result = serializers.IntegerField()
    auxiliary_note = serializers.IntegerField()
    did_not_attend = serializers.IntegerField()
    unresolved_current_rank = serializers.IntegerField()
    unresolved_testing_for_rank = serializers.IntegerField()
    excluded = serializers.IntegerField()
    worth_a_look = serializers.IntegerField(
        help_text="Records not left out that have issues: a reason to look.",
    )
    warnings = serializers.ListField(child=serializers.CharField())
    rank_suggestions = RankMappingSuggestionSerializer(many=True)
