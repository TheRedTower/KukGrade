from __future__ import annotations

from django.contrib import admin
from django.http import HttpRequest

from kukgrade.admin_mixins import ViewOnlyAdmin
from students.models import (
    PreviousWksaId,
    RetiredWksaId,
    Student,
    StudentExtraInfo,
)


class PreviousWksaIdInline(admin.TabularInline):
    """Read-only: written only when an ID is replaced (students/services.py)."""

    model = PreviousWksaId
    extra = 0
    can_delete = False
    fields = ("wksa_id", "replaced_at")
    readonly_fields = fields

    def has_add_permission(
        self, request: HttpRequest, obj: Student | None = None
    ) -> bool:
        return False


class StudentExtraInfoInline(admin.TabularInline):
    """Read-only: what an import kept that KukGrade has no field for."""

    model = StudentExtraInfo
    extra = 0
    can_delete = False
    fields = ("label", "value", "source_import", "added_at")
    readonly_fields = fields

    def has_add_permission(
        self, request: HttpRequest, obj: Student | None = None
    ) -> bool:
        return False


@admin.register(Student)
class StudentAdmin(ViewOnlyAdmin):
    list_display = (
        "wksa_id",
        "first_name",
        "last_name",
        "date_of_birth",
        "current_rank",
        "status",
    )
    list_filter = ("current_rank", "status")
    search_fields = (
        "wksa_id",
        "previous_wksa_ids__wksa_id",
        "first_name",
        "last_name",
    )
    inlines = (PreviousWksaIdInline, StudentExtraInfoInline)
    ordering = ("last_name", "first_name", "wksa_id")


@admin.register(RetiredWksaId)
class RetiredWksaIdAdmin(ViewOnlyAdmin):
    """The IDs of deleted students, kept from reuse."""

    list_display = ("wksa_id", "retired_at")
    search_fields = ("wksa_id",)
