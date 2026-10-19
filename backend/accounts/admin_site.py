"""KukGrade's Django admin site: Django's own, with one door closed.

Changing your own password belongs to KukGrade's account menu - the one path
that asks for the current password, applies the policy, lifts a required
change and is audited (`accounts.services.change_own_password`). The admin
site's own password form did none of that, so it now points there instead.
"""

from __future__ import annotations

from typing import Any

from django.contrib.admin import AdminSite
from django.http import HttpRequest
from django.template.response import TemplateResponse

from accounts.services import OWN_PASSWORD_RESET_MESSAGE


def admin_notice(
    request: HttpRequest,
    *,
    title: str,
    message: str,
    status: int = 200,
    closed: bool = False,
) -> TemplateResponse:
    """A page of the admin site that only explains. `closed` hides the site's
    navigation, for an account that may not use the site yet, and offers
    signing out instead."""
    from django.contrib import admin

    context: dict[str, Any] = {
        **admin.site.each_context(request),
        "title": title,
        "message": message,
        "closed": closed,
    }
    if closed:
        context.update(has_permission=False, is_nav_sidebar_enabled=False)
    return TemplateResponse(
        request,
        "admin/kukgrade_notice.html",
        context,
        status=status,
    )


class KukGradeAdminSite(AdminSite):
    def password_change(
        self,
        request: HttpRequest,
        extra_context: dict[str, Any] | None = None,
    ) -> TemplateResponse:
        return admin_notice(
            request,
            title="Change your password",
            message=OWN_PASSWORD_RESET_MESSAGE,
        )
