# Configuration

KukGrade is configured entirely through environment variables. For a Docker
install, put them in `deploy/.env` (copy it from `deploy/.env.example`). Names
are case-sensitive; a value left out uses the default shown.

## Your school

| Variable | Default | Meaning |
| --- | --- | --- |
| `KUKGRADE_CLUB_NAME` | `Kuk Sool Won` | The school's name, shown in the sidebar. |
| `KUKGRADE_SCHOOL_PREFIX` | `123-4` | Your school's prefix in student IDs (`123-4-150`): three digits, a dash, one digit. Set it to yours; it is used for the example shown when adding a student. |
| `TZ` | `Europe/London` | The school's time zone (an [IANA name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)). It decides what "today" is, how old a student is on a given day, and the times the screens show. |

## Reaching the app

| Variable | Default | Meaning |
| --- | --- | --- |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Comma-separated host names people use, without scheme or port. |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | none | Comma-separated origins as the browser shows them, with scheme and port (`https://grading.example.org`). Needed whenever you use HTTPS or a non-default port. |
| `DJANGO_NUM_PROXIES` | `0` | How many reverse proxies or tunnels sit in front of the app. See [installation](installation.md#telling-kukgrade-how-many-proxies-are-in-front). |
| `KUKGRADE_TRANSPORT` | `https` | Only when `DJANGO_NUM_PROXIES=0`: `https` serves TLS itself; `http` serves plain HTTP (turns off the HTTPS redirect, secure cookies and HSTS). |
| `KUKGRADE_TLS_CERT`, `KUKGRADE_TLS_KEY` | none | Paths to your own certificate and key (both or neither). Without them the app makes a self-signed pair. |
| `KUKGRADE_TLS_DIR` | `/var/lib/kukgrade/tls` | Where the self-signed pair is kept. |

The app listens on port **6942**. To expose it on another host port, change the
`ports:` mapping in Compose (`"7443:6942"`).

## Secrets and accounts

| Variable | Default | Meaning |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | made on first start | A long random value that signs sessions. Leave it out and the image makes one and keeps it in `data/secret_key`. To choose your own: `python3 -c "import secrets; print(secrets.token_urlsafe(64))"`. |
| `KUKGRADE_TEMPORARY_PASSWORD_HOURS` | `24` | How long a temporary password issued by an administrator keeps working (at least 1). |

## Database

By default the image runs its own PostgreSQL and none of these are needed. To use
a PostgreSQL you already run, set `POSTGRES_HOST`; the container then starts no
database of its own.

| Variable | Default | Meaning |
| --- | --- | --- |
| `POSTGRES_HOST` | unset (use the built-in database) | Host of your own PostgreSQL. |
| `POSTGRES_PORT` | `5432` | Its port. |
| `POSTGRES_DB` | `kukgrade` | Database name. The role must own it, so migrations can run. |
| `POSTGRES_USER` | `kukgrade` | Role name. |
| `POSTGRES_PASSWORD` | development value | Role password. Always set your own when using an external database. |

## Imports

| Variable | Default | Meaning |
| --- | --- | --- |
| `KUKGRADE_UPLOAD_MAX_BYTES` | `5242880` (5 MiB) | Largest spreadsheet an import will accept. Also cap request size at your proxy, a little above this. |

## Transport security (rarely changed)

When `DJANGO_DEBUG` is off, each of these defaults to its secure value. They only
need setting to opt out.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DJANGO_SECURE_SSL_REDIRECT` | on | Redirect HTTP to HTTPS. |
| `DJANGO_SECURE_HSTS_SECONDS` | `31536000` | HSTS lifetime. |
| `DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS` | on | Apply HSTS to subdomains. |
| `DJANGO_SECURE_HSTS_PRELOAD` | off | Opt in to HSTS preload only if you understand it is hard to undo. |
| `DJANGO_SESSION_COOKIE_SECURE`, `DJANGO_CSRF_COOKIE_SECURE` | on | Send the cookies over HTTPS only. |
| `DJANGO_SESSION_COOKIE_SAMESITE`, `DJANGO_CSRF_COOKIE_SAMESITE` | `Lax` | SameSite policy. |

## Build information

Set these in the shell **before building** and the About page shows which build
is running (only to signed-in users):

```sh
export KUKGRADE_BUILD_COMMIT="$(git rev-parse --short HEAD)"
export KUKGRADE_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

## Development only

| Variable | Meaning |
| --- | --- |
| `DJANGO_DEBUG` | `true` for local development. Defaults to `false`; with it off, a missing secret key stops the app from starting rather than falling back to a known one. |
| `DJANGO_CORS_ALLOWED_ORIGINS` | Origins allowed to call the API cross-origin, such as the Vite dev server (`http://localhost:5173`). Not needed in production: the frontend is served from the same origin. |
| `VITE_API_BASE_URL` | Where the dev frontend finds the API (default `http://localhost:8000`). |

See [development.md](development.md).
