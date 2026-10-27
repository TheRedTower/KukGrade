from __future__ import annotations

from typing import cast

from django.contrib import admin
from django.forms import ModelForm
from django.http import HttpRequest

from accounts.models import User
from kukgrade.admin_mixins import ServiceDeleteMixin
from students.models import (
    PreviousWksaId,
    RetiredWksaId,
    Student,
    StudentExtraInfo,
)
from students.services import create_student, delete_student, update_student


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
class StudentAdmin(ServiceDeleteMixin, admin.ModelAdmin):
    deletion_service = staticmethod(delete_student)
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

    def save_model(
        self,
        request: HttpRequest,
        obj: Student,
        form: ModelForm,
        change: bool,
    ) -> None:
        # Routed through the same services the API uses, so an admin-created
        # or admin-edited student is audited too, attributed to whoever is
        # signed into admin.
        if not change:
            created = create_student(
                wksa_id=obj.wksa_id,
                first_name=obj.first_name,
                last_name=obj.last_name,
                date_of_birth=obj.date_of_birth,
                current_rank=obj.current_rank,
                status=obj.status,
                actor=cast(User, request.user),
            )
            obj.pk = created.pk
            obj.refresh_from_db()
            return

        changed_data = set(form.changed_data)
        update_student(
            obj,
            wksa_id=obj.wksa_id if "wksa_id" in changed_data else None,
            first_name=obj.first_name if "first_name" in changed_data else None,
            last_name=obj.last_name if "last_name" in changed_data else None,
            date_of_birth=(
                obj.date_of_birth if "date_of_birth" in changed_data else None
            ),
            current_rank=obj.current_rank if "current_rank" in changed_data else None,
            status=obj.status if "status" in changed_data else None,
            actor=cast(User, request.user),
        )


@admin.register(RetiredWksaId)
class RetiredWksaIdAdmin(admin.ModelAdmin):
    """Read-only: the IDs of deleted students, kept from reuse."""

    list_display = ("wksa_id", "retired_at")
    search_fields = ("wksa_id",)

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(
        self,
        request: HttpRequest,
        obj: RetiredWksaId | None = None,
    ) -> bool:
        return False

    def has_delete_permission(
        self,
        request: HttpRequest,
        obj: RetiredWksaId | None = None,
    ) -> bool:
        return False
