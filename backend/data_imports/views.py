from __future__ import annotations

from functools import cached_property
from typing import Any, cast

from django.core.files.uploadedfile import UploadedFile
from django.db.models import Q, QuerySet
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.generics import get_object_or_404
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response

from accounts.models import User
from accounts.permissions import HasRequiredPermissions
from data_imports.mappings import STUDENT_WHOLE_FILE_FIELDS
from data_imports.models import FINISHED_IMPORT_STATUSES, ImportBatch, ImportRow
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
    ImportSecondLookSerializer,
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
    second_look_counts,
    set_import_row_excluded,
    void_import_records,
    with_row_counts,
)
from gradings.models import LegacyRecordKind
from kukgrade.filtering import (
    QueryFilter,
    boolean,
    choice,
    choices_in,
    read_by_view,
)
from kukgrade.search import search
from kukgrade.viewsets import KukGradeViewSet


def _rows_with_rank_text(rows: QuerySet[ImportRow], value: str) -> QuerySet[ImportRow]:
    """A historical import's rows that write a rank this way, held or tested
    for - so a spelling can be judged by the records that use it."""
    text = value.strip()
    return rows.filter(
        Q(values__current_rank__iexact=text) | Q(values__testing_for_rank__iexact=text),
    )


def _served_batch(request: Request, batch: ImportBatch) -> Response:
    """An import as every answer serves it: read again with its rows counted
    (with_row_counts), so the counts are the current ones."""
    fresh = with_row_counts(
        ImportBatch.objects.select_related(
            "uploaded_by",
            "committed_by",
            "cancelled_by",
        ),
    ).get(pk=batch.pk)
    return Response(ImportBatchSerializer(fresh, context={"request": request}).data)


class ImportBatchViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    KukGradeViewSet[ImportBatch],
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
        "sheet": ("data_imports.change_importbatch",),
        "void_records": ("gradings.can_reconcile_imported_history",),
        "second_look": ("data_imports.view_importbatch",),
    }
    query_filters = (
        choices_in("status", "status", ImportBatch.Status.values),
        choice("kind", "kind", ImportBatch.Kind.values),
        boolean(
            "finished",
            Q(status__in=FINISHED_IMPORT_STATUSES),
            "Only finished imports (imported, cancelled or expired), or only "
            "those still open.",
        ),
    )

    def get_queryset(self) -> QuerySet[ImportBatch]:
        return with_row_counts(
            ImportBatch.objects.select_related(
                "uploaded_by",
                "committed_by",
                "cancelled_by",
            ),
        ).order_by("-uploaded_at", "-pk")

    @extend_schema(request=ImportSheetSerializer, responses=ImportBatchSerializer)
    @action(detail=True, methods=["post"])
    def sheet(self, request: Request, *args: object, **kwargs: object) -> Response:
        """Read a roster from another sheet of its workbook; the column matches
        and fixes made for the old sheet go."""
        batch = self.get_object()
        payload = ImportSheetSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        choose_import_sheet(batch, sheet=payload.validated_data["sheet"])
        return _served_batch(request, batch)

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
        return _served_batch(request, batch)

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

    @extend_schema(responses=ImportSecondLookSerializer)
    @action(
        detail=True,
        methods=["get"],
        url_path="second-look",
        filter_backends=[],
        pagination_class=None,
    )
    def second_look(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        """What KukGrade filled in for a roster's added students, counted."""
        return Response(
            ImportSecondLookSerializer(second_look_counts(self.get_object())).data,
        )

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
        return _served_batch(request, committed)


@extend_schema(
    parameters=[
        OpenApiParameter(
            "batch_pk",
            int,
            OpenApiParameter.PATH,
            description="A unique integer value identifying this import batch.",
        ),
    ],
)
class ImportRowViewSet(KukGradeViewSet[ImportRow]):
    """One import's stored rows (batches/{id}/rows/): listed a page at a time
    in file order, and fixed or left out one at a time. Administrator-only,
    as the imports are."""

    serializer_class = ImportRowSerializer
    permission_classes = [HasRequiredPermissions]
    lookup_field = "row_number"
    lookup_value_regex = "[0-9]+"
    permission_map = {
        "list": ("data_imports.view_importbatch",),
        "partial_update": ("data_imports.change_importbatch",),
        "exclusion": ("data_imports.change_importbatch",),
        "leave_out_attention": ("data_imports.change_importbatch",),
    }
    query_filters = (
        choice(
            "outcome",
            "outcome",
            ImportRow.Outcome.values,
            "Only rows with this outcome.",
        ),
        search("search", ("search_text",), "Any of the row's values."),
        QueryFilter(
            "rank_text",
            _rows_with_rank_text,
            description=(
                "A historical import's rows that write a rank this way, "
                "held or tested for (any case)."
            ),
        ),
        boolean(
            "corrected",
            ~Q(correction={}),
            "Only rows with (or without) a fix of the importer's.",
        ),
        boolean(
            "worth_a_look",
            ~Q(issues=[]),
            "Only rows with (or without) issues: for a historical import, the "
            "records worth a look, left out or not.",
        ),
        choices_in(
            "record_kind",
            "raw__record_kind",
            LegacyRecordKind.values,
            "A historical import's rows of these kinds.",
        ),
        read_by_view(
            "filled",
            {"type": "string", "enum": list(STUDENT_WHOLE_FILE_FIELDS)},
            "A roster's rows whose value for this field the file did not give "
            "and nobody typed in, so the whole-file value or KukGrade's default "
            "was used.",
        ),
    )

    @cached_property
    def batch(self) -> ImportBatch:
        return get_object_or_404(ImportBatch, pk=self.kwargs["batch_pk"])

    def get_queryset(self) -> QuerySet[ImportRow]:
        return self.batch.rows.order_by("row_number")

    def get_serializer_context(self) -> dict[str, Any]:
        configuration = self.batch.configuration
        return {
            **super().get_serializer_context(),
            "kind": self.batch.kind,
            "extra_columns": configuration.extra_columns,
            "column_mapping": configuration.column_mapping,
        }

    def list(self, request: Request, *args: object, **kwargs: object) -> Response:
        """The import's rows, a page at a time, in file order."""
        rows = self.filter_queryset(self.get_queryset())
        filled = request.query_params.get("filled")
        if filled:
            rows = rows_given_a_value(self.batch, rows, filled)
        page = self.paginate_queryset(rows)
        assert page is not None
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

    @extend_schema(request=ImportRowCorrectionSerializer, responses=ImportRowSerializer)
    def partial_update(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        """Fix a roster row's values; every row is checked again."""
        payload = ImportRowCorrectionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        corrected = correct_import_row(
            self.batch,
            row_number=int(self.kwargs["row_number"]),
            changes=dict(payload.validated_data),
        )
        return Response(self.get_serializer(corrected).data)

    @extend_schema(request=ImportRowExclusionSerializer, responses=ImportRowSerializer)
    @action(detail=True, methods=["post"])
    def exclusion(self, request: Request, *args: object, **kwargs: object) -> Response:
        """Leave a row out of the import, or bring it back."""
        payload = ImportRowExclusionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        changed = set_import_row_excluded(
            self.batch,
            row_number=int(self.kwargs["row_number"]),
            excluded=payload.validated_data["excluded"],
        )
        return Response(self.get_serializer(changed).data)

    @extend_schema(request=None, responses=ImportBatchSerializer)
    @action(detail=False, methods=["post"], url_path="leave-out-attention")
    def leave_out_attention(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        """Leave out every roster row still needing attention, in one go."""
        leave_out_rows_needing_attention(self.batch)
        return _served_batch(request, self.batch)
