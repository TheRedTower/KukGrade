"""Shared test helper for granting a per-user permission."""

from __future__ import annotations

from django.contrib.auth.models import Permission

from accounts.models import User


def grant_permission(user: User, dotted_permission: str) -> User:
    app_label, codename = dotted_permission.split(".")
    user.user_permissions.add(
        Permission.objects.get(content_type__app_label=app_label, codename=codename),
    )
    return User.objects.get(pk=user.pk)
