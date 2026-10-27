"""kukgrade.serve: the container's main process (what can be tested without a
PostgreSQL installed; the whole of it is exercised by running the image)."""

from __future__ import annotations

import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

from kukgrade import serve


class FakeProcess:
    """Stands in for a subprocess.Popen that has stopped or can be stopped."""

    def __init__(
        self, returncode: int | None = None, *, stubborn: bool = False
    ) -> None:
        self.returncode = returncode
        self.stubborn = stubborn
        self.signals: list[int] = []

    def poll(self) -> int | None:
        return self.returncode

    def send_signal(self, sig: int) -> None:
        self.signals.append(sig)
        if not self.stubborn:
            self.returncode = 0

    def wait(self, timeout: float | None = None) -> int:
        if self.returncode is None:
            raise subprocess.TimeoutExpired("fake", timeout or 0)
        return self.returncode

    def kill(self) -> None:
        self.signals.append(signal.SIGKILL)
        self.returncode = -9


def test_database_is_embedded_only_without_a_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("POSTGRES_HOST", raising=False)
    assert serve.embedded()
    monkeypatch.setenv("POSTGRES_HOST", "  ")
    assert serve.embedded()
    monkeypatch.setenv("POSTGRES_HOST", "db.example.com")
    assert not serve.embedded()


def test_the_given_secret_key_is_used_and_nothing_is_written(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("DJANGO_SECRET_KEY", "given-key")
    assert serve.secret_key(tmp_path) == "given-key"
    assert not (tmp_path / "secret_key").exists()


def test_a_secret_key_is_made_once_and_kept_private(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("DJANGO_SECRET_KEY", raising=False)
    first = serve.secret_key(tmp_path)
    assert len(first) >= 64
    assert serve.secret_key(tmp_path) == first
    assert (tmp_path / "secret_key").stat().st_mode & 0o777 == 0o600


def test_folders_are_made_and_the_database_folder_only_when_it_is_embedded(
    tmp_path: Path,
) -> None:
    serve.prepare_folders(tmp_path / "data", with_database=False)
    assert (tmp_path / "data" / "import_uploads").is_dir()
    assert (tmp_path / "data" / "tls").is_dir()
    assert not (tmp_path / "data" / "postgres").exists()
    serve.prepare_folders(tmp_path / "data", with_database=True)
    assert (tmp_path / "data" / "postgres").is_dir()


def test_a_database_from_another_postgresql_major_is_refused(tmp_path: Path) -> None:
    (tmp_path / "PG_VERSION").write_text("16\n")
    programs = tmp_path / "usr" / "17" / "bin"
    with pytest.raises(SystemExit, match="PostgreSQL 16.*PostgreSQL 17"):
        serve.check_version(tmp_path, programs)
    (tmp_path / "PG_VERSION").write_text("17\n")
    serve.check_version(tmp_path, programs)


def test_a_missing_postgresql_names_the_alternative(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(serve, "Path", lambda *_: tmp_path)
    with pytest.raises(SystemExit, match="POSTGRES_HOST"):
        serve.postgres_bin()


def test_stopping_asks_politely_then_forces() -> None:
    polite = FakeProcess()
    serve.stop(polite, signal.SIGTERM, 0.01)  # type: ignore[arg-type]
    assert polite.signals == [signal.SIGTERM]
    stubborn = FakeProcess(stubborn=True)
    serve.stop(stubborn, signal.SIGTERM, 0.01)  # type: ignore[arg-type]
    assert stubborn.signals == [signal.SIGTERM, signal.SIGKILL]
    done = FakeProcess(0)
    serve.stop(done, signal.SIGTERM, 0.01)  # type: ignore[arg-type]
    assert done.signals == []


def test_a_stop_request_stops_the_app_then_the_database_fast() -> None:
    app, database = FakeProcess(), FakeProcess()
    code = serve.supervise(app, database, [True])  # type: ignore[arg-type]
    assert code == 0
    assert app.signals == [signal.SIGTERM]
    assert database.signals == [signal.SIGINT]


def test_the_database_stopping_takes_the_app_down_with_a_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(time, "sleep", lambda _: None)
    app, database = FakeProcess(), FakeProcess(3)
    code = serve.supervise(app, database, [False])  # type: ignore[arg-type]
    assert code == 3
    assert app.signals == [signal.SIGTERM]


def test_the_app_stopping_stops_the_database_and_passes_its_code_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(time, "sleep", lambda _: None)
    app, database = FakeProcess(1), FakeProcess()
    code = serve.supervise(app, database, [False])  # type: ignore[arg-type]
    assert code == 1
    assert database.signals == [signal.SIGINT]


def test_the_module_runs_as_a_program() -> None:
    assert Path(serve.__file__).name == "serve.py"
    result = subprocess.run(
        [sys.executable, "-c", "import kukgrade.serve"],
        check=False,
        capture_output=True,
    )
    assert result.returncode == 0


def test_root_never_follows_a_link_in_the_data_folder(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("DJANGO_SECRET_KEY", raising=False)
    (tmp_path / "elsewhere").mkdir()
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "tls").symlink_to(tmp_path / "elsewhere")
    with pytest.raises(SystemExit, match="symbolic link"):
        serve.prepare_folders(tmp_path / "data", with_database=False)
    (tmp_path / "data" / "secret_key").symlink_to(tmp_path / "nowhere")
    with pytest.raises(SystemExit, match="symbolic link"):
        serve.secret_key(tmp_path / "data")
    assert not (tmp_path / "nowhere").exists()
