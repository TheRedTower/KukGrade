"""Check the running app and database without adding a runtime HTTP client."""

from __future__ import annotations

import ssl
import urllib.error
import urllib.request

import psycopg

from kukgrade import settings

# How long a connection to the database may take, handshake included. The probe
# as a whole is bounded by the image's health-check timeout (Dockerfile): the
# request (3s) and this (2s) leave room for starting Python on a busy host.
DATABASE_TIMEOUT_SECONDS = 2


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
    """Ask the database directly: nothing public reports whether it is up.

    A plain connection and one query, with the settings' own connection details
    and a short deadline. It does not start Django: loading every app takes a
    second on a quiet host and several on a busy one, to run `SELECT 1`.
    """
    database = settings.DATABASES["default"]
    try:
        with psycopg.connect(
            dbname=database["NAME"],
            user=database["USER"],
            password=database["PASSWORD"],
            host=database["HOST"],
            port=database["PORT"],
            connect_timeout=DATABASE_TIMEOUT_SECONDS,
        ) as connection:
            connection.execute("SELECT 1").fetchone()
    except psycopg.Error:
        return False
    return True


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
