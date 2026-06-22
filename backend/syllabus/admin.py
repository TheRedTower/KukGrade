from __future__ import annotations

from django.contrib import admin

from syllabus.models import SyllabusItem, SyllabusRequirement


@admin.register(SyllabusItem)
class SyllabusItemAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "category", "active")
    list_filter = ("category", "active")
    search_fields = ("code", "name", "korean_name")
    ordering = ("category", "name", "code")


@admin.register(SyllabusRequirement)
class SyllabusRequirementAdmin(admin.ModelAdmin):
    list_display = (
        "rank",
        "age_band",
        "item",
        "display_range",
        "sequence",
        "required",
        "active",
    )
    list_filter = (
        "rank",
        "age_band",
        "item__category",
        "required",
        "active",
    )
    search_fields = ("item__code", "item__name")
    ordering = ("rank__order", "age_band", "sequence", "item__name")
    list_select_related = ("rank", "item")

    @admin.display(description="Range")
    def display_range(self, obj: SyllabusRequirement) -> str:
        return obj.display_range
