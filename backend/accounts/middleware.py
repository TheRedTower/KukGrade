"""Enforce a required password change before an account may do anything else.

`must_change_password` is set whenever somebody other than the owner chose an
account's password: creation, and an administrator reset. Until the owner picks
their own, the account is not provably theirs, so it may do nothing but read
who it is, set a new password, and sign out - in the API and the Django admin
site alike.

The frontend already refuses to route anywhere else while the flag is set, but
that is presentation - a direct API call bypassed it entirely. This is the rule
itself. It is applied to every view at once rather than declared per view,
because unlike the permission map (see `accounts/permissions.py`) forgetting to
declare it would fail open and silently.

Exempt views are named, never path-matched, so a URL can move without opening a
hole; a renamed URL closes the exemption instead, which is the safe direction.

This reads the session user that `AuthenticationMiddleware` established, which
is the whole of the API's authentication today (see REST_FRAMEWORK's
`DEFAULT_AUTHENTICATION_CLASSES`). Adding a second authentication class - a
token, say - would authenticate inside the view, after this runs, and would not
be gated here. Whoever adds one has to bring the gate with it.
"""

from __future__ import annotations

from collections.abc import Callable

from django.http import HttpRequest, HttpResponse, JsonResponse
from rest_framework import status

from accounts.admin_site import admin_notice
from accounts.models import User
from kukgrade.exceptions import error_payload

# Signing out, learning that the change is required, and making it. Nothing
# else: these are exactly the views that let the owner take the account back.
# The SPA shell is here too, since the change-password screen is served by it.
EXEMPT_URL_NAMES = frozenset(
    {
        "auth-login",
        "auth-logout",
        "auth-me",
        "auth-change-password",
        "frontend",
        "health-check",
        "site-settings",
    },
)

# The Django admin site is closed too, but answered with a page rather than
# JSON, and signing out stays open. The way back is KukGrade's own
# change-password screen: the admin site has no password form of its own for
# your account (accounts/admin_site.py).
ADMIN_NAMESPACE = "admin"
ADMIN_EXEMPT_URL_NAMES = frozenset({"logout"})

PASSWORD_CHANGE_REQUIRED_CODE = "password_change_required"
PASSWORD_CHANGE_REQUIRED_MESSAGE = (
    "Your password must be changed before you can use KukGrade."
)
ADMIN_PASSWORD_CHANGE_REQUIRED_MESSAGE = (
    "Your password must be changed before you can use the admin site. Open "
    "KukGrade to choose a new one, then come back."
)


class ForcePasswordChangeMiddleware:
    def __init__(
        self,
        get_response: Callable[[HttpRequest], HttpResponse],
    ) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        return self.get_response(request)

    def process_view(
        self,
        request: HttpRequest,
        view_func: Callable[..., HttpResponse],
        view_args: tuple[object, ...],
        view_kwargs: dict[str, object],
    ) -> HttpResponse | None:
        # process_view rather than __call__: the URL is resolved by now, so
        # the exemption can be decided on the view's name instead of its path.
        user = getattr(request, "user", None)
        if not isinstance(user, User) or not user.must_change_password:
            return None

        match = request.resolver_match
        if match is None:
            return None
        if match.namespace == ADMIN_NAMESPACE:
            if match.url_name in ADMIN_EXEMPT_URL_NAMES:
                return None
            return admin_notice(
                request,
                title="Change your password",
                message=ADMIN_PASSWORD_CHANGE_REQUIRED_MESSAGE,
                status=status.HTTP_403_FORBIDDEN,
                closed=True,
            )
        if match.url_name in EXEMPT_URL_NAMES:
            return None

        return JsonResponse(
            error_payload(
                PASSWORD_CHANGE_REQUIRED_CODE,
                PASSWORD_CHANGE_REQUIRED_MESSAGE,
            ),
            status=status.HTTP_403_FORBIDDEN,
        )


__all__ = [
    "ADMIN_EXEMPT_URL_NAMES",
    "ADMIN_NAMESPACE",
    "ADMIN_PASSWORD_CHANGE_REQUIRED_MESSAGE",
    "EXEMPT_URL_NAMES",
    "PASSWORD_CHANGE_REQUIRED_CODE",
    "PASSWORD_CHANGE_REQUIRED_MESSAGE",
    "ForcePasswordChangeMiddleware",
]
