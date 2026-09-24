from __future__ import annotations

from typing import cast

from django.contrib import admin
from django.db.models import QuerySet
from django.http import HttpRequest

from accounts.models import User
from accounts.permissions import can_view_audit_log
from audit.models import AuditEvent, AuditEventQuerySet


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

    # The same rules as the API, from the same place: who may read the log
    # at all, and which events they may see in it.
    def _can_view_audit_log(self, request: HttpRequest) -> bool:
        user = request.user
        return isinstance(user, User) and can_view_audit_log(user)

    def get_queryset(self, request: HttpRequest) -> QuerySet[AuditEvent]:
        queryset = cast(AuditEventQuerySet, super().get_queryset(request))
        return queryset.visible_to(cast(User, request.user))

    def has_module_permission(self, request: HttpRequest) -> bool:
        return self._can_view_audit_log(request)

    def has_view_permission(
        self,
        request: HttpRequest,
        obj: AuditEvent | None = None,
    ) -> bool:
        return self._can_view_audit_log(request)

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
