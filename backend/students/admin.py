from __future__ import annotations

from typing import cast

from django.contrib import admin
from django.forms import ModelForm
from django.http import HttpRequest

from accounts.models import User
from kukgrade.admin_mixins import ServiceDeleteMixin
from students.models import Student
from students.services import create_student, delete_student, update_student


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
    search_fields = ("wksa_id", "first_name", "last_name")
    ordering = ("last_name", "first_name", "wksa_id")

    def get_readonly_fields(
        self,
        request: HttpRequest,
        obj: Student | None = None,
    ) -> tuple[str, ...]:
        # wksa_id is the external identifier grading records are matched
        # against - read-only after creation, here as everywhere else.
        if obj is None:
            return ()
        return ("wksa_id",)

    def save_model(
        self,
        request: HttpRequest,
        obj: Student,
        form: ModelForm,
        change: bool,
    ) -> None:
        # Routed through the same services the API uses, so an admin-created
        # or admin-edited student is audited too, attributed to whoever is
        # signed into admin (KG-036).
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
            first_name=obj.first_name if "first_name" in changed_data else None,
            last_name=obj.last_name if "last_name" in changed_data else None,
            date_of_birth=(
                obj.date_of_birth if "date_of_birth" in changed_data else None
            ),
            current_rank=obj.current_rank if "current_rank" in changed_data else None,
            status=obj.status if "status" in changed_data else None,
            actor=cast(User, request.user),
        )
