"""Enforce a required password change before an account may do anything else.

`must_change_password` is set whenever somebody other than the owner chose an
account's password: creation, and an administrator reset. Until the owner picks
their own, the account is not provably theirs, so it may do nothing but read
who it is, set a new password, and sign out.

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
        "readiness-check",
        "site-settings",
    },
)

# Django admin is deliberately outside this gate. `is_staff` is not grantable
# through KukGrade at all (see accounts/serializers.py), and admin carries its
# own password-change flow which does not clear this flag - so gating admin
# would strand a staff account with no way back. Closing that surface means
# changing admin's password flow too, which belongs in its own change.
ADMIN_NAMESPACE = "admin"

PASSWORD_CHANGE_REQUIRED_CODE = "password_change_required"
PASSWORD_CHANGE_REQUIRED_MESSAGE = (
    "Your password must be changed before you can use KukGrade."
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
        if match is None or match.namespace == ADMIN_NAMESPACE:
            return None
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
    "ADMIN_NAMESPACE",
    "EXEMPT_URL_NAMES",
    "PASSWORD_CHANGE_REQUIRED_CODE",
    "PASSWORD_CHANGE_REQUIRED_MESSAGE",
    "ForcePasswordChangeMiddleware",
]
