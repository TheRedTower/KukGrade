from __future__ import annotations

from typing import cast

from django import forms
from django.contrib import admin
from django.contrib.auth import password_validation
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.contrib.auth.forms import ReadOnlyPasswordHashField
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import QuerySet
from django.forms import ModelForm
from django.http import HttpRequest, HttpResponse
from django.utils.translation import gettext_lazy as _

from accounts.models import DELETED_USER_PLACEHOLDER_EMAIL, User
from accounts.services import (
    create_platform_user,
    delete_platform_user,
    record_admin_password_change,
    set_admin_site_access,
    update_platform_user,
)
from kukgrade.admin_mixins import ServiceDeleteMixin


class UserCreationForm(forms.ModelForm):
    password1 = forms.CharField(label="Password", widget=forms.PasswordInput)
    password2 = forms.CharField(
        label="Password confirmation",
        widget=forms.PasswordInput,
    )

    class Meta:
        model = User
        fields = ("email", "first_name", "last_name", "role")

    def clean_password2(self) -> str:
        password1 = self.cleaned_data.get("password1")
        password2 = self.cleaned_data.get("password2")
        if password1 and password2 and password1 != password2:
            raise ValidationError(_("The two password fields did not match."))
        return str(password2)

    def _post_clean(self) -> None:
        # Same pattern Django's own UserCreationForm uses, and for the same
        # reason: self.instance only has email/first_name/last_name/role on
        # it after super()._post_clean() runs construct_instance(), so this
        # is the earliest point UserAttributeSimilarityValidator has
        # anything real to compare the password against. The API's
        # equivalent path (accounts/serializers.py) had the same gap.
        super()._post_clean()  # type: ignore[misc]
        password = self.cleaned_data.get("password2")
        if password:
            try:
                password_validation.validate_password(password, self.instance)
            except ValidationError as error:
                self.add_error("password2", error)

    def save(self, commit: bool = True) -> User:
        user = super().save(commit=False)
        user.set_password(self.cleaned_data["password1"])
        if commit:
            user.save()
            self.save_m2m()
        return cast(User, user)


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
                    "password1",
                    "password2",
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
            # The password typed here is temporary like any other an
            # administrator sets: it expires, and must be replaced.
            created = create_platform_user(
                email=obj.email,
                password=form.cleaned_data["password1"],
                first_name=obj.first_name,
                last_name=obj.last_name,
                role=obj.role,
                is_active=obj.is_active,
                actor=cast(User, request.user),
            ).user
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

    def user_change_password(
        self,
        request: HttpRequest,
        id: str,
        form_url: str = "",
    ) -> HttpResponse:
        # Django's form sets the password itself; the rest of an
        # administrator reset - the forced change and its audit event -
        # follows in the same transaction, as it does through the API.
        with transaction.atomic():
            stored = User.objects.filter(pk=id).values_list("password", flat=True)
            before = stored.first()
            response = super().user_change_password(request, id, form_url)
            target = User.objects.filter(pk=id).first()
            if target is not None and target.password != before:
                record_admin_password_change(target, actor=cast(User, request.user))
        return response

    def has_delete_permission(
        self,
        request: HttpRequest,
        obj: User | None = None,
    ) -> bool:
        if obj is not None and obj.pk == request.user.pk:
            return False
        return super().has_delete_permission(request, obj)
