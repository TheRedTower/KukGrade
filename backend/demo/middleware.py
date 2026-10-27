"""Keep the demo's shared accounts and its server safe from its visitors.

Everything else is fully live: that is the point of the demo. What is closed is
what would hurt the other people using it, or outlive the next reset:

- changing a password signs every other browser out of that account;
- the accounts themselves (names, permissions, new staff) are not reset;
- uploads put files from strangers on the server.

Applied to every view at once and decided on the view's name, like
`accounts.middleware.ForcePasswordChangeMiddleware`, so a new endpoint is not
silently left open: the rule is "any change under these names".
"""

from __future__ import annotations

from collections.abc import Callable

from django.conf import settings
from django.http import HttpRequest, HttpResponse, JsonResponse
from rest_framework import status

from kukgrade.exceptions import error_payload

DEMO_MODE_CODE = "demo_mode"
DEMO_MODE_MESSAGE = "This is not available in the demo."

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
CLOSED_URL_NAMES = frozenset({"auth-change-password", "auth-me"})
CLOSED_URL_PREFIXES = ("user-", "import-batch-")


class DemoModeMiddleware:
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
        if not settings.DEMO_MODE or request.method in SAFE_METHODS:
            return None
        match = request.resolver_match
        name = match.url_name if match is not None else None
        if name is None:
            return None
        if name in CLOSED_URL_NAMES or name.startswith(CLOSED_URL_PREFIXES):
            return JsonResponse(
                error_payload(DEMO_MODE_CODE, DEMO_MODE_MESSAGE),
                status=status.HTTP_403_FORBIDDEN,
            )
        return None
