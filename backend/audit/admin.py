from __future__ import annotations

from django.contrib import admin
from django.http import HttpRequest

from audit.models import AuditEvent


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ("occurred_at", "action", "entity_type", "entity_id", "actor")
    list_filter = ("action", "entity_type")
    search_fields = ("entity_id", "summary", "actor__email")
    ordering = ("-occurred_at", "-pk")
    list_select_related = ("actor",)
    readonly_fields = (
        "actor",
        "action",
        "entity_type",
        "entity_id",
        "occurred_at",
        "summary",
        "metadata",
    )

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(
        self,
        request: HttpRequest,
        obj: AuditEvent | None = None,
    ) -> bool:
        return False

    def has_delete_permission(
        self,
        request: HttpRequest,
        obj: AuditEvent | None = None,
    ) -> bool:
        return False
