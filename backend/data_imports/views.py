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
from data_imports.legacy_checks import CheckKind, check_counts, legacy_checks
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
    ImportStartSerializer,
    LegacyCheckDecisionSerializer,
    LegacyCheckSerializer,
    LegacyChecksSummarySerializer,
    LegacySheetChoiceSerializer,
    LegacySheetSerializer,
)
from data_imports.services import (
    cancel_import_batch,
    choose_import_sheet,
    choose_legacy_sheets,
    commit_legacy_grading_import,
    commit_student_import,
    correct_import_row,
    create_import_batch,
    leave_out_rows_needing_attention,
    legacy_sheets,
    legacy_warnings,
    resolve_legacy_check,
    rows_given_a_value,
    save_import_mapping,
    second_look_counts,
    set_import_row_excluded,
    void_import_records,
    why_not_startable,
    with_row_counts,
)
from gradings.models import LegacyRecordKind
from kukgrade.filtering import (
    boolean,
    choice,
    choices_in,
    exact,
    read_by_view,
)
from kukgrade.search import search
from kukgrade.viewsets import KukGradeViewSet

_CHECK_FILTERS = (
    read_by_view(
        "kind",
        {"type": "string", "enum": list(CheckKind.values)},
        "Only checks of this kind.",
    ),
    read_by_view(
        "open",
        {"type": "boolean"},
        "Only checks not decided yet (true), or only those decided (false).",
    ),
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
    `accounts.groups._IMPORT`.
    """

    serializer_class = ImportBatchSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_map = {
        "list": ("data_imports.view_importbatch",),
        "retrieve": ("data_imports.view_importbatch",),
        "create": ("data_imports.add_importbatch",),
        "starts": ("data_imports.add_importbatch",),
        "cancel": ("data_imports.change_importbatch",),
        "commit": ("data_imports.can_commit_import",),
        "mapping": ("data_imports.change_importbatch",),
        "sheet": ("data_imports.change_importbatch",),
        "sheets": ("data_imports.view_importbatch",),
        "choose_sheets": ("data_imports.change_importbatch",),
        "void_records": ("gradings.can_reconcile_imported_history",),
        "second_look": ("data_imports.view_importbatch",),
        "checks": ("data_imports.view_importbatch",),
        "checks_summary": ("data_imports.view_importbatch",),
        "resolve_check": ("data_imports.change_importbatch",),
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

    @extend_schema(responses=ImportStartSerializer(many=True))
    @action(detail=False, methods=["get"], filter_backends=[], pagination_class=None)
    def starts(self, request: Request, *args: object, **kwargs: object) -> Response:
        """Whether an import of each kind can start now, and why not when it
        cannot - past gradings wait for the students to be imported."""
        return Response(
            ImportStartSerializer(
                [
                    {"kind": kind, "why_not": why_not_startable(kind)}
                    for kind in ImportBatch.Kind.values
                ],
                many=True,
            ).data,
        )

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

    @extend_schema(responses=LegacySheetSerializer(many=True))
    @action(detail=True, methods=["get"], filter_backends=[], pagination_class=None)
    def sheets(self, request: Request, *args: object, **kwargs: object) -> Response:
        """A historical import's grading sheets: each one's records, whether
        it is chosen, and whether KukGrade already holds it - new, already
        imported, or changed since, with what differs."""
        sheets = legacy_sheets(self.get_object())
        return Response(LegacySheetSerializer(sheets, many=True).data)

    @extend_schema(
        request=LegacySheetChoiceSerializer,
        responses=LegacySheetSerializer(many=True),
    )
    @sheets.mapping.patch
    def choose_sheets(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        """Choose which grading sheets come in. Only what KukGrade does not
        hold yet comes in from any of them."""
        batch = self.get_object()
        payload = LegacySheetChoiceSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        sheets = choose_legacy_sheets(
            batch,
            included=payload.validated_data["included"],
        )
        return Response(LegacySheetSerializer(sheets, many=True).data)

    @extend_schema(responses=LegacyCheckSerializer(many=True))
    @action(detail=True, methods=["get"], query_filters=_CHECK_FILTERS)
    def checks(self, request: Request, *args: object, **kwargs: object) -> Response:
        """A historical import's things to check before it is saved - the
        exceptions only, in the order of their kinds - a page at a time.
        A kind or an open value no check can have matches none."""
        batch = self.get_object()
        found = legacy_checks(batch)
        kind = request.query_params.get("kind", "")
        if kind:
            found = [check for check in found if check.kind == kind]
        is_open = request.query_params.get("open", "")
        if is_open:
            found = [
                check
                for check in found
                if is_open in ("true", "false") and check.is_open == (is_open == "true")
            ]
        page: list[Any] | None = self.paginate_queryset(found)  # type: ignore[arg-type]
        assert page is not None
        return self.get_paginated_response(
            LegacyCheckSerializer(page, many=True).data,
        )

    @extend_schema(responses=LegacyChecksSummarySerializer)
    @action(
        detail=True,
        methods=["get"],
        url_path="checks/summary",
        filter_backends=[],
        pagination_class=None,
    )
    def checks_summary(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        """How many things there are to check, and how many are still open."""
        batch = self.get_object()
        counts = check_counts(legacy_checks(batch))
        return Response(
            LegacyChecksSummarySerializer(
                {
                    "checks": sum(total for total, _ in counts.values()),
                    "open": sum(still_open for _, still_open in counts.values()),
                    "kinds": [
                        {
                            "kind": kind,
                            "kind_display": CheckKind(kind).label,
                            "checks": total,
                            "open": still_open,
                        }
                        for kind, (total, still_open) in counts.items()
                    ],
                    "warnings": legacy_warnings(batch),
                },
            ).data,
        )

    @extend_schema(
        request=LegacyCheckDecisionSerializer,
        responses={200: LegacyCheckSerializer, 204: None},
    )
    @action(
        detail=True,
        methods=["post"],
        url_path="checks/resolve",
        filter_backends=[],
    )
    def resolve_check(
        self,
        request: Request,
        *args: object,
        **kwargs: object,
    ) -> Response:
        """Decide one check: a rank chosen, an outcome read, a row left out,
        or what is written kept. A later decision replaces an earlier one.
        Served back as it stands, or 204 when deciding it ended it (a row
        brought back that KukGrade already holds)."""
        batch = self.get_object()
        payload = LegacyCheckDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        check = resolve_legacy_check(batch, **payload.validated_data)
        if check is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(LegacyCheckSerializer(check).data)

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


# A row is named by its number in the file, which the schema could not read
# from a queryset built per request.
ROW_NUMBER = OpenApiParameter(
    "row_number",
    int,
    OpenApiParameter.PATH,
    description="The row's number in the file.",
)


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
    lookup_field = "row_number"
    lookup_value_regex = "[0-9]+"
    permission_map = {
        "list": ("data_imports.view_importbatch",),
        "retrieve": ("data_imports.view_importbatch",),
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
        boolean(
            "corrected",
            ~Q(correction={}),
            "Only rows with (or without) a fix of the importer's.",
        ),
        exact(
            "sheet",
            "raw__source_sheet",
            "A historical import's rows from this grading sheet, by its name.",
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

    @extend_schema(parameters=[ROW_NUMBER])
    def retrieve(self, request: Request, *args: object, **kwargs: object) -> Response:
        """One row by its number in the file: a row being fixed keeps its own
        page however its outcome changes."""
        return Response(self.get_serializer(self.get_object()).data)

    @extend_schema(
        parameters=[ROW_NUMBER],
        request=ImportRowCorrectionSerializer,
        responses=ImportRowSerializer,
    )
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

    @extend_schema(
        parameters=[ROW_NUMBER],
        request=ImportRowExclusionSerializer,
        responses=ImportRowSerializer,
    )
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
