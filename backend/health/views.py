from __future__ import annotations

from django.db import DatabaseError, connection
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response


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
