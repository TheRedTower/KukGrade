"""Check the running app and database without adding a runtime HTTP client."""

from __future__ import annotations

import os
import ssl
import urllib.error
import urllib.request

import django

from kukgrade import settings


class _NoRedirects(urllib.request.HTTPRedirectHandler):
    # A redirect means the app did not answer itself - for example
    # SECURE_SSL_REDIRECT when no proxy is declared (DJANGO_NUM_PROXIES) - and
    # following it would probe the public site instead of this container.
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


def _host() -> str:
    """A host name the app answers to, for the Host header."""
    host = settings.ALLOWED_HOSTS[0].lstrip(".") if settings.ALLOWED_HOSTS else ""
    return "localhost" if host in ("", "*") else host


def _database_reachable() -> bool:
    """Ask the database directly: nothing public reports whether it is up."""
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "kukgrade.settings")
    django.setup()
    from health.views import database_reachable

    return database_reachable()


def main() -> None:
    scheme = "https" if settings.SERVES_TLS else "http"
    request = urllib.request.Request(
        f"{scheme}://127.0.0.1:{settings.PORT}/api/health/",
        headers={"Host": _host(), "X-Forwarded-Proto": "https"},
    )
    handlers: list[urllib.request.BaseHandler | type[urllib.request.BaseHandler]]
    handlers = [_NoRedirects]
    if settings.SERVES_TLS:
        # The app talks to itself on loopback, often with a self-signed
        # certificate made for its real name, so the certificate is not checked.
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        handlers.append(urllib.request.HTTPSHandler(context=context))
    opener = urllib.request.build_opener(*handlers)
    try:
        with opener.open(request, timeout=3) as response:
            if response.status != 200:
                raise SystemExit(1)
    except (OSError, urllib.error.URLError) as exc:
        raise SystemExit(1) from exc
    if not _database_reachable():
        raise SystemExit(1)


if __name__ == "__main__":
    main()
