"""Check the running app and database without adding a runtime HTTP client."""

from __future__ import annotations

import os
import urllib.error
import urllib.request


class _NoRedirects(urllib.request.HTTPRedirectHandler):
    # A redirect means the app did not answer readiness itself - for example
    # SECURE_SSL_REDIRECT when DJANGO_BEHIND_TLS_PROXY is off - and following
    # it would probe the public site instead of this container.
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


def main() -> None:
    host = os.environ.get("DJANGO_ALLOWED_HOSTS", "www.kukgrade.co.uk").split(",")[0]
    request = urllib.request.Request(
        "http://127.0.0.1:8000/api/ready/",
        headers={"Host": host, "X-Forwarded-Proto": "https"},
    )
    opener = urllib.request.build_opener(_NoRedirects)
    try:
        with opener.open(request, timeout=3) as response:
            if response.status != 200:
                raise SystemExit(1)
    except (OSError, urllib.error.URLError) as exc:
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
