"""The shape every KukGrade gate shares: decided per request on the resolved
view's name, never its path, so a URL can move without opening a hole.

A gate runs in process_view, when the URL is resolved, and is applied to every
view at once: unlike a permission map, forgetting to declare it on a new view
would fail open and silently. A subclass says what it refuses (`refuse`);
everything it does not refuse goes on to the view.
"""

from __future__ import annotations

from collections.abc import Callable

from django.http import HttpRequest, HttpResponse, JsonResponse
from django.urls import ResolverMatch
from rest_framework import status

from kukgrade.exceptions import error_payload


def refused(code: str, message: str) -> JsonResponse:
    """A gate's API refusal: 403 with the project's error shape."""
    return JsonResponse(
        error_payload(code, message),
        status=status.HTTP_403_FORBIDDEN,
    )


class ViewNameGate:
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
        match = request.resolver_match
        if match is None:
            return None
        return self.refuse(request, match)

    def refuse(self, request: HttpRequest, match: ResolverMatch) -> HttpResponse | None:
        """The answer instead of the view, or None to let the request through."""
        raise NotImplementedError
