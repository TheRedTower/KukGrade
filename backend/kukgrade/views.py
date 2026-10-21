"""The built frontend for browser routes Django does not own, the site
settings every screen shares, and what is running (About)."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import PurePosixPath

from django.conf import settings
from django.http import Http404, HttpRequest, HttpResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

from accounts.password_policy import policy as password_policy
from health.views import database_reachable
from kukgrade.version import VERSION
from students import wksa_ids


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


# The response is rendered through these, so the schema they declare is the
# shape actually served: no key can be served undeclared, or declared unserved.
class PasswordCharacterRuleSerializer(serializers.Serializer):
    code = serializers.CharField()
    # DRF lifts declared fields off the class, so this does not replace
    # Field.label at runtime; the stubs cannot know that.
    label = serializers.CharField()  # type: ignore[assignment]
    pattern = serializers.CharField(
        help_text="A regular expression the password must match.",
    )


class PasswordPolicySerializer(serializers.Serializer):
    min_length = serializers.IntegerField()
    max_length = serializers.IntegerField()
    character_rules = PasswordCharacterRuleSerializer(many=True)
    checked_on_save = serializers.ListField(
        child=serializers.CharField(),
        help_text="Rules only the server can check, run when it is saved.",
    )


class WksaIdFormSerializer(serializers.Serializer):
    code = serializers.CharField()
    # As on PasswordCharacterRuleSerializer.
    label = serializers.CharField()  # type: ignore[assignment]
    pattern = serializers.CharField(
        help_text="A regular expression the whole ID must match.",
    )
    example = serializers.CharField()


class WksaIdSchemeSerializer(serializers.Serializer):
    hint = serializers.CharField(
        help_text="The rule in a sentence, as a refused ID is told it.",
    )
    forms = WksaIdFormSerializer(many=True)


class SiteSettingsSerializer(serializers.Serializer):
    club_name = serializers.CharField()
    time_zone = serializers.CharField(
        help_text=(
            "The club's time zone (an IANA name). Times are shown in it, and "
            "'today' is today there."
        ),
    )
    password_policy = PasswordPolicySerializer()
    wksa_id = WksaIdSchemeSerializer()


@extend_schema(responses=SiteSettingsSerializer)
@api_view(["GET"])
@permission_classes([AllowAny])
def site_settings(_request: Request) -> Response:
    """Deployment settings the frontend shows, such as the club's name and
    time zone (TZ).

    Public, like the health check: the sign-in screen may show them too, and
    nothing here is personal data. The password policy and the WKSA ID forms
    are the ones the server enforces (accounts/password_policy.py,
    students/wksa_ids.py), served so the screens never keep a copy of their
    own.
    """
    return Response(
        SiteSettingsSerializer(
            {
                "club_name": settings.CLUB_NAME,
                "time_zone": settings.TIME_ZONE,
                "password_policy": password_policy(),
                "wksa_id": wksa_ids.described(),
            },
        ).data,
    )


class AboutSerializer(serializers.Serializer):
    version = serializers.CharField(help_text="The version of KukGrade running.")
    commit = serializers.CharField(
        help_text="The commit it was built from; blank when run from a checkout.",
    )
    built_at = serializers.DateTimeField(
        allow_null=True,
        help_text="When it was built; null when run from a checkout.",
    )
    time_zone = serializers.CharField(help_text="The club's time zone.")
    database = serializers.ChoiceField(
        choices=["ok", "unavailable"],
        help_text="Whether the database answers right now.",
    )


def _build_time() -> datetime | None:
    """When the image was built; a time given without a zone is taken as UTC,
    as `date -u` writes it (docs/deployment.md)."""
    if not settings.BUILD_TIME:
        return None
    built = datetime.fromisoformat(settings.BUILD_TIME)
    return built if built.tzinfo else built.replace(tzinfo=UTC)


@extend_schema(responses=AboutSerializer)
@api_view(["GET"])
def about(_request: Request) -> Response:
    """What is running: the About page, and what to quote when asking for help.

    For anyone signed in. Nothing here is personal data, but a build's exact
    version and commit are more than the sign-in page needs to show.
    """
    return Response(
        AboutSerializer(
            {
                "version": VERSION,
                "commit": settings.BUILD_COMMIT,
                "built_at": _build_time(),
                "time_zone": settings.TIME_ZONE,
                "database": "ok" if database_reachable() else "unavailable",
            },
        ).data,
    )
