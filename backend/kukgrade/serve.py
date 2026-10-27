"""The container's main process: the database (if it carries one), then the app.

`python -m kukgrade.serve` is what the image runs. With POSTGRES_HOST unset, the
image's own PostgreSQL is started first, on a unix socket that nothing outside the
container can reach, with its files in /var/lib/kukgrade/postgres. With
POSTGRES_HOST set, the database is somebody else's and only the app is started.
Either way the app is then migrated, prints its first-administrator setup code if
one is needed, and is served by gunicorn (kukgrade/gunicorn_conf.py).

It starts as root only to hand /var/lib/kukgrade to the app's user (UID 10001),
which a folder Docker makes on the host does not belong to, and runs everything
else as that user. Started as that user already (compose.external-db.yml does), it skips
both. If either process stops, the other is stopped and the container exits, so
its restart policy brings both back.
"""

from __future__ import annotations

import os
import re
import secrets
import signal
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from types import FrameType

APP_ID = 10001
DATA_DIR = Path("/var/lib/kukgrade")
SOCKET_DIR = Path(os.environ.get("KUKGRADE_EMBEDDED_SOCKET", "/tmp/kukgrade-pg"))
# The database's own superuser, which only the operator uses (psql -U postgres in
# a shell in the container). The app connects as POSTGRES_USER, which owns its
# database but is not a superuser.
ADMIN_USER = "postgres"
_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,62}")
POSTGRES_START_SECONDS = 60
APP_STOP_SECONDS = 40
POSTGRES_STOP_SECONDS = 60


def embedded() -> bool:
    """Whether this container runs its own database."""
    return not os.environ.get("POSTGRES_HOST", "").strip()


def postgres_bin() -> Path:
    """The PostgreSQL programs the image carries (the newest installed major)."""
    found = sorted(
        Path("/usr/lib/postgresql").glob("*/bin"),
        key=lambda path: int(path.parent.name),
    )
    if not found:
        msg = "This image has no PostgreSQL; set POSTGRES_HOST to your own database."
        raise SystemExit(msg)
    return found[-1]


Command = Sequence[str | Path]


def run(
    command: Command,
    *,
    env: Mapping[str, str] | None = None,
    check: bool = True,
    capture: bool = False,
) -> subprocess.CompletedProcess[str]:
    """Run `command` to its end as the app's user (when started as root)."""
    root = os.geteuid() == 0
    return subprocess.run(
        command,
        env=env,
        capture_output=capture,
        text=True,
        check=check,
        user=APP_ID if root else None,
        group=APP_ID if root else None,
        extra_groups=[] if root else None,
    )


def spawn(
    command: Command, *, env: Mapping[str, str] | None = None
) -> subprocess.Popen[bytes]:
    """Start `command` as the app's user (when started as root)."""
    root = os.geteuid() == 0
    return subprocess.Popen(
        command,
        env=env,
        user=APP_ID if root else None,
        group=APP_ID if root else None,
        extra_groups=[] if root else None,
    )


def refuse_link(path: Path) -> None:
    """Root must never follow a link someone with write access to data/ planted."""
    if path.is_symlink():
        msg = f"{path} is a symbolic link; remove it (it would be followed as root)."
        raise SystemExit(msg)


def hand_over(path: Path, *, everything: bool = True) -> None:
    """Make `path` (and, if `everything`, what is inside it) the app's, as root."""
    if os.geteuid() != 0:
        return
    refuse_link(path)
    os.chown(path, APP_ID, APP_ID, follow_symlinks=False)
    if everything:
        for child in path.rglob("*"):
            os.chown(child, APP_ID, APP_ID, follow_symlinks=False)


def prepare_folders(data_dir: Path, *, with_database: bool) -> None:
    """The folders KukGrade keeps its data in, each the app's."""
    data_dir.mkdir(parents=True, exist_ok=True)
    hand_over(data_dir, everything=False)
    for name in ("import_uploads", "tls"):
        folder = data_dir / name
        refuse_link(folder)
        folder.mkdir(exist_ok=True)
        hand_over(folder)
        # Rosters and workbooks are personal data, and tls/ may hold an
        # operator's own key: the app's user only, however the folder was made.
        # Set to exactly 700 when it is not already (the image ships both so),
        # since the rest of /var/lib/kukgrade may be read-only (external-db file).
        if folder.stat().st_mode & 0o777 != 0o700:
            folder.chmod(0o700)
    if with_database:
        folder = data_dir / "postgres"
        refuse_link(folder)
        folder.mkdir(exist_ok=True)
        # A database can be large: go through it only when the folder is not
        # yet the app's, which is the first start.
        owned = os.geteuid() != 0 or folder.stat().st_uid == APP_ID
        if not owned:
            hand_over(folder)


