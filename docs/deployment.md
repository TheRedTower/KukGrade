# Single-container production deployment

KukGrade's production Compose project has one service: `app`. Its image
contains the Django API, React frontend, and collected static files. The
existing Traefik and PostgreSQL containers remain in their own Compose
projects. The app joins one external network for Traefik and one for
PostgreSQL; no KukGrade port is published on the host. Traefik routing uses
the same `apps_net`, `websecure`, and `cloudflare` conventions as the owner's
working Open WebUI service, with `www.kukgrade.co.uk` as the host rule.

## Host preparation

1. Point `www.kukgrade.co.uk` DNS at the host running Traefik. Confirm that
   `apps_net`, the `websecure` entrypoint, and the `cloudflare` certificate
   resolver are present on that host.
2. Confirm the production PostgreSQL network name with `docker network ls`
   and the database container's stable alias on that network. The app joins
   that network separately from `apps_net` so Traefik uses the intended
   interface.
3. Create a dedicated PostgreSQL database and non-superuser role for KukGrade.
   The role must own the application database so Django can run migrations.
   PostgreSQL's data volume, upgrade and backup policy remain with the
   existing database deployment.
4. Copy `.env.production.example` to `.env.production` on the deployment
   host. Fill in the PostgreSQL network, alias, database, role, password and
   a fresh `DJANGO_SECRET_KEY`, and set `KUKGRADE_CLUB_NAME` to the club's
   name as it should appear in the sidebar, and `TZ` to the club's IANA time zone (default `Europe/London`; it decides
   what "today" means for ages and grading dates, and the screens show times
   in it - nothing else needs setting), and `KUKGRADE_SCHOOL_PREFIX` if the
   school's student IDs do not start `206-2`. Set mode
   `0600` on this file. It is ignored by Git and excluded from Docker builds.
5. Requests pass through Cloudflare and then Traefik, so
   `DJANGO_NUM_PROXIES=2`. That count is only right if Traefik trusts
   Cloudflare's published IP ranges in its entrypoint's
   `forwardedHeaders.trustedIPs` - it then appends Cloudflare's address to the
   `X-Forwarded-For` Cloudflare set, leaving the visitor second from the end -
   and if the host accepts web traffic only from Cloudflare. Verify both, and
   that `X-Forwarded-Proto` cannot be set by a client, before keeping
   `DJANGO_NUM_PROXIES=2`. With the wrong
   count every visitor shares Cloudflare's address and the login throttle
   locks everyone out together.

The app's named volume holds private, temporary roster/workbook uploads across
container replacement. It is never served by WhiteNoise. The image has a
read-only root filesystem and runs as UID 10001; a pre-existing replacement
volume must permit writes by that UID.

The image, port, worker configuration and Traefik labels have chosen defaults
in the Compose/Docker files. `.env.production` is for the production database,
secrets, host/CSRF rules and explicit proxy trust; it is not a catalogue of
optional tuning switches.

## Build and start

Run all commands from the repository root on the deployment host:

```sh
docker compose --env-file .env.production -f compose.prod.yml config --quiet
docker compose --env-file .env.production -f compose.prod.yml up -d --build --wait --wait-timeout 300
```

To have the About page show which build is running, set the commit and time
in the shell first (both are optional and only shown to people signed in):

```sh
export KUKGRADE_BUILD_COMMIT="$(git rev-parse --short HEAD)"
export KUKGRADE_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

The second command builds the app image, starts its single service, applies
pending Django migrations, and waits for the container health check: the app
answers `/api/health/` and the database answers a query. A failed migration leaves the app unable to serve
traffic and visible in `docker compose logs app`.

Set up the first administrator once, after a successful start. While none
exists, every start writes a one-time setup code to the app's log:

```sh
docker compose --env-file .env.production -f compose.prod.yml logs app | grep "setup code"
```

Enter that code, with the first administrator's email address, name and
password, on the site's setup page. The password meets the same policy as
every other, and the account becomes a superuser with every permission. The
code works once, for 24 hours, and a restart replaces it; only its hash is
stored, and guessing it is rate-limited like sign-in. Once an administrator
exists, setup is refused for good and every later account is added from the
Users screen. There is no default password, and Django's `createsuperuser`
is switched off.

Routine inspection:

```sh
docker compose --env-file .env.production -f compose.prod.yml ps
docker compose --env-file .env.production -f compose.prod.yml logs --tail=100 app
```

Check `https://www.kukgrade.co.uk/`, a deep link such as
`/students/42` and `/api/health/`. Check an authenticated
write to confirm session cookies and CSRF across the HTTPS proxy. The
frontend calls `/api/` on the same origin; no production CORS origin or API
subdomain is needed.

