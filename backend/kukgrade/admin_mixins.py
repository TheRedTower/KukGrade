"""Django admin building blocks shared across apps."""

from __future__ import annotations

from django.contrib import admin
from django.db.models import Model
from django.http import HttpRequest


class ViewOnlyAdmin(admin.ModelAdmin):
    """Viewable, never editable or deletable, in admin.

    Every change to grading and student data goes through the services, which
    lock, validate, audit and keep history intact. The emergency admin is for
    looking and for recovering accounts, not a second write path that has to
    be kept in step with them.
    """

    actions = None

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(
        self,
        request: HttpRequest,
        obj: Model | None = None,
    ) -> bool:
        return False

    def has_delete_permission(
        self,
        request: HttpRequest,
        obj: Model | None = None,
    ) -> bool:
        return False


class ReadOnlyCatalogueAdmin(ViewOnlyAdmin):
    """The rank and syllabus catalogue: viewable, never editable.

    Historical gradings keep their own snapshot of the syllabus, but a rank's
    name, order or active flag is read live (rank history, next-rank
    validation), and nothing here would be audited. Changes need a reviewed
    migration until syllabus versioning is designed.
    """
