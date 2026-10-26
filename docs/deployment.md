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
pending Django migrations, and waits for `/api/ready/` to report that the app
and database are available. A failed migration leaves the app unable to serve
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
`/students/42`, `/api/health/`, and `/api/ready/`. Check an authenticated
write to confirm session cookies and CSRF across the HTTPS proxy. The
frontend calls `/api/` on the same origin; no production CORS origin or API
subdomain is needed.

## How the app is reached

One setting says what is in front of the app: `DJANGO_NUM_PROXIES`, the number
of reverse proxies or tunnels, each trusted to overwrite `X-Forwarded-For` and
`X-Forwarded-Proto`. Everything else follows from it.

| `DJANGO_NUM_PROXIES` | The app | TLS | Client address for the login throttle |
| --- | --- | --- | --- |
| `0` (default) | reached directly on its port | the app serves HTTPS itself, or plain HTTP if `KUKGRADE_TRANSPORT=http` | the connection's own address; `X-Forwarded-For` is ignored |
| `N` above 0 | plain HTTP behind `N` proxies | ends at the proxies; the forwarded scheme is trusted | the Nth-from-last `X-Forwarded-For` entry |

The count must match what really sits in front. Too low and visitors are all
seen as the proxy's address (the login throttle locks everyone out together);
too high and a client can choose its own address. Do not publish the app's port
to anyone but the proxy when proxies are declared, or a client could reach it
directly with forged headers.

- `KUKGRADE_PORT` (default `6942`): the port the app listens on, inside the
  container and published outside it. It is not a common service's port nor
  one of this project's development servers' (8000, 5173, 5432).
- `KUKGRADE_TRANSPORT` (`https`, the default, or `http`): only for
  `DJANGO_NUM_PROXIES=0`. `https` serves TLS from the certificate in
  `KUKGRADE_TLS_CERT` and the key in `KUKGRADE_TLS_KEY` (both or neither), or,
  with neither, from a self-signed pair the app makes on first start and keeps
  in `KUKGRADE_TLS_DIR` (default `/var/lib/kukgrade/tls`, a volume that must be
  writable by UID 10001), made again at start when under 30 days remain (restart
  to renew a long-running container or to add a new host name). A self-signed
  certificate encrypts the connection but browsers will warn about it; bring a
  real certificate for a real name. `http` turns the HTTPS redirect, secure
  cookies and HSTS off, and logs a warning at start: passwords and sessions
  travel unencrypted, so use it only on a network you trust.

The owner's Traefik deployment (`compose.prod.yml`) is `DJANGO_NUM_PROXIES=2`
(Cloudflare, then Traefik); the app's own port stays unpublished there.

## Updates, backups and recovery

Before updating, take a PostgreSQL backup using the existing database
container and store it off the host. Record the current Git commit, image
identity and backup location. Then update the checkout and rerun the two
build/start commands above. The image rebuilds from locked Python/npm
dependencies; it does not fetch a moving KukGrade image tag.

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

## Boundaries

- One app service and one Django worker are intentional. The login and
  password-change throttles currently use process-local cache; increasing
  workers or adding app replicas requires a shared cache first.
- The Compose file does not install, reconfigure, start or stop the existing
  Traefik or PostgreSQL containers.
- Production has not been deployed from this repository until the host-specific
  names, credentials, DNS, TLS and a restore test are supplied and verified.
