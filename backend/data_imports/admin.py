"""Read-only support/debug surface, not the product workflow.

No add/change/delete here - the source file holds personal data and the
batch lifecycle is service-owned (`data_imports.services`), so ordinary Admin
CRUD would bypass validation, audit recording and temp-file cleanup.
"""

from __future__ import annotations

from django.contrib import admin

from data_imports.models import ImportBatch
from kukgrade.admin_mixins import ViewOnlyAdmin


@admin.register(ImportBatch)
class ImportBatchAdmin(ViewOnlyAdmin):
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
    exclude = ("source_file",)