## How the app is reached

One setting says what is in front of the app: `DJANGO_NUM_PROXIES`, the number
of reverse proxies or tunnels in a chain, all trusted. The first one, facing
the public, must discard any `X-Forwarded-For` and `X-Forwarded-Proto` a client
sent and start them from the connection it saw; each further proxy appends the
address of the one before it and passes the scheme on. Everything else follows
from the count.

| `DJANGO_NUM_PROXIES` | The app | TLS | Client address for the login throttle |
| --- | --- | --- | --- |
| `0` (default) | reached directly on its port | the app serves HTTPS itself, or plain HTTP if `KUKGRADE_TRANSPORT=http` | the connection's own address; `X-Forwarded-For` is ignored |
| `N` above 0 | plain HTTP behind `N` proxies | ends at the proxies; the forwarded scheme is trusted | the Nth-from-last `X-Forwarded-For` entry |

The count must match what really sits in front. Too low and visitors are all
seen as the proxy's address (the login throttle locks everyone out together);
too high and a client can choose its own address. Do not publish the app's port
to anyone but the proxy when proxies are declared, or a client could reach it
directly with forged headers.

- The app listens on port `6942`, fixed (not a common service's port nor one
  of this project's development servers' 8000, 5173 and 5432). There is no
  setting for it: to reach the app on another host port, map it in Compose,
  for example `ports: "7443:6942"`. Anything routing to the app (a proxy, a
  tunnel) targets 6942.
- `KUKGRADE_TRANSPORT` (`https`, the default, or `http`): only for
  `DJANGO_NUM_PROXIES=0`. `https` serves TLS from the certificate in
  `KUKGRADE_TLS_CERT` and the key in `KUKGRADE_TLS_KEY` (both or neither), or,
  with neither, from a self-signed pair the app makes on first start and keeps
  in `KUKGRADE_TLS_DIR` (default `/var/lib/kukgrade/tls`, a volume that must be
  writable by UID 10001), made again at start when under 30 days remain or when
  `DJANGO_ALLOWED_HOSTS` has changed (restart to renew a long-running container
  or to add a new host name). A self-signed
  certificate encrypts the connection but browsers will warn about it; bring a
  real certificate for a real name. `http` turns the HTTPS redirect, secure
  cookies and HSTS off, and logs a warning at start: passwords and sessions
  travel unencrypted, so use it only on a network you trust.

The owner's Traefik deployment (`compose.prod.yml`) is `DJANGO_NUM_PROXIES=2`
(Cloudflare, then Traefik); the app's own port stays unpublished there.

## Running it anywhere

`compose.prod.yml` is the owner's own host (an existing Traefik and PostgreSQL).
For any other Docker host, the files in `deploy/` run KukGrade on its own or
behind a proxy or tunnel, with its data in one folder on the host.

```sh
cp deploy/.env.example deploy/.env        # fill it in (secret key, database password, host names)
docker compose -f deploy/compose.yml -f deploy/compose.bundled-db.yml up -d --build
docker compose -f deploy/compose.yml -f deploy/compose.bundled-db.yml logs app   # the first setup code
```

