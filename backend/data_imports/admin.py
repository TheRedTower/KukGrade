"""Read-only support/debug surface, not the product workflow.

No add/change/delete here - the source file holds personal data and the
batch lifecycle is service-owned (`data_imports.services`), so ordinary Admin
CRUD would bypass validation, audit recording and temp-file cleanup.
"""

from __future__ import annotations

from django.contrib import admin
from django.http import HttpRequest

from data_imports.models import ImportBatch


@admin.register(ImportBatch)
class ImportBatchAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "kind",
        "status",
        "original_filename",
        "uploaded_by",
        "uploaded_at",
        "committed_at",
    )
    list_filter = ("kind", "status")
    search_fields = ("original_filename", "sha256", "uploaded_by__email")
    ordering = ("-uploaded_at", "-pk")
    list_select_related = ("uploaded_by", "committed_by", "cancelled_by")
    readonly_fields = tuple(
        field.name
        for field in ImportBatch._meta.fields
        if field.name not in {"id", "source_file"}
    )
    exclude = ("source_file",)

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(
        self,
        request: HttpRequest,
        obj: ImportBatch | None = None,
    ) -> bool:
        return False

    def has_delete_permission(
        self,
        request: HttpRequest,
        obj: ImportBatch | None = None,
    ) -> bool:
        return False
