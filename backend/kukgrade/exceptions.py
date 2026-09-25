"""A single error envelope for the whole API.

Every error response the API produces has the same shape:

    {"error": {"code": "...", "message": "...", "fields": {...}}}

`code` is stable and machine-readable, `message` is human-readable, and
`fields` is present only for validation errors. Previously three shapes
coexisted - a structured envelope for authentication and permission errors,
DRF's raw ``{"field": ["msg"]}`` for validation, and a bare ``{"detail": ...}``
elsewhere - which meant the frontend could not reach per-field messages at all
and every 400 degraded to a generic string.
"""

from __future__ import annotations

from typing import Any

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404, HttpRequest, JsonResponse
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler

# DRF's own default_code is used when an exception is not listed here. These
# overrides exist where DRF's code is unhelpfully generic ("invalid") or where
# the frontend already depends on the spelling.
ERROR_CODES: dict[type[Exception], str] = {
    exceptions.AuthenticationFailed: "authentication_failed",
    exceptions.NotAuthenticated: "authentication_required",
    exceptions.PermissionDenied: "permission_denied",
    exceptions.ValidationError: "validation_error",
}

GENERIC_VALIDATION_MESSAGE = "The request contained invalid data."
NON_FIELD_KEY = "non_field_errors"


def _stringify(value: Any) -> Any:
    """Convert DRF's ErrorDetail leaves to plain strings, keeping structure.

    Nested serializers produce nested dicts and lists; preserving that shape
    is lossless and lets a client address a nested field if it ever needs to.
    """
    if isinstance(value, dict):
        return {str(key): _stringify(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_stringify(item) for item in value]
    return str(value)


def _collect_messages(value: Any) -> list[str]:
    """Flatten every leaf message, for deciding whether there is only one."""
    if isinstance(value, dict):
        return [msg for item in value.values() for msg in _collect_messages(item)]
    if isinstance(value, list):
        return [msg for item in value for msg in _collect_messages(item)]
    return [str(value)]


def _error_code(exc: Exception) -> str:
    for exc_type, code in ERROR_CODES.items():
        if isinstance(exc, exc_type):
            return code
    default_code = getattr(exc, "default_code", None)
    return str(default_code) if default_code else "error"


def _validation_payload(detail: Any) -> dict[str, Any]:
    fields = (
        _stringify(detail)
        if isinstance(detail, dict)
        else {NON_FIELD_KEY: _stringify(detail)}
    )
    messages = _collect_messages(detail)
    # A single message is almost always a domain rule rather than a form
    # error, so surfacing it directly gives a usable toast. Several messages
    # belong against their fields, and the summary stays generic.
    message = messages[0] if len(messages) == 1 else GENERIC_VALIDATION_MESSAGE
    return {
        "error": {
            "code": "validation_error",
            "message": message,
            "fields": fields,
        },
    }


def _error_payload(code: str, message: str) -> dict[str, dict[str, Any]]:
    return {"error": {"code": code, "message": message}}


def _as_drf_validation_error(exc: DjangoValidationError) -> exceptions.ValidationError:
    """A domain-service ValidationError as DRF's, keeping its field keys."""
    if hasattr(exc, "message_dict"):
        return exceptions.ValidationError(exc.message_dict)
    return exceptions.ValidationError(exc.messages)


def custom_exception_handler(
    exc: Exception,
    context: dict[str, Any],
) -> Response | None:
    # Services raise Django's ValidationError so they stay usable from admin
    # and the shell. DRF's handler ignores it (it would become a 500), so it
    # is translated once here rather than in every view and serializer.
    if isinstance(exc, DjangoValidationError):
        exc = _as_drf_validation_error(exc)
    response = exception_handler(exc, context)
    if response is None:
        return None

    # DRF's handler translates these two into APIException equivalents for
    # the purpose of building the response, but the exception it hands us is
    # still the original, which carries no default_code. Without mirroring
    # the translation a 404 would be reported as the generic "error" code.
    if isinstance(exc, Http404):
        exc = exceptions.NotFound(*exc.args)
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied(*exc.args)

    if isinstance(exc, exceptions.ValidationError):
        response.data = _validation_payload(exc.detail)
        return response

    detail = getattr(exc, "detail", None)
    message = str(detail) if detail is not None else str(exc)
    response.data = _error_payload(_error_code(exc), message)
    return response


def csrf_failure(request: HttpRequest, reason: str = "") -> JsonResponse:
    return JsonResponse(
        _error_payload("csrf_failed", "CSRF verification failed."),
        status=status.HTTP_403_FORBIDDEN,
    )


def server_error(request: HttpRequest, *args: Any, **kwargs: Any) -> JsonResponse:
    """Handler500 for the project.

    An unhandled exception never reaches DRF's exception handler, so without
    this the API answers with Django's HTML error page. A browser client
    parsing it as JSON gets nothing usable and shows a blank screen, which is
    the worst possible presentation of "something broke".

    Deliberately says nothing about the cause: with DEBUG off the detail
    belongs in the logs, not in a response.
    """
    return JsonResponse(
        _error_payload(
            "server_error",
            "Something went wrong on the server. Please try again.",
        ),
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
