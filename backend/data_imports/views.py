from __future__ import annotations

from typing import cast

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import UploadedFile
from django.db.models import QuerySet
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from accounts.models import User
from accounts.permissions import HasRequiredPermissions
from data_imports.models import ImportBatch
from data_imports.serializers import (
    ImportBatchCreateSerializer,
    ImportBatchSerializer,
    LegacyImportPreviewSerializer,
    LegacyImportRequestSerializer,
    StudentImportPreviewSerializer,
    StudentImportRequestSerializer,
)
from data_imports.services import (
    cancel_import_batch,
    commit_legacy_grading_import,
    commit_student_import,
    create_import_batch,
    preview_legacy_grading_import,
    preview_student_import,
)
from gradings.serializers import raise_drf_validation_error


class ImportBatchViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    GenericViewSet,
):
    """Administrator-only bulk data import (Decision 1 of the import spec).

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
        "preview": ("data_imports.view_importbatch",),
        "commit": ("data_imports.can_commit_import",),
    }

    def get_queryset(self) -> QuerySet[ImportBatch]:
        return ImportBatch.objects.select_related(
            "uploaded_by",
            "committed_by",
            "cancelled_by",
        ).order_by("-uploaded_at", "-pk")

    def create(self, request: Request, *args: object, **kwargs: object) -> Response:
        input_serializer = ImportBatchCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        try:
            result = create_import_batch(
                kind=input_serializer.validated_data["kind"],
                upload=cast(UploadedFile, input_serializer.validated_data["file"]),
                uploaded_by=cast(User, request.user),
            )
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)
        # Flattened onto the batch representation rather than a dedicated
        # response serializer: these three are one-shot creation-response
        # extras (a duplicate-hash warning, and the file's own headers so
        # the frontend can build a mapping step without a second request),
        # not persisted batch state, so they are intentionally outside
        # ImportBatchSerializer's OpenAPI-documented shape.
        payload = dict(
            ImportBatchSerializer(result.batch, context={"request": request}).data,
        )
        payload["already_imported_warning"] = result.already_imported_warning
        payload["detected_headers"] = result.detected_headers
        payload["suggested_mapping"] = result.suggested_mapping
        return Response(payload, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def cancel(self, request: Request, *args: object, **kwargs: object) -> Response:
        batch = self.get_object()
        try:
            cancel_import_batch(batch, actor=cast(User, request.user))
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def preview(self, request: Request, *args: object, **kwargs: object) -> Response:
        batch = self.get_object()

        if batch.kind == ImportBatch.Kind.LEGACY_GRADINGS:
            legacy_input = LegacyImportRequestSerializer(data=request.data)
            legacy_input.is_valid(raise_exception=True)
            try:
                legacy_preview = preview_legacy_grading_import(
                    batch,
                    rank_mappings=legacy_input.validated_data.get("rank_mappings"),
                )
            except DjangoValidationError as exc:
                raise_drf_validation_error(exc)
            return Response(LegacyImportPreviewSerializer(legacy_preview).data)

        input_serializer = StudentImportRequestSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        try:
            preview = preview_student_import(
                batch,
                column_mapping=input_serializer.validated_data["column_mapping"],
                corrections=input_serializer.validated_data.get("corrections"),
            )
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)
        return Response(StudentImportPreviewSerializer(preview).data)

    @action(detail=True, methods=["post"])
    def commit(self, request: Request, *args: object, **kwargs: object) -> Response:
        batch = self.get_object()

        if batch.kind == ImportBatch.Kind.LEGACY_GRADINGS:
            legacy_input = LegacyImportRequestSerializer(data=request.data)
            legacy_input.is_valid(raise_exception=True)
            try:
                legacy_committed = commit_legacy_grading_import(
                    batch,
                    actor=cast(User, request.user),
                    rank_mappings=legacy_input.validated_data.get("rank_mappings"),
                )
            except DjangoValidationError as exc:
                raise_drf_validation_error(exc)
            serialized = ImportBatchSerializer(
                legacy_committed,
                context={"request": request},
            )
            return Response(serialized.data)

        input_serializer = StudentImportRequestSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        try:
            committed = commit_student_import(
                batch,
                actor=cast(User, request.user),
                column_mapping=input_serializer.validated_data["column_mapping"],
                corrections=input_serializer.validated_data.get("corrections"),
            )
        except DjangoValidationError as exc:
            raise_drf_validation_error(exc)
        return Response(
            ImportBatchSerializer(committed, context={"request": request}).data,
        )
