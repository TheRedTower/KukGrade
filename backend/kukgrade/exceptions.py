from __future__ import annotations

from typing import Any

from django.http import HttpRequest, JsonResponse
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler


def _error_payload(code: str, message: str) -> dict[str, dict[str, str]]:
    return {"error": {"code": code, "message": message}}


def custom_exception_handler(
    exc: Exception,
    context: dict[str, Any],
) -> Response | None:
    response = exception_handler(exc, context)
    if response is None:
        return None

    if isinstance(exc, exceptions.AuthenticationFailed):
        response.data = _error_payload("authentication_failed", str(exc.detail))
    elif isinstance(exc, exceptions.NotAuthenticated):
        response.data = _error_payload("authentication_required", str(exc.detail))
    elif isinstance(exc, exceptions.PermissionDenied):
        response.data = _error_payload("permission_denied", str(exc.detail))

    return response


def csrf_failure(request: HttpRequest, reason: str = "") -> JsonResponse:
    return JsonResponse(
        _error_payload("csrf_failed", "CSRF verification failed."),
        status=status.HTTP_403_FORBIDDEN,
    )