That serves HTTPS itself on port 6942 with a self-signed certificate (see "How the
app is reached"). It needs Docker Compose 2.24.4 or newer. To put something in front, add one file from `deploy/proxies/`
after the other two (`-f deploy/proxies/nginx.yml`); it removes the app's published
port, sets `DJANGO_NUM_PROXIES` (to 1; set `DJANGO_NUM_PROXIES` in `deploy/.env` to
change it) and adds the proxy. Paths inside these files are relative to `deploy/`,
and any variable a proxy file needs (a tunnel token, a domain: see the end of
`deploy/.env.example`) goes in `deploy/.env`, not on the command line, because
Compose needs it for every command, not only `up`. The compose project is named `kukgrade-deploy`, so it never
touches the development database (`docker compose up -d db` in the repository
root) or `compose.prod.yml`.

- `compose.yml`: the app, hardened as in `compose.prod.yml` (read-only root,
  all capabilities dropped, `no-new-privileges`), with a one-off `permissions`
  service that hands its two data folders to the app's user before it starts.
- `compose.bundled-db.yml`: a PostgreSQL 17 that comes with it, not published on
  the host and on a network of its own that only the app joins (so a proxy or
  tunnel container cannot reach it). Changing `POSTGRES_PASSWORD` later does not
  change the database's: it only applies when the database is first created. To use a database you already run, leave this file out and set
  `POSTGRES_HOST` (and `POSTGRES_PORT`) in `deploy/.env`.
- `proxies/`: `nginx.yml`, `caddy.yml`, `traefik.yml`, `cloudflared.yml`,
  `pangolin.yml`.

### What is stored, and where

Everything KukGrade keeps is under `deploy/data/` on the host (bind mounts), so it
survives replacing or rebuilding a container and is one folder to back up. There is
no other data directory and no config directory: the settings are the environment
in `deploy/.env`.

| Folder | What | If you lose it |
| --- | --- | --- |
| `data/postgres/` | the database (with `compose.bundled-db.yml`) | everything: restore from a backup |
| `data/import_uploads/` | workbooks and rosters waiting to be imported (private, cleared after 24 hours) | an unfinished import must be started again |
| `data/tls/` | the self-signed certificate and the host names it was made for | the app makes a new one; browsers warn again |
| `data/caddy/` | Caddy's certificates (with `caddy.yml`) | Caddy asks for new ones (rate limits apply) |

`deploy/data/` is ignored by Git and left out of image builds. Move or change a
folder by editing the left-hand side of the mounts in the compose files. The
`permissions` service makes `import_uploads` and `tls` belong to the app's user
(UID 10001); PostgreSQL looks after its own folder. On a host that manages file
ownership itself (some NAS and Windows setups), set the owners by hand.

Back up with the stack running:

```sh
docker exec kukgrade-db pg_dump -U kukgrade -d kukgrade -Fc > kukgrade-$(date +%F).dump
tar -C deploy/data -czf kukgrade-uploads-$(date +%F).tar.gz import_uploads
```

(`data/postgres/` must not be copied while the database runs, so dump instead.)
(`-U kukgrade -d kukgrade` are the names in `.env.example`; use yours.) To restore,
stop the app first (`docker compose -f deploy/compose.yml -f deploy/compose.bundled-db.yml
stop app`), then `docker exec -i kukgrade-db pg_restore -U kukgrade -d kukgrade --clean
--if-exists < kukgrade-DATE.dump`, unpack the uploads tarball into `deploy/data/` and
start the app again. The database is never empty once the app has run (it migrates
at start), and `--clean` replaces what the dump contains; restoring an older dump
over a newer schema can leave extra tables behind, so for a clean slate drop and
recreate the database first. Keep copies off the host, and test a restore before
real student data goes in. The data sits inside the Git checkout: do not run `git
clean -fdx` there.

### Choosing how it is reached

| File | Terminates TLS | Open on the host | `DJANGO_NUM_PROXIES` | Tried here |
| --- | --- | --- | --- | --- |
| none | the app (self-signed, or yours) | 6942 | 0 | yes |
| `nginx.yml` | nginx (your certificate in `proxies/nginx/certs/`) | 80, 443 | 1 | yes |
| `caddy.yml` | Caddy (automatic certificates for `KUKGRADE_DOMAIN`) | 80, 443 | 1 | yes |
| `traefik.yml` | your Traefik | none (Traefik's own) | 1 (2 with Cloudflare in front) | yes |
| `cloudflared.yml` | Cloudflare | none | 1 | no: needs a Cloudflare account; the count follows Cloudflare's documented headers (it appends the visitor's address to any `X-Forwarded-For` the client sent) |
| `pangolin.yml` | your Pangolin server | none | 1 expected | no: needs a Pangolin server; confirm the count with the check below |

"Tried here" means brought up with the real proxy in front of the app and
checked: pages served, `/admin/` closed, and the check below. nginx and Caddy
cap an upload a little above the import limit (6 MB); nginx refuses an oversized
one at once, Caddy when the app reads it. Behind nginx on a port other than 443,
list that origin (with the port) in `DJANGO_CSRF_TRUSTED_ORIGINS`. Set `DJANGO_ALLOWED_HOSTS` and
`DJANGO_CSRF_TRUSTED_ORIGINS` in `deploy/.env` to the name people type.

Check that the count matches what is in front, from anywhere that can reach it:

```sh
deploy/check-proxy-count.sh https://kukgrade.example.com
```

It sends 14 failed sign-ins that each claim a different address and reports `OK`
if the sign-in limit still treats them as one visitor. If it reports `TOO HIGH`,
lower `DJANGO_NUM_PROXIES`; if it reports an unexpected HTTP status (a CSRF or host
setting, not the count), fix that first. It uses up the sign-in limit, so your own
sign-ins are refused for about a minute afterwards. A count too low is not caught by one visitor: every
person behind the proxy would share one limit, so if sign-ins lock people out
together, raise it.

To update, take a backup, `git pull`, then pull the images that are not built here
(PostgreSQL and the proxy) and rebuild the app:

```sh
docker compose -f deploy/compose.yml -f deploy/compose.bundled-db.yml pull --ignore-buildable
docker compose -f deploy/compose.yml -f deploy/compose.bundled-db.yml up -d --build
```

(with your proxy file added to both). Dependabot follows the Dockerfile's images
but not these Compose files', so the proxy and PostgreSQL images only change when
you pull; the Cloudflare and Pangolin images are on `latest`.

To serve your own certificate from the app instead of the self-signed one, put the
two files in `deploy/data/tls/` and set `KUKGRADE_TLS_CERT=/var/lib/kukgrade/tls/your.crt`
and `KUKGRADE_TLS_KEY=/var/lib/kukgrade/tls/your.key` in `deploy/.env`. A host
database on the same machine, or on another Compose network, is not reachable from
this stack as written: add the network or `extra_hosts` to `compose.yml` yourself.
The import limit raised through `KUKGRADE_UPLOAD_MAX_BYTES` is still capped by the
6 MB the nginx and Caddy recipes allow (`client_max_body_size`, `max_size`).

## What is in the image

The image is the Python base image plus the app and nothing else it needs to
run or to be repaired. It runs as an unprivileged user (UID 10001) with no
setuid programs, and is meant to run with a read-only root filesystem, all
capabilities dropped and `no-new-privileges` (as `compose.prod.yml` does).

- **Kept, on purpose:** the shell (`sh`), `python`, Django's `manage.py`
  (`shell`, `migrate`, any command: how an operator repairs a deployment) and
  the `openssl` command (the app makes its own certificate with it). There is
  no `psql`; use the PostgreSQL container's.
- **Left out:** the app's tests, `schema.yml`, `uv.lock`, `pyproject.toml`,
  READMEs, the docs and design register, the uncollected copy of the built
  frontend assets, Django's and the REST framework's translations other than
  English, the compiled extensions' C sources, the Django admin's and the
  browsable API's static files, the Brotli library (the compressed assets it
  made are served without it), `pip`, `setuptools`, `wheel`, `idle`, `tkinter`,
  `ensurepip`, C headers, package-manager lists, documentation and manual
  pages (so the Debian per-package copyright files too: keep that in mind
  before publishing the image for others). The image is built so that these
  are really absent from it, not just hidden: the finished filesystem is
  copied into a fresh image, because a file deleted in a later layer would
  still be shipped in the earlier one.
