"""The certificate the app serves HTTPS with when it is reached directly.

A deployment either mounts its own certificate and key (KUKGRADE_TLS_CERT and
KUKGRADE_TLS_KEY) or lets KukGrade make a self-signed pair, once, and keep it
under KUKGRADE_TLS_DIR. A self-signed certificate encrypts the connection but
a browser will warn that it does not know who signed it; a deployment with a
real name should bring a real certificate or put a proxy in front.
"""

from __future__ import annotations

import ipaddress
import subprocess
from pathlib import Path

from kukgrade import settings

CERT_NAME = "kukgrade.crt"
KEY_NAME = "kukgrade.key"
# The host names the pair was made for, so a changed ALLOWED_HOSTS remakes it.
NAMES_NAME = "kukgrade.names"
VALID_DAYS = 825
# A generated certificate is replaced once it has this long (30 days) to run.
RENEW_BEFORE_SECONDS = 30 * 24 * 60 * 60


def _alternative_names() -> str:
    """Every host the app answers to, as a subjectAltName value."""
    hosts = ["localhost", "127.0.0.1", *settings.ALLOWED_HOSTS]
    names: list[str] = []
    for host in dict.fromkeys(hosts):
        if "*" in host or host.startswith("."):
            continue  # a wildcard cannot be named in a certificate made here
        host = host.strip("[]")  # Django writes an IPv6 host as [::1]
        try:
            ipaddress.ip_address(host)
        except ValueError:
            names.append(f"DNS:{host}")
        else:
            names.append(f"IP:{host}")
    return ",".join(names)


def _is_current(cert: Path) -> bool:
    check = subprocess.run(
        ["openssl", "x509", "-noout", "-checkend", str(RENEW_BEFORE_SECONDS)],
        input=cert.read_bytes(),
        capture_output=True,
        check=False,
    )
    return check.returncode == 0


def _names_match(names_file: Path) -> bool:
    try:
        return names_file.read_text() == _alternative_names()
    except OSError:
        return False


def _generate(cert: Path, key: Path, names_file: Path) -> None:
    cert.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-nodes",
            "-newkey",
            "ec",
            "-pkeyopt",
            "ec_paramgen_curve:prime256v1",
            "-days",
            str(VALID_DAYS),
            "-subj",
            "/CN=KukGrade",
            "-addext",
            f"subjectAltName={_alternative_names()}",
            # A server certificate, not a certificate authority: openssl's
            # default for -x509 is CA:TRUE, which someone who trusts this file
            # to silence a browser warning would be trusting for any site.
            "-addext",
            "basicConstraints=critical,CA:FALSE",
            "-addext",
            "extendedKeyUsage=serverAuth",
            "-keyout",
            str(key),
            "-out",
            str(cert),
        ],
        capture_output=True,
        check=True,
    )
    names_file.write_text(_alternative_names())


def certificate_files() -> tuple[str, str]:
    """The certificate and key paths to serve with, making a pair if needed."""
    if settings.TLS_CERT_FILE:
        return settings.TLS_CERT_FILE, settings.TLS_KEY_FILE
    cert = settings.TLS_DIR / CERT_NAME
    key = settings.TLS_DIR / KEY_NAME
    names_file = settings.TLS_DIR / NAMES_NAME
    try:
        if not (
            cert.is_file()
            and key.is_file()
            and _names_match(names_file)
            and _is_current(cert)
        ):
            _generate(cert, key, names_file)
    except (OSError, subprocess.CalledProcessError) as exc:
        detail = getattr(exc, "stderr", b"") or b""
        msg = (
            f"KukGrade could not make a certificate in {settings.TLS_DIR}: "
            f"{exc} {detail.decode(errors='replace').strip()}\n"
            "Mount a volume writable by the app there, or set "
            "KUKGRADE_TLS_CERT and KUKGRADE_TLS_KEY to your own certificate, "
            "or set KUKGRADE_TRANSPORT=http (a trusted network only), or "
            "declare a proxy with DJANGO_NUM_PROXIES."
        )
        raise RuntimeError(msg) from exc
    return str(cert), str(key)
