"""The built frontend for browser routes Django does not own, and the site
settings every screen shares."""

from __future__ import annotations

from pathlib import PurePosixPath

from django.conf import settings
from django.http import Http404, HttpRequest, HttpResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response


@require_safe
@never_cache
def frontend(_request: HttpRequest, path: str = "") -> HttpResponse:
    # A missing asset should remain a 404, not return HTML with status 200.
    if "." in PurePosixPath(path).name:
        raise Http404

    index = settings.FRONTEND_DIST / "index.html"
    if not index.is_file():
        raise Http404
    return HttpResponse(index.read_text(encoding="utf-8"), content_type="text/html")


@extend_schema(
    responses=inline_serializer(
        "SiteSettings",
        fields={"club_name": serializers.CharField()},
    ),
)
@api_view(["GET"])
@permission_classes([AllowAny])
def site_settings(_request: Request) -> Response:
    """Deployment settings the frontend shows, such as the club's name.

    Public, like the health check: the sign-in screen may show them too, and
    nothing here is personal data.
    """
    return Response({"club_name": settings.CLUB_NAME})
