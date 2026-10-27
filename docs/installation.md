# Installation

KukGrade runs as **one Docker container**. The image carries the application
and its own PostgreSQL database, so there is nothing else to install, and
everything it stores lives in one folder you can back up.

**You need:** a machine with [Docker](https://docs.docker.com/get-docker/) and
Docker Compose v2 (`docker compose version`), about 1 GB of free memory, and git.

## Quick start

```sh
git clone https://github.com/TheRedTower/KukGrade.git
cd KukGrade/deploy
cp .env.example .env
docker compose up -d
```

The first run builds the image, which takes a few minutes. When it finishes:

1. Find the one-time setup code in the log:

   ```sh
   docker compose logs | grep "setup code"
   ```

2. Open <https://localhost:6942>. Your browser warns about the certificate
   because the app made its own (see [HTTPS](#choose-how-people-reach-it)); accept it to continue.
3. Enter the setup code and create the first administrator. The password must
   be 16 to 64 characters with an uppercase letter, a lowercase letter, a
   number and a special character.

That account is a superuser. From then on, add everyone else from the **Users**
screen; there is no default password and setup is refused once an administrator
exists. A restart issues a new setup code only while no administrator exists.

> **Before you put in real student data:** set up HTTPS properly (below), take a
> backup, and test restoring it. KukGrade holds personal data about children.

## Settings

Everything is configured in `deploy/.env`. The three you should look at first:

| Setting | What to put |
| --- | --- |
| `DJANGO_ALLOWED_HOSTS` | The name people type to reach KukGrade, with no scheme or port (`grading.example.org`). |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | The same address as the browser shows it, with scheme and port (`https://grading.example.org`). |
| `KUKGRADE_CLUB_NAME` | Your school's name, shown in the sidebar. |

[configuration.md](configuration.md) lists every setting. If sign-in fails with
a "CSRF" or "origin" error, these two do not match the address in the browser's
address bar.

## Choose how people reach it

With no extra setup the app serves HTTPS itself on port 6942 using a certificate
it makes for itself. It encrypts the connection but browsers warn about it, so
for real use put something in front, or bring a real certificate.

| File (in `deploy/`) | Who handles HTTPS | Open on the host | Set in `.env` |
| --- | --- | --- | --- |
| `compose.yml` | The app (self-signed, or your own certificate) | 6942 | nothing |
| `compose.caddy.yml` | [Caddy](https://caddyserver.com), automatic certificates | 80, 443 | `KUKGRADE_DOMAIN`, `DJANGO_NUM_PROXIES=1` |
| `compose.nginx.yml` | nginx, your certificate in `deploy/certs/` | 80, 443 | `DJANGO_NUM_PROXIES=1` |
| `compose.traefik.yml` | Your existing Traefik | none | `TRAEFIK_NETWORK`, `KUKGRADE_HOST`, `DJANGO_NUM_PROXIES=1` (2 with Cloudflare in front) |
| `compose.cloudflared.yml` | A Cloudflare Tunnel | none | `TUNNEL_TOKEN`, `DJANGO_NUM_PROXIES=1` |
| `compose.pangolin.yml` | Your Pangolin server | none | `PANGOLIN_ENDPOINT`, `NEWT_ID`, `NEWT_SECRET`, `DJANGO_NUM_PROXIES=1` |

For example, with Caddy:

```sh
docker compose -f compose.caddy.yml up -d
```

The first four were brought up with the real proxy in front and checked. The
Cloudflare Tunnel and Pangolin files need accounts the maintainers do not have,
so they follow the providers' documented behaviour but are untested.

### Telling KukGrade how many proxies are in front

`DJANGO_NUM_PROXIES` is the number of reverse proxies or tunnels between the
visitor and the app. It matters for security: sign-in attempts are rate-limited
per visitor, and the visitor's address comes from the proxy.

- **Too low:** every visitor looks like the proxy, so one person's failed
  sign-ins lock everyone out together.
- **Too high:** a visitor can pretend to be someone else.

The first proxy must discard any `X-Forwarded-For` and `X-Forwarded-Proto` a
visitor sends, and the app's own port must not be reachable except through it.
Once it is running, check the count:

```sh
deploy/check-proxy-count.sh https://grading.example.org
```

It prints `OK`, or `TOO HIGH` with what to change. It uses up the sign-in limit,
so your own sign-ins are refused for about a minute afterwards.

### Plain HTTP on a trusted network

To run without HTTPS on a network you trust, set `KUKGRADE_TRANSPORT=http`. This
turns off the HTTPS redirect, secure cookies and HSTS, and the app logs a
warning at start. Passwords and sessions travel unencrypted.

### Your own certificate

Put the two files in `deploy/data/tls/` and set `KUKGRADE_TLS_CERT=/var/lib/kukgrade/tls/your.crt`
and `KUKGRADE_TLS_KEY=/var/lib/kukgrade/tls/your.key`.

## Where your data lives

Everything is under `deploy/data/`, mounted into the container at
`/var/lib/kukgrade`. There is no other data or config folder.

| Inside `data/` | What it holds | If you lose it |
| --- | --- | --- |
| `postgres/` | The database | Everything. Restore from a backup. |
| `secret_key` | The key sessions are signed with (made on first start) | Everyone is signed out. |
| `import_uploads/` | Spreadsheets waiting to be imported (cleared after 24 hours) | An unfinished import restarts. |
| `tls/` | The self-signed certificate | The app makes a new one. |
| `caddy/` | Caddy's certificates (Caddy file only) | Caddy asks for new ones. |

`data/` belongs to UID 10001, the unprivileged user the container runs as. Do
not run `git clean -fdx` in the checkout, and do not commit the folder (it is
git-ignored).

## Backups

Back up while the stack is running. Use a database dump, not a copy of
`data/postgres/`:

```sh
docker compose exec -T kukgrade sh -c 'pg_dump -Fc -U "${POSTGRES_USER:-kukgrade}" "${POSTGRES_DB:-kukgrade}"' > kukgrade-$(date +%F).dump
docker compose exec -T kukgrade tar -C /var/lib/kukgrade -czf - import_uploads > kukgrade-uploads-$(date +%F).tar.gz
```

Keep copies off the machine, and run these on a schedule (cron, a systemd timer,
or your host's backup tool). KukGrade does not schedule backups for you.

**Restore** replaces the database, signs everyone out, and drops whatever is there:

```sh
docker compose exec -T kukgrade sh -c 'U=${POSTGRES_USER:-kukgrade}; D=${POSTGRES_DB:-kukgrade}; psql -U $U -d postgres -c "DROP DATABASE IF EXISTS \"$D\" WITH (FORCE)" -c "CREATE DATABASE \"$D\"" && pg_restore -U $U -d $D' < kukgrade-DATE.dump
docker compose restart
```

Restarting runs any migrations the dump lacks. To restore uploads too:
`docker compose exec -T kukgrade tar -C /var/lib/kukgrade -xzf - < kukgrade-uploads-DATE.tar.gz`.

## Updating

Take a backup first, then:

```sh
git pull
docker compose up -d --build
```

(add `-f compose.caddy.yml` or your own file). Database migrations run
automatically when the container starts. To go back, check out the previous
version; if its schema is incompatible with migrations already applied, restore
the backup you took first.

The PostgreSQL version is fixed by the image (17). A later image with a different
major version refuses to start on an old `data/postgres/` and says so; move the
data across with a dump from the old image and a restore into the new one.

## Using a PostgreSQL you already run

Set `POSTGRES_HOST` (and `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`) in `.env`. The container then starts no database of its own.
The role must own its database so migrations can run. [`deploy/compose.external-db.yml`](../deploy/compose.external-db.yml)
is a hardened example (read-only filesystem, all capabilities dropped) that joins
existing Traefik and PostgreSQL Docker networks; its variables are listed in the file.

## Maintenance

Abandoned import uploads contain personal data. Delete them with:

```sh
docker compose exec -T kukgrade python manage.py expire_stale_import_batches --hours 24
```

Run it daily from a scheduler. It also removes stored rows from imports finished
over 30 days ago.

The container runs one application worker on purpose. The sign-in throttle is
held in that process's memory, so running several workers or replicas needs a
shared cache first.

## The Django admin site

The Django admin is **not served by the network app**: `/admin/` answers 404.
This keeps a second password entry point off the internet. It is for emergency
repair only, from a shell on the host:

```sh
docker compose exec -it kukgrade python manage.py shell     # or migrate, or any command
docker compose exec -it kukgrade psql -U postgres           # the image's own database
```

If you truly need the admin screens, the repository's `kukgrade.settings_admin`
runs them on loopback only; stop the stack first and read the comments in
[`backend/kukgrade/settings_admin.py`](../backend/kukgrade/settings_admin.py).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `grep "setup code"` prints nothing | An administrator already exists (setup is finished), or the container is still starting: `docker compose logs`. |
| "CSRF verification failed" or "origin" error on sign-in | `DJANGO_ALLOWED_HOSTS` or `DJANGO_CSRF_TRUSTED_ORIGINS` does not match the address in the browser, including the port. |
| Everyone is locked out of signing in together | `DJANGO_NUM_PROXIES` is lower than the proxies in front. Run `check-proxy-count.sh`. |
| Browser warns the certificate is not trusted | Expected with the self-signed certificate. Use a proxy with a real certificate, or provide your own. |
| `permission denied` on `data/` | The folder is not writable by UID 10001. On a NAS or Windows host that manages ownership itself, set it by hand. |
| Port 6942 already in use | Change the left side of `ports:` in the compose file (`"7443:6942"`). Anything routing to the app still targets 6942. |
| Container restarts repeatedly | `docker compose logs`: usually a missing or invalid `.env` value. A failed migration also shows here. |
