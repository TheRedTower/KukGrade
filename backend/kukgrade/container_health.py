"""Check the running app and database without adding a runtime HTTP client."""

from __future__ import annotations

import os
import urllib.error
import urllib.request


def main() -> None:
    host = os.environ.get("DJANGO_ALLOWED_HOSTS", "www.kukgrade.co.uk").split(",")[0]
    request = urllib.request.Request(
        "http://127.0.0.1:8000/api/ready/",
        headers={"Host": host, "X-Forwarded-Proto": "https"},
    )
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            if response.status != 200:
                raise SystemExit(1)
    except (OSError, urllib.error.URLError) as exc:
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