- **Pinned, and kept current for you:** the Python, Node and `uv` base images
  are pinned by digest in the `Dockerfile`, so a rebuild gives the same image.
  Nobody edits the digests: Dependabot opens a pull request when a base image
  (and so its Debian, OpenSSL and Python fixes) or a package changes, CI builds
  it and checks it, and merging a green one is the update (`docs/development-workflow.md`,
  "Dependency updates"). A new Python or Node *line* is a decision, not a
  refresh, and is never proposed automatically.

## Updates, backups and recovery

Before updating, take a PostgreSQL backup using the existing database
container and store it off the host. Record the current Git commit, image
identity and backup location. Then update the checkout and rerun the two
build/start commands above. The image rebuilds from locked Python/npm
dependencies and pinned base images, which merged dependency-update pull
requests keep current; it does not fetch a moving KukGrade image tag.

If an import batch is pending, back up the `kukgrade_import_uploads` volume
alongside the database at a consistent point, or complete/expire the batch
first. Its source file is private but still needed to preview or commit that
batch after a restore. A database dump alone does not contain those files.

For an on-demand custom-format dump, substitute the actual database container,
user and database names, and secure the resulting file:

```sh
docker exec <postgres-container> pg_dump -U <database-user> -d <database-name> -Fc > kukgrade-before-update.dump
```

