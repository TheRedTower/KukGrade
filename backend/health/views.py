from __future__ import annotations

from django.db import DatabaseError, connection
from django.http import Http404
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

_LOOPBACK = {"127.0.0.1", "::1"}


@extend_schema(
    responses=inline_serializer(
        "HealthResponse",
        fields={
            "service": serializers.CharField(),
            "status": serializers.CharField(),
        },
    ),
)
@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(_request: Request) -> Response:
    return Response({"service": "kukgrade-backend", "status": "ok"})


def database_reachable() -> bool:
    """Whether the database answers a trivial query."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except DatabaseError:
        return False
    return True


@extend_schema(
    responses=inline_serializer(
        "ReadinessResponse",
        fields={"status": serializers.CharField()},
    ),
)
@api_view(["GET"])
@permission_classes([AllowAny])
def readiness_check(request: Request) -> Response:
    # Only the deployment's own health check asks (from loopback, with no
    # forwarded address). Anyone else gets the same 404 as an unknown path:
    # whether the database is up is not for the public.
    if (
        request.META.get("REMOTE_ADDR") not in _LOOPBACK
        or "HTTP_X_FORWARDED_FOR" in request.META
    ):
        raise Http404
    if not database_reachable():
        return Response({"status": "unavailable"}, status=503)
    return Response({"status": "ok"})
