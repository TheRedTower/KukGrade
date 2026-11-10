from __future__ import annotations

from typing import Any, cast

from django.core.files.uploadedfile import UploadedFile
from django.db.models import Q, QuerySet
from drf_spectacular.utils import (
    OpenApiParameter,
    extend_schema,
)
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from accounts.models import User
from accounts.permissions import HasRequiredPermissions
from data_imports.mappings import STUDENT_WHOLE_FILE_FIELDS
from data_imports.models import ImportBatch, ImportRow
from data_imports.serializers import (
    ImportBatchCreatedSerializer,
    ImportBatchCreateSerializer,
    ImportBatchSerializer,
    ImportMappingSerializer,
    ImportRecordsVoidedSerializer,
    ImportRecordsVoidSerializer,
    ImportRowCorrectionSerializer,
    ImportRowExclusionSerializer,
    ImportRowSerializer,
    ImportSheetSerializer,
    LegacyImportPreviewSerializer,
    LegacyImportSerializer,
)
from data_imports.services import (
    cancel_import_batch,
    choose_import_sheet,
    commit_legacy_grading_import,
    commit_student_import,
    correct_import_row,
    create_import_batch,
    leave_out_rows_needing_attention,
    preview_legacy_grading_import,
    rows_given_a_value,
    save_import_mapping,
    set_import_row_excluded,
    void_import_records,
    with_row_counts,
)
from gradings.models import LegacyRecordKind
from kukgrade.filtering import QueryFilter, choice, choices_in
from kukgrade.search import search


# The review table's filters. Not a `list` action, so they are checked here
# rather than by DeclaredQueryFilters - unknown ones are refused all the same.
def _rows_with_rank_text(rows: QuerySet[ImportRow], value: str) -> QuerySet[ImportRow]:
    """A historical import's rows that write a rank this way, held or tested
    for - so a spelling can be judged by the records that use it."""
    text = value.strip()
    return rows.filter(
        Q(values__current_rank__iexact=text) | Q(values__testing_for_rank__iexact=text),
    )


def _rows_corrected(rows: QuerySet[ImportRow], value: str) -> QuerySet[ImportRow]:
    """Rows with (or without) a fix of the importer's."""
    if value == "true":
        return rows.exclude(correction={})
    if value == "false":
        return rows.filter(correction={})
    return rows.none()


def _rows_worth_a_look(rows: QuerySet[ImportRow], value: str) -> QuerySet[ImportRow]:
    """Rows with (or without) issues - for a historical import, the records
    worth a look, left out or not."""
    if value == "true":
        return rows.exclude(issues=[])
    if value == "false":
        return rows.filter(issues=[])
    return rows.none()


_ROW_FILTERS = (
    choice("outcome", "outcome", ImportRow.Outcome.values),
    search("search", ("search_text",), "Any of the row's values."),
    QueryFilter("rank_text", _rows_with_rank_text),
    QueryFilter("corrected", _rows_corrected),
    QueryFilter("worth_a_look", _rows_worth_a_look),
    choices_in("record_kind", "raw__record_kind", LegacyRecordKind.values),
)
_ROW_PARAMETERS = frozenset(
    {
        "outcome",
        "search",
        "rank_text",
        "corrected",
        "worth_a_look",
        "record_kind",
        "filled",
        "page",
        "page_size",
        "format",
    },
)


class ImportBatchViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    GenericViewSet,
):
    """Administrator-only bulk data import.

    No `INSTRUCTOR_GROUP` permission is ever granted for this app - see
    `accounts.groups._DATA_IMPORT_PERMISSIONS`.
    """

    serializer_class = ImportBatchSerializer
    permission_classes = [HasRequiredPermissions]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_map = {
        "list": ("data_imports.view_importbatch",),
        "retrieve": ("data_imports.view_importbatch",),
        "create": ("data_imports.add_importbatch",),
        "cancel": ("data_imports.change_importbatch",),
        # A historical preview stores the rank choices it is given, so it
        # changes the import: the same permission as matching columns.
        "preview": ("data_imports.change_importbatch",),
        "commit": ("data_imports.can_commit_import",),
        "mapping": ("data_imports.change_importbatch",),
        "rows": ("data_imports.view_importbatch",),
        "row": ("data_imports.change_importbatch",),
        "row_exclusion": ("data_imports.change_importbatch",),
        "leave_out_attention": ("data_imports.change_importbatch",),
        "sheet": ("data_imports.change_importbatch",),
        "void_records": ("gradings.can_reconcile_imported_history",),
    }
    query_filters = (
        choices_in("status", "status", ImportBatch.Status.values),
        choice("kind", "kind", ImportBatch.Kind.values),
    )

    def get_queryset(self) -> QuerySet[ImportBatch]:
        return with_row_counts(
            ImportBatch.objects.select_related(
                "uploaded_by",
                "committed_by",
                "cancelled_by",
            ),
        ).order_by("-uploaded_at", "-pk")

    def _batch_response(self, request: Request, batch: ImportBatch) -> Response:
        # Read again through the queryset, so its counts are the current ones.
        fresh = self.get_queryset().get(pk=batch.pk)
        return Response(ImportBatchSerializer(fresh, context={"request": request}).data)

    @extend_schema(request=ImportSheetSerializer, responses=ImportBatchSerializer)
    @action(detail=True, methods=["post"])
    def sheet(self, request: Request, *args: object, **kwargs: object) -> Response:
        """Read a roster from another sheet of its workbook; the column matches
        and fixes made for the old sheet go."""
        batch = self.get_object()
        payload = ImportSheetSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        choose_import_sheet(batch, sheet=payload.validated_data["sheet"])
        return self._batch_response(request, batch)

    @extend_schema(
        request=ImportRecordsVoidSerializer,
        responses=ImportRecordsVoidedSerializer,
    )
    @action(detail=True, methods=["post"], url_path="void-records")
    def void_records(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        """Void every record a finished historical import created - for a
        wrong file imported. Records are never deleted."""
        batch = self.get_object()
        payload = ImportRecordsVoidSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        voided = void_import_records(
            batch,
            reason=payload.validated_data["reason"],
            actor=cast(User, request.user),
        )
        return Response(ImportRecordsVoidedSerializer({"voided": voided}).data)

    @extend_schema(request=ImportMappingSerializer, responses=ImportBatchSerializer)
    @action(detail=True, methods=["post"])
    def mapping(self, request: Request, *args: object, **kwargs: object) -> Response:
        """Match a roster's columns to KukGrade's fields, and check every row."""
        batch = self.get_object()
        payload = ImportMappingSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        save_import_mapping(
            batch,
            column_mapping=payload.validated_data["column_mapping"],
            defaults=payload.validated_data["defaults"],
            extra_columns=payload.validated_data["extra_columns"],
        )
        return self._batch_response(request, batch)

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "outcome",
                str,
                enum=ImportRow.Outcome.values,
                description="Only rows with this outcome.",
            ),
            OpenApiParameter(
                "search",
                str,
                description="Matches any of the row's values.",
            ),
            OpenApiParameter(
                "corrected",
                bool,
                description="Only rows with (or without) a fix of the importer's.",
            ),
            OpenApiParameter(
                "rank_text",
                str,
                description=(
                    "A historical import's rows that write a rank this way, "
                    "held or tested for (any case)."
                ),
            ),
            OpenApiParameter(
                "worth_a_look",
                bool,
                description="Only rows with (or without) issues.",
            ),
            OpenApiParameter(
                "record_kind",
                str,
                description=(
                    "A historical import's rows of these kinds, comma-separated: "
                    f"{', '.join(LegacyRecordKind.values)}."
                ),
            ),
            OpenApiParameter(
                "filled",
                str,
                enum=list(STUDENT_WHOLE_FILE_FIELDS),
                description=(
                    "A roster's rows whose value for this field the file did not "
                    "give and nobody typed in, so the whole-file value or "
                    "KukGrade's default was used."
                ),
            ),
        ],
        responses=ImportRowSerializer(many=True),
    )
    # No batch filters here: a row list takes only its own (_ROW_FILTERS).
    @action(detail=True, methods=["get"], filter_backends=[])
    def rows(self, request: Request, *args: object, **kwargs: object) -> Response:
        """The import's rows, a page at a time, in file order."""
        batch = self.get_object()
        unknown = sorted(set(request.query_params) - _ROW_PARAMETERS)
        if unknown:
            raise ValidationError(
                {name: ["This list cannot be filtered that way."] for name in unknown},
            )
        rows: QuerySet[ImportRow] = batch.rows.order_by("row_number")
        for row_filter in _ROW_FILTERS:
            value = request.query_params.get(row_filter.name)
            if value:
                rows = row_filter.apply(rows, value)
        filled = request.query_params.get("filled")
        if filled:
            rows = rows_given_a_value(batch, rows, filled)
        page = self.paginate_queryset(rows)
        assert page is not None
        return self.get_paginated_response(
            ImportRowSerializer(page, many=True, context=self._row_context(batch)).data,
        )

    def _row_context(self, batch: ImportBatch) -> dict[str, Any]:
        configuration = batch.configuration
        return {
            "kind": batch.kind,
            "extra_columns": configuration.extra_columns,
            "column_mapping": configuration.column_mapping,
        }

    @extend_schema(request=ImportRowCorrectionSerializer, responses=ImportRowSerializer)
    @action(
        detail=True,
        methods=["patch"],
        url_path=r"rows/(?P<row_number>[0-9]+)",
        filter_backends=[],
    )
    def row(
        self,
        request: Request,
        row_number: str,
        *args: object,
        **kwargs: object,
    ) -> Response:
        """Fix a roster row's values; every row is checked again."""
        batch = self.get_object()
        payload = ImportRowCorrectionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        changes: dict[str, Any] = dict(payload.validated_data)
        corrected = correct_import_row(
            batch,
            row_number=int(row_number),
            changes=changes,
        )
        return Response(
            ImportRowSerializer(corrected, context=self._row_context(batch)).data,
        )

    @extend_schema(request=ImportRowExclusionSerializer, responses=ImportRowSerializer)
    @action(
        detail=True,
        methods=["post"],
        url_path=r"rows/(?P<row_number>[0-9]+)/exclusion",
        filter_backends=[],
    )
    def row_exclusion(
        self,
        request: Request,
        row_number: str,
        *args: object,
        **kwargs: object,
    ) -> Response:
        """Leave a row out of the import, or bring it back."""
        batch = self.get_object()
        payload = ImportRowExclusionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        changed = set_import_row_excluded(
            batch,
            row_number=int(row_number),
            excluded=payload.validated_data["excluded"],
        )
        return Response(
            ImportRowSerializer(changed, context=self._row_context(batch)).data,
        )

    @extend_schema(request=None, responses=ImportBatchSerializer)
    @action(
        detail=True,
        methods=["post"],
        url_path="rows/leave-out-attention",
        filter_backends=[],
    )
    def leave_out_attention(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        """Leave out every roster row still needing attention, in one go."""
        batch = self.get_object()
        leave_out_rows_needing_attention(batch)
        return self._batch_response(request, batch)

    @extend_schema(
        request=ImportBatchCreateSerializer,
        responses={201: ImportBatchCreatedSerializer},
    )
    def create(self, request: Request, *args: object, **kwargs: object) -> Response:
        input_serializer = ImportBatchCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        result = create_import_batch(
            kind=input_serializer.validated_data["kind"],
            upload=cast(UploadedFile, input_serializer.validated_data["file"]),
            uploaded_by=cast(User, request.user),
            sheet=input_serializer.validated_data.get("sheet"),
        )
        created = ImportBatchCreatedSerializer(
            result.batch,
            context={"request": request, "creation": result},
        )
        return Response(created.data, status=status.HTTP_201_CREATED)

    @extend_schema(request=None, responses={204: None})
    @action(detail=True, methods=["post"])
    def cancel(self, request: Request, *args: object, **kwargs: object) -> Response:
        batch = self.get_object()
        cancel_import_batch(batch, actor=cast(User, request.user))
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        request=LegacyImportSerializer, responses=LegacyImportPreviewSerializer
    )
    @action(detail=True, methods=["post"])
    def preview(self, request: Request, *args: object, **kwargs: object) -> Response:
        """A historical import's rank choices, saved when given, and what it
        would do. A roster's columns are matched with mapping/ instead."""
        batch = self.get_object()
        legacy_input = LegacyImportSerializer(data=request.data)
        legacy_input.is_valid(raise_exception=True)
        legacy_preview = preview_legacy_grading_import(
            batch,
            rank_mappings=legacy_input.validated_data.get("rank_mappings"),
        )
        return Response(LegacyImportPreviewSerializer(legacy_preview).data)

    @extend_schema(request=None, responses=ImportBatchSerializer)
    @action(detail=True, methods=["post"])
    def commit(self, request: Request, *args: object, **kwargs: object) -> Response:
        """Finish the import from what is stored: a roster's mapping and fixes,
        or a historical import's rank choices."""
        batch = self.get_object()
        actor = cast(User, request.user)
        if batch.kind == ImportBatch.Kind.LEGACY_GRADINGS:
            committed = commit_legacy_grading_import(batch, actor=actor)
        else:
            committed = commit_student_import(batch, actor=actor)
        return self._batch_response(request, committed)