This is a manual example, not a scheduled backup system. The host's database
operator must set backup frequency, encryption, off-host retention and restore
testing before live student data is entered. A code rollback means building
the previous known-good commit. If its schema is incompatible with migrations
already applied, restore the matching pre-update database backup first.

The `expire_stale_import_batches` command is currently manual. Run it from
the host's scheduler with `docker compose ... exec -T app python manage.py
expire_stale_import_batches --hours 24` so abandoned personal-data uploads
are deleted, along with any stored file no batch names and the stored rows of
imports finished more than 30 days ago (their personal data; the import's
record and counts stay). It exits non-zero if
a batch could not be expired; running it again finishes the job. No worker
container is required.

Django writes an upload to a temporary file before the application can
refuse it for size, so the request body should be capped at the proxy, a
little above `KUKGRADE_UPLOAD_MAX_BYTES`. Nothing caps it yet: that is a
Traefik buffering middleware (`maxRequestBodyBytes`) attached to the
`kukgrade` router in `compose.prod.yml`'s labels, to add and verify against
the real Traefik when going live.

## The Django admin site

The app's sign-in is the only public password entry. The Django admin
(`/admin/`) is **not mounted on the network app** (`kukgrade/urls.py`), and no
setting turns it on there: `/admin/`, `/admin/login/` and every page under it,
and `/static/admin/...` (left out of the image's collected files), answer
`404` and serve nothing of the admin. There is no public readiness
endpoint either: the container's health check asks the database itself. To
confirm on a deployment:

```sh
curl -i https://www.kukgrade.co.uk/admin/            # 404
curl -i https://www.kukgrade.co.uk/admin/login/      # 404, no sign-in form
curl -i https://www.kukgrade.co.uk/static/admin/css/base.css   # 404
curl -i https://www.kukgrade.co.uk/api/ready/        # 404, no readiness endpoint
```

Emergency repair is done from a shell, never over the network:

- `docker exec -it kukgrade python manage.py shell` (or `migrate`,
  `issue_setup_code`, any management command) works in the running
  container. SQL can be run there through `django.db.connection.cursor()`;
  the image has no `psql`, so `manage.py dbshell` does not work in it. The
  PostgreSQL container's own `psql` is the other route
  (`docker exec -it <postgres-container> psql -U <database-user> <database-name>`).
- The admin screens, only when truly needed, are started by hand in a
  throwaway container of the same image, published to the host's loopback
  only, and removed afterwards (substitute the PostgreSQL network and
  `.env.production`):

  ```sh
  docker run --rm -it --env-file .env.production --network <postgres-network> \
      -p 127.0.0.1:9001:9001 --entrypoint python kukgrade:local \
      manage.py runserver 0.0.0.0:9001 --insecure --noreload \
      --settings=kukgrade.settings_admin
  ```

  then open `http://localhost:9001/admin/` on that host (over an SSH tunnel
  if you are working remotely). This serves the admin and nothing else, only
  answers to `localhost` and `127.0.0.1`, and has no HTTPS settings because
  it is meant to be used from the host only. While the container runs it is
  also listening on the PostgreSQL network, so other containers on that
  network could reach it (a staff sign-in is still required, and it is not
  rate-limited): do it only for the length of a repair, with nothing
  untrusted on that network, and stop the container afterwards. For a source
  or bare-metal install, run `python manage.py runserver 127.0.0.1:9001
  --insecure --noreload --settings=kukgrade.settings_admin` on the host
  instead, which listens on loopback only.

Admin accounts are still superusers or staff; a temporary password closes the
admin site as it does the app (`kukgrade.settings_admin` shares the same
sign-in backend).

## Boundaries

- One app service and one Django worker are intentional. The login and
  password-change throttles currently use process-local cache; increasing
  workers or adding app replicas requires a shared cache first.
- The Compose file does not install, reconfigure, start or stop the existing
  Traefik or PostgreSQL containers.
- Production has not been deployed from this repository until the host-specific
  names, credentials, DNS, TLS and a restore test are supplied and verified.
