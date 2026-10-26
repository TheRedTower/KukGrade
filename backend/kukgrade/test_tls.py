"""The certificate a directly reached app serves HTTPS with, and how gunicorn is
told to serve it."""

from __future__ import annotations

import shutil
import ssl
import subprocess
from pathlib import Path

import pytest

from kukgrade import settings, tls

needs_openssl = pytest.mark.skipif(
    shutil.which("openssl") is None,
    reason="the openssl command is not installed",
)


def subject_alt_names(cert: str) -> str:
    shown = subprocess.run(
        ["openssl", "x509", "-noout", "-ext", "subjectAltName", "-in", cert],
        capture_output=True,
        text=True,
        check=True,
    )
    return shown.stdout


@pytest.fixture
def tls_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(settings, "TLS_DIR", tmp_path / "tls")
    monkeypatch.setattr(settings, "TLS_CERT_FILE", "")
    monkeypatch.setattr(settings, "TLS_KEY_FILE", "")
    monkeypatch.setattr(
        settings, "ALLOWED_HOSTS", ["kukgrade.example.com", "192.0.2.10"]
    )
    return tmp_path / "tls"


@needs_openssl
def test_a_self_signed_pair_is_made_for_the_hosts_the_app_answers_to(
    tls_dir: Path,
) -> None:
    cert, key = tls.certificate_files()

    assert (cert, key) == (str(tls_dir / "kukgrade.crt"), str(tls_dir / "kukgrade.key"))
    names = subject_alt_names(cert)
    for expected in (
        "DNS:localhost",
        "IP Address:127.0.0.1",
        "DNS:kukgrade.example.com",
        "IP Address:192.0.2.10",
    ):
        assert expected in names
    assert (tls_dir / "kukgrade.key").stat().st_mode & 0o777 == 0o600
    # The pair loads as a server certificate.
    ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER).load_cert_chain(cert, key)


@needs_openssl
def test_a_current_pair_is_kept_not_remade(tls_dir: Path) -> None:
    first = tls.certificate_files()
    made = Path(first[0]).read_bytes()

    again = tls.certificate_files()

    assert again == first
    assert Path(again[0]).read_bytes() == made


@needs_openssl
def test_a_pair_close_to_expiry_is_replaced(
    tls_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cert, _key = tls.certificate_files()
    made = Path(cert).read_bytes()
    monkeypatch.setattr(tls, "RENEW_BEFORE_SECONDS", 900 * 24 * 60 * 60)

    tls.certificate_files()

    assert Path(cert).read_bytes() != made


@needs_openssl
@needs_openssl
def test_the_certificate_is_for_a_server_and_cannot_sign_others(tls_dir: Path) -> None:
    cert, _key = tls.certificate_files()

    shown = subprocess.run(
        ["openssl", "x509", "-noout", "-text", "-in", cert],
        capture_output=True,
        text=True,
        check=True,
    ).stdout

    assert "CA:FALSE" in shown
    assert "TLS Web Server Authentication" in shown


def test_ipv6_hosts_are_named_as_addresses(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ALLOWED_HOSTS", ["[::1]"])

    assert tls._alternative_names() == "DNS:localhost,IP:127.0.0.1,IP:::1"


def test_wildcard_hosts_are_left_out_of_the_certificate_names(
    tls_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        settings, "ALLOWED_HOSTS", ["*", ".example.com", "kukgrade.example.com"]
    )

    names = tls._alternative_names()

    assert names == "DNS:localhost,IP:127.0.0.1,DNS:kukgrade.example.com"


def test_an_unwritable_directory_says_what_to_do_about_it(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    blocked = tmp_path / "blocked"
    blocked.write_text("a file, not a directory")
    monkeypatch.setattr(settings, "TLS_DIR", blocked / "tls")
    monkeypatch.setattr(settings, "TLS_CERT_FILE", "")
    monkeypatch.setattr(settings, "TLS_KEY_FILE", "")

    with pytest.raises(RuntimeError) as refused:
        tls.certificate_files()

    message = str(refused.value)
    assert "could not make a certificate" in message
    assert "KUKGRADE_TLS_CERT" in message
    assert "KUKGRADE_TRANSPORT=http" in message


def test_a_mounted_certificate_is_used_as_it_is(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "TLS_CERT_FILE", "/certs/site.crt")
    monkeypatch.setattr(settings, "TLS_KEY_FILE", "/certs/site.key")

    assert tls.certificate_files() == ("/certs/site.crt", "/certs/site.key")