def secret_key(data_dir: Path) -> str:
    """The Django secret key: the one given, or one made once and kept."""
    given = os.environ.get("DJANGO_SECRET_KEY", "").strip()
    if given:
        return given
    kept = data_dir / "secret_key"
    refuse_link(kept)
    if not kept.exists():
        # Created private from the start, and never through a link.
        fd = os.open(kept, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write(secrets.token_urlsafe(64))
        hand_over(kept, everything=False)
    return kept.read_text().strip()


def check_version(pgdata: Path, programs: Path) -> None:
    """Refuse a database made by another PostgreSQL major than this image's."""
    made_by = (pgdata / "PG_VERSION").read_text().strip().split(".")[0]
    carried = programs.parent.name
    if made_by != carried:
        msg = (
            f"The database in {pgdata} was made by PostgreSQL {made_by}, and this "
            f"image carries PostgreSQL {carried}. Dump it with the image that made it "
            "(pg_dump) and restore it into a new data folder here: see the "
            "deployment guide."
        )
        raise SystemExit(msg)


def child_env(data_dir: Path) -> dict[str, str]:
    """The environment the app's processes run in."""
    return dict(os.environ, DJANGO_SECRET_KEY=secret_key(data_dir))


def start_database(data_dir: Path, env: Mapping[str, str]) -> subprocess.Popen[bytes]:
    """Make the database on first start, start it, and wait until it answers."""
    programs = postgres_bin()
    pgdata = data_dir / "postgres"
    user = env.get("POSTGRES_USER", "kukgrade")
    name = env.get("POSTGRES_DB", "kukgrade")
    for value in (user, name):
        if not _NAME.fullmatch(value) or value == ADMIN_USER:
            msg = (
                f"{value!r} is not usable as the database's user or name: letters, "
                f"digits and underscores only, and not {ADMIN_USER!r}."
            )
            raise SystemExit(msg)
    if (pgdata / "PG_VERSION").exists():
        check_version(pgdata, programs)
    else:
        run(
            [
                programs / "initdb",
                "-D", pgdata,
                "-U", ADMIN_USER,
                "--auth-local=trust",
                "--auth-host=reject",
                "--encoding=UTF8",
                "--locale=C.UTF-8",
            ]
        )  # fmt: skip
    SOCKET_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    hand_over(SOCKET_DIR, everything=False)
    server = spawn(
        [
            programs / "postgres",
            "-D", pgdata,
            "-c", "listen_addresses=",
            "-c", f"unix_socket_directories={SOCKET_DIR}",
            "-c", "jit=off",
        ]
    )  # fmt: skip
    try:
        wait_until_ready(programs, server, user, name)
    except BaseException:
        stop(server, signal.SIGINT, POSTGRES_STOP_SECONDS)
        raise
    return server


def wait_until_ready(
    programs: Path, server: subprocess.Popen[bytes], user: str, name: str
) -> None:
    """Wait for the database to answer, and make the app's database if new."""
    deadline = time.monotonic() + POSTGRES_START_SECONDS
    while run([programs / "pg_isready", "-h", SOCKET_DIR], check=False).returncode:
        if server.poll() is not None:
            raise SystemExit("The database stopped while starting.")
        if time.monotonic() > deadline:
            raise SystemExit("The database did not start in time.")
        time.sleep(0.3)
    psql: list[str | Path] = [
        programs / "psql", "-h", SOCKET_DIR, "-d", "postgres",
        "-qtA", "-v", "ON_ERROR_STOP=1",
    ]  # fmt: skip
    # A database made before the app had a role of its own has POSTGRES_USER as
    # its bootstrap superuser, which PostgreSQL cannot demote. It keeps working
    # as it did (that role also makes the database), with a warning saying how
    # to move to the new arrangement.
    legacy = bool(
        run(
            [*psql, "-U", ADMIN_USER, "-c", "SELECT 1"], check=False, capture=True
        ).returncode
    )
    admin = user if legacy else ADMIN_USER
    if legacy:
        print(
            f"WARNING: this database was made before the app had a role of its own, "
            f"so {user!r} is its superuser. To change that, dump it with pg_dump, "
            "empty data/postgres and restore the dump (docs/installation.md, "
            '"Backups").',
            flush=True,
        )
    else:
        run([*psql, "-U", admin, "-c", app_role_sql(user)])
    exists = run(
        [
            *psql,
            "-U",
            admin,
            "-c",
            f"SELECT 1 FROM pg_database WHERE datname = '{name}'",
        ],
        capture=True,
    )
    if exists.stdout.strip() != "1":
        run([programs / "createdb", "-h", SOCKET_DIR, "-U", admin, "-O", user, name])
    if not legacy:
        run([*psql, "-U", admin, "-c", f'ALTER DATABASE "{name}" OWNER TO "{user}"'])


def app_role_sql(user: str) -> str:
    """SQL, safe to repeat, that leaves `user` able to sign in, make databases
    and own what it makes, and nothing more: not a superuser, and not able to
    make other roles, replicate, or read the server's files or programs."""
    return (
        "DO $$ BEGIN "
        f"IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{user}') THEN "
        f'CREATE ROLE "{user}" LOGIN; END IF; END $$; '
        f'ALTER ROLE "{user}" NOSUPERUSER LOGIN CREATEDB NOCREATEROLE '
        "NOREPLICATION NOBYPASSRLS"
    )


def stop(process: subprocess.Popen[bytes], sig: int, wait: float) -> None:
    """Ask `process` to stop, and make it if it does not within `wait` seconds."""
    if process.poll() is not None:
        return
    process.send_signal(sig)
    try:
        process.wait(timeout=wait)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def reap_orphans(known: set[int]) -> None:
    """Collect finished processes nobody else will, as the container's PID 1.

    A process started in the container with `docker exec` and left running in
    the background is handed to PID 1 when its parent exits, and stays a
    zombie when it ends unless PID 1 collects it. The app's and database's own
    processes are left to their Popen objects.
    """
    while True:
        try:
            found = os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | os.WNOWAIT)
        except ChildProcessError:
            return
        if found is None or found.si_pid in known:
            return
        os.waitpid(found.si_pid, 0)


