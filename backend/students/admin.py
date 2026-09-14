from __future__ import annotations

from django.contrib import admin

from students.models import Student


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
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
