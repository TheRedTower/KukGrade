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
        "is_active",
    )
    list_filter = ("is_active",)
    search_fields = ("wksa_id", "first_name", "last_name")
    ordering = ("last_name", "first_name", "wksa_id")
