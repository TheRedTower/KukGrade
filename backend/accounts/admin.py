from __future__ import annotations

from typing import cast

from django import forms
from django.contrib import admin
from django.contrib.admin.utils import unquote
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.contrib.auth.forms import ReadOnlyPasswordHashField
from django.core.exceptions import PermissionDenied
from django.db.models import QuerySet
from django.forms import ModelForm
from django.http import Http404, HttpRequest, HttpResponse
from django.template.response import TemplateResponse
from django.utils.cache import add_never_cache_headers
from django.utils.translation import gettext_lazy as _

from accounts.admin_site import admin_notice
from accounts.models import DELETED_USER_PLACEHOLDER_EMAIL, User
from accounts.services import (
    OWN_PASSWORD_RESET_MESSAGE,
    TemporaryPassword,
    create_platform_user,
    delete_platform_user,
    reset_password,
    set_admin_site_access,
    update_platform_user,
)
from kukgrade.admin_mixins import ServiceDeleteMixin

# Where save_model leaves the password it just issued for response_add to
# show: the request, never the ModelAdmin, which every request shares.
ISSUED_PASSWORD_ATTR = "_kukgrade_issued_password"


class UserCreationForm(forms.ModelForm):
    """Django admin's add-user form. No password: as in the app, one is
    generated when the account is saved and shown once (UserAdmin.response_add).
    """

    class Meta:
        model = User
        fields = ("email", "first_name", "last_name", "role")


class UserChangeForm(forms.ModelForm):
    password = ReadOnlyPasswordHashField()

    class Meta:
        model = User
        fields = (
            "email",
            "password",
            "first_name",
            "last_name",
            "role",
            "is_active",
            "is_staff",
            "is_superuser",
            "groups",
            "user_permissions",
            "last_login",
            "date_joined",
        )


@admin.register(User)
class UserAdmin(ServiceDeleteMixin, DjangoUserAdmin):
    deletion_service = staticmethod(delete_platform_user)
    form = UserChangeForm
    add_form = UserCreationForm
    # Django's own add-user template asks for a password, which this form has
    # none of.
    add_form_template = "admin/change_form.html"
    model = User
    list_display = (
        "email",
        "first_name",
        "last_name",
        "role",
        "is_staff",
        "is_active",
    )
    list_filter = (
        "role",
        "is_staff",
        "is_superuser",
        "is_active",
        "groups",
    )
    search_fields = ("email", "first_name", "last_name")
    ordering = ("email",)
    # Groups follow the role, and per-user permissions are Master authority,
    # granted in the app through set_user_authority() and its rules - never
    # edited here, where they would skip both the rules and the audit
    # (KG-A14). The two dates are Django's bookkeeping, and the password
    # state follows whoever last set the password.
    readonly_fields = (
        "groups",
        "user_permissions",
        "must_change_password",
        "temporary_password_expires_at",
        "last_login",
        "date_joined",
    )

    def get_queryset(self, request: HttpRequest) -> QuerySet[User]:
        # Internal bookkeeping, not an account anyone administers.
        return (
            super()
            .get_queryset(request)
            .exclude(
                email=DELETED_USER_PLACEHOLDER_EMAIL,
            )
        )

    fieldsets = (
        (
            None,
            {
                "fields": (
                    "email",
                    "password",
                    "must_change_password",
                    "temporary_password_expires_at",
                ),
            },
        ),
        (_("Personal info"), {"fields": ("first_name", "last_name")}),
        (
            _("KukGrade access"),
            {"fields": ("role",)},
        ),
        (
            _("Django permissions"),
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                ),
            },
        ),
        (_("Important dates"), {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "email",
                    "first_name",
                    "last_name",
                    "role",
                    "is_staff",
                    "is_superuser",
                    "is_active",
                ),
            },
        ),
    )

    def save_model(
        self,
        request: HttpRequest,
        obj: User,
        form: ModelForm,
        change: bool,
    ) -> None:
        # Routed through the same services the API uses, so an admin-created
        # or admin-edited user is audited too, attributed to whoever is
        # signed into admin (KG-036). is_staff/is_superuser stay a direct
        # admin capability - create_platform_user() deliberately refuses
        # them, the same way the API does, so they are applied as an
        # explicit second step on create rather than routed through it.
        if not change:
            issued = create_platform_user(
                email=obj.email,
                first_name=obj.first_name,
                last_name=obj.last_name,
                role=obj.role,
                is_active=obj.is_active,
                actor=cast(User, request.user),
            )
            setattr(request, ISSUED_PASSWORD_ATTR, issued)
            created = issued.user
            set_admin_site_access(
                created,
                actor=cast(User, request.user),
                is_staff=obj.is_staff,
                is_superuser=obj.is_superuser,
            )
            obj.pk = created.pk
            obj.refresh_from_db()
            return

        changed_data = set(form.changed_data)
        update_platform_user(
            obj,
            email=obj.email if "email" in changed_data else None,
            first_name=obj.first_name if "first_name" in changed_data else None,
            last_name=obj.last_name if "last_name" in changed_data else None,
            role=obj.role if "role" in changed_data else None,
            is_active=obj.is_active if "is_active" in changed_data else None,
            actor=cast(User, request.user),
        )
        # Admin site access is Django admin's own, so it has its own audited
        # service; each is sent only when the form changed it, never by
        # saving this form's copy whole over what the service just wrote.
        set_admin_site_access(
            obj,
            actor=cast(User, request.user),
            is_staff=obj.is_staff if "is_staff" in changed_data else None,
            is_superuser=obj.is_superuser if "is_superuser" in changed_data else None,
        )
        obj.refresh_from_db()

    def response_add(
        self,
        request: HttpRequest,
        obj: User,
        post_url_continue: str | None = None,
    ) -> HttpResponse:
        issued: TemporaryPassword = getattr(request, ISSUED_PASSWORD_ATTR)
        return self._temporary_password_page(request, issued.user, issued)

    def user_change_password(
        self,
        request: HttpRequest,
        id: str,
        form_url: str = "",
    ) -> HttpResponse:
        """A reset, as in the app: confirm, then a generated temporary
        password shown once. Nobody types another person's password here, and
        your own is changed in KukGrade's account menu instead."""
        target = self.get_object(request, unquote(id))
        if not self.has_change_permission(request, target):
            raise PermissionDenied
        if target is None:
            raise Http404
        if target.pk == request.user.pk:
            return admin_notice(
                request,
                title="Change your password",
                message=OWN_PASSWORD_RESET_MESSAGE,
            )
        if request.method != "POST":
            return self._temporary_password_page(request, target, None)
        issued = reset_password(target, actor=cast(User, request.user))
        return self._temporary_password_page(request, issued.user, issued)

    def _temporary_password_page(
        self,
        request: HttpRequest,
        user: User,
        issued: TemporaryPassword | None,
    ) -> HttpResponse:
        """Confirming a reset, or - with `issued` - the password just issued,
        shown this once and never cached."""
        response = TemplateResponse(
            request,
            "admin/accounts/user/temporary_password.html",
            {
                **self.admin_site.each_context(request),
                "title": "Temporary password" if issued else "Reset password",
                "opts": self.opts,
                "original": user,
                "issued": issued,
            },
        )
        add_never_cache_headers(response)
        return response

    def has_delete_permission(
        self,
        request: HttpRequest,
        obj: User | None = None,
    ) -> bool:
        if obj is not None and obj.pk == request.user.pk:
            return False
        return super().has_delete_permission(request, obj)
