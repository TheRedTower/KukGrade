from __future__ import annotations

from django.contrib import admin
from django.http import HttpRequest

from accounts.models import User
from accounts.permissions import FINAL_GRADING_DECISION_PERMISSION
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

    def _can_view_audit_log(self, request: HttpRequest) -> bool:
        # Same rule as the API's CanViewAuditLog: administrator or Master
        # authority, not every instructor - kept here rather than delegated
        # to a Django permission, since no group carries view_auditevent.
        user = request.user
        if not isinstance(user, User) or not user.is_active:
            return False
        return user.role == User.Role.ADMINISTRATOR or user.has_perm(
            FINAL_GRADING_DECISION_PERMISSION
        )

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
