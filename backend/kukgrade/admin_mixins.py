"""Django admin building blocks shared across apps."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, cast

from django.contrib import admin, messages
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Model, QuerySet
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect

if TYPE_CHECKING:
    from accounts.models import User


class ReadOnlyCatalogueAdmin(admin.ModelAdmin):
    """Viewable, never editable, in admin as well as the API.

    Historical gradings keep their own snapshot of the syllabus, but a rank's
    name, order or active flag is read live (rank history, next-rank
    validation), and nothing here would be audited. Changes need a reviewed
    migration until syllabus versioning is designed.
    """

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


class ServiceDeleteMixin:
    """Admin deletes go through the model's own deletion service (KG-A14).

    The service takes its locks, re-checks its rule, records the deletion and
    deals with every dependent itself - reassigning or removing what Django's
    collector reports as protected, or as needing other models' delete
    permissions. So the confirmation page refuses on neither ground, exactly
    as the API does not, and a bulk delete is all or nothing.

    A service that refuses raises ValidationError, which admin would turn into
    a server error; it is shown as an error message instead, and nothing is
    deleted.
    """

    deletion_service: Any

    def get_deleted_objects(
        self,
        objs: Any,
        request: HttpRequest,
    ) -> tuple[Any, Any, Any, Any]:
        deleted, model_count, _perms, _protected = super().get_deleted_objects(  # type: ignore[misc]
            objs,
            request,
        )
        return deleted, model_count, set(), []

    def delete_model(self, request: HttpRequest, obj: Any) -> None:
        type(self).deletion_service(obj, actor=cast("User", request.user))

    def delete_queryset(self, request: HttpRequest, queryset: QuerySet[Any]) -> None:
        with transaction.atomic():
            for obj in queryset:
                self.delete_model(request, obj)

    def delete_view(
        self,
        request: HttpRequest,
        object_id: str,
        extra_context: dict[str, Any] | None = None,
    ) -> HttpResponse:
        try:
            return super().delete_view(request, object_id, extra_context)  # type: ignore[misc, no-any-return]
        except ValidationError as exc:
            self._refused(request, exc)
            return HttpResponseRedirect(request.get_full_path())

    def response_action(
        self,
        request: HttpRequest,
        queryset: QuerySet[Any],
    ) -> HttpResponse | None:
        # Django's delete action writes its "deleted" LogEntry rows before
        # calling delete_queryset, outside any transaction, so a refusal left
        # them claiming deletions that never happened. One transaction rolls
        # them back with it. (delete_view is already atomic.)
        try:
            with transaction.atomic():
                return super().response_action(request, queryset)  # type: ignore[misc, no-any-return]
        except ValidationError as exc:
            self._refused(request, exc)
            return HttpResponseRedirect(request.get_full_path())

    def _refused(self, request: HttpRequest, exc: ValidationError) -> None:
        self.message_user(  # type: ignore[attr-defined]
            request,
            " ".join(exc.messages),
            level=messages.ERROR,
        )