def supervise(
    app: subprocess.Popen[bytes],
    database: subprocess.Popen[bytes] | None,
    stopping: list[bool],
) -> int:
    """Wait for the app (or the database) to stop or for a stop signal; stop both."""
    known = {app.pid, *([database.pid] if database else [])}
    while not stopping[0]:
        if app.poll() is not None or (database and database.poll() is not None):
            break
        reap_orphans(known)
        time.sleep(0.5)
    stop(app, signal.SIGTERM, APP_STOP_SECONDS)
    if database:
        # SIGINT is PostgreSQL's fast shutdown: end sessions, then stop cleanly.
        stop(database, signal.SIGINT, POSTGRES_STOP_SECONDS)
    if stopping[0]:
        return 0
    if database and database.returncode not in (None, 0) and app.returncode in (0, -15):
        return database.returncode
    return app.returncode or 0


def main() -> int:
    stopping = [False]
    starting = [True]

    def request_stop(_signal: int, _frame: FrameType | None) -> None:
        stopping[0] = True
        if starting[0]:
            # Interrupts whatever start-up step is waiting; subprocess.run ends
            # its child, and the handler below stops the database.
            raise SystemExit(0)

    # First of all: as PID 1 an unhandled SIGTERM is ignored.
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    database: subprocess.Popen[bytes] | None = None
    app: subprocess.Popen[bytes] | None = None
    try:
        with_database = embedded()
        prepare_folders(DATA_DIR, with_database=with_database)
        env = child_env(DATA_DIR)
        if with_database:
            database = start_database(DATA_DIR, env)
        for command in (
            ["manage.py", "migrate", "--noinput"],
            # While there is no administrator, writes the one-time setup code the
            # setup page asks for to this log (accounts/setup.py).
            ["manage.py", "issue_setup_code"],
        ):
            run([sys.executable, *command], env=env)
        app = spawn(
            [
                "gunicorn",
                "kukgrade.wsgi:application",
                "-c",
                "python:kukgrade.gunicorn_conf",
            ],
            env=env,
        )
        starting[0] = False
    except BaseException:
        starting[0] = False
        if app:
            stop(app, signal.SIGTERM, APP_STOP_SECONDS)
        if database:
            stop(database, signal.SIGINT, POSTGRES_STOP_SECONDS)
        raise
    return supervise(app, database, stopping)


if __name__ == "__main__":
    sys.exit(main())
