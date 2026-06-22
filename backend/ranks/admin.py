from __future__ import annotations

from django.contrib import admin

from ranks.models import Rank


@admin.register(Rank)
class RankAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "order", "category", "active")
    list_filter = ("category", "active")
    search_fields = ("name", "code")
    ordering = ("order",)
