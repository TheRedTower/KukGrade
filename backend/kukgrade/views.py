"""Serve the built frontend for browser routes not owned by Django."""

from __future__ import annotations

from pathlib import PurePosixPath

from django.conf import settings
from django.http import Http404, HttpRequest, HttpResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe


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
