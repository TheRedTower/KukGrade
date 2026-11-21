"""The Content-Security-Policy header, for the pages Django serves.

KukGrade's page is one built React app that loads its own scripts and styles and
talks only to its own API, so the browser can be told to accept nothing else: a
script injected into a page, from anywhere, then cannot run, load a remote
resource or send what it finds elsewhere. Django 5.2 has no built-in support
(it arrives in 6.0), so this is the whole of it.

The one inline script, in the built `index.html`, sets the theme before first paint
so the page does not flash the other theme. It is allowed by its hash, worked out
from the page being served, so editing it needs no change here.

`KUKGRADE_CSP` is `enforce` (the default), `report-only` (the browser reports
what it would have blocked in its console, and blocks nothing) or `off`, for a
proxy or an extension that injects something.
"""

from __future__ import annotations

import base64
import hashlib
import re
from collections.abc import Callable
from functools import lru_cache

from django.conf import settings
from django.http import HttpRequest, HttpResponse

# A script with a body and no src: the only kind a hash can allow.
_INLINE_SCRIPT = re.compile(
    r"<script(?![^>]*\bsrc\s*=)[^>]*>(.*?)</script\s*>",
    re.IGNORECASE | re.DOTALL,
)

HEADER = "Content-Security-Policy"
REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only"


@lru_cache(maxsize=8)
def inline_script_sources(html: str) -> tuple[str, ...]:
    """The `'sha256-...'` source for each inline script in this page."""
    sources = []
    for body in _INLINE_SCRIPT.findall(html):
        if body.strip():
            digest = hashlib.sha256(body.encode("utf-8")).digest()
            sources.append(f"'sha256-{base64.b64encode(digest).decode('ascii')}'")
    return tuple(sources)


def policy(script_sources: tuple[str, ...] = ()) -> str:
    return "; ".join(
        [
            "default-src 'self'",
            "script-src " + " ".join(["'self'", *script_sources]),
            # Styles come from the built stylesheet; the interface sets the few
            # it computes through the browser's style object, which this allows.
            "style-src 'self'",
            # `data:` for the small images the build inlines.
            "img-src 'self' data:",
            "font-src 'self'",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            # The same as X-Frame-Options: DENY, for browsers that read this.
            "frame-ancestors 'none'",
        ],
    )


class ContentSecurityPolicyMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        response = self.get_response(request)
        mode = settings.CSP_MODE
        if mode == "off" or not response.get("Content-Type", "").startswith(
            "text/html",
        ):
            return response
        # Only a page can run a script, so only a page needs the header.
        sources: tuple[str, ...] = ()
        if not response.streaming:
            sources = inline_script_sources(response.content.decode("utf-8", "replace"))
        response[HEADER if mode == "enforce" else REPORT_ONLY_HEADER] = policy(sources)
        return response
