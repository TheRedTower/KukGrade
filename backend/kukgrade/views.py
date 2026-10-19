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

from accounts.password_policy import policy as password_policy


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


_PASSWORD_POLICY = inline_serializer(
    "PasswordPolicy",
    fields={
        "min_length": serializers.IntegerField(),
        "max_length": serializers.IntegerField(),
        "character_rules": inline_serializer(
            "PasswordCharacterRule",
            fields={
                "code": serializers.CharField(),
                "label": serializers.CharField(),
                "pattern": serializers.CharField(
                    help_text="A regular expression the password must match.",
                ),
            },
            many=True,
        ),
        "checked_on_save": serializers.ListField(
            child=serializers.CharField(),
            help_text="Rules only the server can check, run when it is saved.",
        ),
    },
)


@extend_schema(
    responses=inline_serializer(
        "SiteSettings",
        fields={
            "club_name": serializers.CharField(),
            "password_policy": _PASSWORD_POLICY,
        },
    ),
)
@api_view(["GET"])
@permission_classes([AllowAny])
def site_settings(_request: Request) -> Response:
    """Deployment settings the frontend shows, such as the club's name.

    Public, like the health check: the sign-in screen may show them too, and
    nothing here is personal data. The password policy is the one the server
    enforces (accounts/password_policy.py), served so the screens never keep
    a copy of their own.
    """
    return Response(
        {"club_name": settings.CLUB_NAME, "password_policy": password_policy()},
    )
