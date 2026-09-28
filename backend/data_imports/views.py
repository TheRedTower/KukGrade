from __future__ import annotations

from typing import cast

from django.core.files.uploadedfile import UploadedFile
from django.db.models import QuerySet
from drf_spectacular.utils import PolymorphicProxySerializer, extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from accounts.models import User
from accounts.permissions import HasRequiredPermissions
from data_imports.models import ImportBatch
from data_imports.serializers import (
    ImportBatchCreatedSerializer,
    ImportBatchCreateSerializer,
    ImportBatchSerializer,
    LegacyImportPreviewSerializer,
    LegacyImportSerializer,
    StudentImportPreviewSerializer,
    StudentImportSerializer,
)
from data_imports.services import (
    cancel_import_batch,
    commit_legacy_grading_import,
    commit_student_import,
    create_import_batch,
    preview_legacy_grading_import,
    preview_student_import,
)

# Preview and commit take, and preview returns, a different shape per batch
# kind: a student roster's column mapping, or a legacy workbook's rank
# mappings.
_IMPORT_REQUEST = PolymorphicProxySerializer(
    component_name="ImportRequest",
    serializers=[StudentImportSerializer, LegacyImportSerializer],
    resource_type_field_name=None,
)
_IMPORT_PREVIEW = PolymorphicProxySerializer(
    component_name="ImportPreview",
    serializers=[StudentImportPreviewSerializer, LegacyImportPreviewSerializer],
    resource_type_field_name=None,
)


class ImportBatchViewSet(GenericViewSet):
    """Administrator-only bulk data import (import Decision 1).

    No `INSTRUCTOR_GROUP` permission is ever granted for this app - see
    `accounts.groups._DATA_IMPORT_PERMISSIONS`.
    """

    serializer_class = ImportBatchSerializer
    permission_classes = [HasRequiredPermissions]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_map = {
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

    @extend_schema(request=_IMPORT_REQUEST, responses=_IMPORT_PREVIEW)
    @action(detail=True, methods=["post"])
    def preview(self, request: Request, *args: object, **kwargs: object) -> Response:
        batch = self.get_object()

        if batch.kind == ImportBatch.Kind.LEGACY_GRADINGS:
            legacy_input = LegacyImportSerializer(data=request.data)
            legacy_input.is_valid(raise_exception=True)
            legacy_preview = preview_legacy_grading_import(
                batch,
                rank_mappings=legacy_input.validated_data.get("rank_mappings"),
            )
            return Response(LegacyImportPreviewSerializer(legacy_preview).data)

        input_serializer = StudentImportSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        preview = preview_student_import(
            batch,
            column_mapping=input_serializer.validated_data["column_mapping"],
            corrections=input_serializer.validated_data.get("corrections"),
        )
        return Response(StudentImportPreviewSerializer(preview).data)

    @extend_schema(request=_IMPORT_REQUEST, responses=ImportBatchSerializer)
    @action(detail=True, methods=["post"])
    def commit(self, request: Request, *args: object, **kwargs: object) -> Response:
        batch = self.get_object()

        if batch.kind == ImportBatch.Kind.LEGACY_GRADINGS:
            legacy_input = LegacyImportSerializer(data=request.data)
            legacy_input.is_valid(raise_exception=True)
            legacy_committed = commit_legacy_grading_import(
                batch,
                actor=cast(User, request.user),
                rank_mappings=legacy_input.validated_data.get("rank_mappings"),
            )
            serialized = ImportBatchSerializer(
                legacy_committed,
                context={"request": request},
            )
            return Response(serialized.data)

        input_serializer = StudentImportSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        committed = commit_student_import(
            batch,
            actor=cast(User, request.user),
            column_mapping=input_serializer.validated_data["column_mapping"],
            corrections=input_serializer.validated_data.get("corrections"),
        )
        return Response(
            ImportBatchSerializer(committed, context={"request": request}).data,
        )
