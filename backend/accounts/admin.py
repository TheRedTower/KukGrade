from __future__ import annotations

from typing import cast

from django import forms
from django.contrib import admin
from django.contrib.auth import password_validation
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.contrib.auth.forms import ReadOnlyPasswordHashField
from django.core.exceptions import ValidationError
from django.forms import ModelForm
from django.http import HttpRequest
from django.utils.translation import gettext_lazy as _

from accounts.models import User
from accounts.services import create_platform_user, update_platform_user


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
class UserAdmin(DjangoUserAdmin):
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
    fieldsets = (
        (None, {"fields": ("email", "password")}),
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
            created = create_platform_user(
                email=obj.email,
                password=form.cleaned_data["password1"],
                first_name=obj.first_name,
                last_name=obj.last_name,
                role=obj.role,
                is_active=obj.is_active,
                actor=cast(User, request.user),
            )
            if obj.is_staff or obj.is_superuser:
                created.is_staff = obj.is_staff
                created.is_superuser = obj.is_superuser
                created.save(update_fields=["is_staff", "is_superuser"])
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
