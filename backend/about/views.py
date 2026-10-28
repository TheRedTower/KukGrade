"""What is running, who made it, and the documents that say on what terms."""

from __future__ import annotations

import json
from datetime import UTC, datetime

from django.conf import settings
from django.http import FileResponse, Http404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from about import project
from about.credits import CREDITS_FILE, NOTICES_FILE
from about.documents import read_document, read_pledge
from about.serializers import (
    AboutSerializer,
    CreditsSerializer,
    DocumentSerializer,
    PledgeSerializer,
)
from accounts.models import User
from health.views import database_reachable
from kukgrade.version import VERSION


def _build_time() -> datetime | None:
    """When the image was built; a time given without a zone is taken as UTC,
    as `date -u` writes it (docs/installation.md)."""
    if not settings.BUILD_TIME:
        return None
    built = datetime.fromisoformat(settings.BUILD_TIME)
    return built if built.tzinfo else built.replace(tzinfo=UTC)


@extend_schema(responses=AboutSerializer)
@api_view(["GET"])
def about(request: Request) -> Response:
    """What is running: the About page, and what to quote when asking for help.

    For anyone signed in. Nothing here is personal data, but a build's exact
    version and commit are more than the sign-in page needs to show. The
    school's own settings are added for administrators only.
    """
    data: dict[str, object] = {
        "version": VERSION,
        "commit": settings.BUILD_COMMIT,
        "built_at": _build_time(),
        "time_zone": settings.TIME_ZONE,
        "database": "ok" if database_reachable() else "unavailable",
        "repository_url": project.REPOSITORY_URL,
        "issues_url": project.ISSUES_URL,
        "releases_url": project.RELEASES_URL,
        "support_email": project.SUPPORT_EMAIL,
        "security_email": project.SECURITY_EMAIL,
        "licence": project.LICENCE_ID,
        "copyright": project.COPYRIGHT_NOTICE,
    }
    user = request.user
    if isinstance(user, User) and user.role == User.Role.ADMINISTRATOR:
        data["school"] = {
            "club_name": settings.CLUB_NAME,
            "school_id_prefix": settings.SCHOOL_ID_PREFIX,
        }
    return Response(AboutSerializer(data).data)


@extend_schema(responses=DocumentSerializer)
@api_view(["GET"])
def document(_request: Request, slug: str) -> Response:
    """One of the project's own documents: the licence, the code of conduct or
    the security policy, read from the file the repository holds."""
    return Response(DocumentSerializer(read_document(slug)).data)


@extend_schema(responses=PledgeSerializer)
@api_view(["GET"])
def pledge(_request: Request) -> Response:
    """The Kuk Sool Won pledge, in English and Korean."""
    return Response(PledgeSerializer(read_pledge()).data)


@extend_schema(responses=CreditsSerializer)
@api_view(["GET"])
def credits(_request: Request) -> Response:
    """The software KukGrade is built on, as written when this version was
    built. Not available when run from a checkout."""
    path = settings.CREDITS_DIR / CREDITS_FILE
    if not path.is_file():
        return Response(
            CreditsSerializer({"available": False, "server": [], "browser": []}).data
        )
    listed = json.loads(path.read_text(encoding="utf-8"))
    return Response(CreditsSerializer({"available": True, **listed}).data)


@extend_schema(
    responses={
        (200, "text/plain"): OpenApiResponse(
            description="Every package, with its licence text."
        )
    },
)
@api_view(["GET"])
def credits_notices(_request: Request) -> FileResponse:
    """The full third-party licence notices, as a text file."""
    path = settings.CREDITS_DIR / NOTICES_FILE
    if not path.is_file():
        raise Http404
    return FileResponse(path.open("rb"), content_type="text/plain; charset=utf-8")
