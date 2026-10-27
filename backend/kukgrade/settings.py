"""Django settings for the KukGrade backend foundation."""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.exceptions import ImproperlyConfigured

from kukgrade.version import VERSION as APP_VERSION

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIST = BASE_DIR / "frontend_dist"


def env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    value = os.environ.get(name, default)
    return [item.strip() for item in value.split(",") if item.strip()]


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None or not value.strip():
        return default
    try:
        return int(value)
    except ValueError as exc:
        msg = f"{name} must be an integer, got {value!r}."
        raise ImproperlyConfigured(msg) from exc


def env_choice(name: str, default: str, choices: tuple[str, ...]) -> str:
    """One of a fixed set of words, checked when settings load."""
    value = os.environ.get(name, "").strip().lower() or default
    if value not in choices:
        msg = f"{name} must be one of {', '.join(choices)}, got {value!r}."
        raise ImproperlyConfigured(msg)
    return value


def env_time_zone(name: str, default: str) -> str:
    """An IANA zone name such as Europe/London, checked when settings load.

    Django does not validate TIME_ZONE until something first needs the zone,
    so a typo would otherwise surface as an error deep inside a request.
    """
    value = os.environ.get(name, "").strip() or default
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        msg = f"{name} must be an IANA time zone such as Europe/London, got {value!r}."
        raise ImproperlyConfigured(msg) from exc
    return value


# DEBUG defaults to False so that a deployment with a missing or incomplete
# environment fails closed rather than serving debug tracebacks.
DEBUG = env_bool("DJANGO_DEBUG", False)

# There is deliberately no production fallback for the secret key. A known
# key would allow session and CSRF token forgery by anyone with repository
# access, so an unconfigured non-debug deployment must refuse to start.
_SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "").strip()
if not _SECRET_KEY:
    # The image made and kept one on its first start (kukgrade/serve.py), so a
    # shell opened in the container finds the same key the app runs with.
    _KEPT_KEY = Path("/var/lib/kukgrade/secret_key")
    if _KEPT_KEY.is_file():
        _SECRET_KEY = _KEPT_KEY.read_text().strip()
if not _SECRET_KEY:
    if not DEBUG:
        _MSG = (
            "DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is false. "
            "Generate one with: python -c "
            "'import secrets; print(secrets.token_urlsafe(64))'"
        )
        raise ImproperlyConfigured(_MSG)
    _SECRET_KEY = "unsafe-development-only-kukgrade-secret-key"
SECRET_KEY = _SECRET_KEY
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

# How the app is reached (docs/deployment.md, "How the app is reached").
# The port the app listens on inside the container (or on the host, for a
# bare-metal install). It is fixed and not an environment variable: to reach
# the app on another port, map it in Compose (`ports: "7443:6942"`), the way
# any container's port is chosen. Not a common service's port, nor one of this
# project's development servers' (8000, 5173, 5432).
PORT = 6942
# How many reverse proxies or tunnels sit in front of the app, each trusted.
# 0: reached directly. Above 0: TLS ends at the proxies, the forwarded scheme
# is trusted, and the client address is the Nth-from-last X-Forwarded-For
# entry. The wrong count lets every visitor share one address (the login
# throttle then locks everyone out together) or lets a client choose theirs.
PROXY_HOPS = env_int("DJANGO_NUM_PROXIES", 0)
if PROXY_HOPS < 0:
    _MSG = f"DJANGO_NUM_PROXIES must be 0 or more, got {PROXY_HOPS}."
    raise ImproperlyConfigured(_MSG)
# With no proxy in front: "https" serves TLS itself (a mounted certificate or
# a generated self-signed one, kukgrade/tls.py); "http" serves plain HTTP,
# only for a network you trust. With proxies in front it has no effect.
TRANSPORT = env_choice("KUKGRADE_TRANSPORT", "https", ("https", "http"))
# The certificate and key to serve TLS with; both or neither. Neither means a
# self-signed pair, generated under KUKGRADE_TLS_DIR and kept there.
TLS_CERT_FILE = os.environ.get("KUKGRADE_TLS_CERT", "").strip()
TLS_KEY_FILE = os.environ.get("KUKGRADE_TLS_KEY", "").strip()
if bool(TLS_CERT_FILE) != bool(TLS_KEY_FILE):
    _MSG = "KUKGRADE_TLS_CERT and KUKGRADE_TLS_KEY must be set together."
    raise ImproperlyConfigured(_MSG)
TLS_DIR = Path(
    os.environ.get("KUKGRADE_TLS_DIR", "").strip() or "/var/lib/kukgrade/tls"
)

# Transport security. Every value defaults to the secure setting whenever
# DEBUG is false, so a production deployment is hardened by default and a
# developer opts out locally rather than opting in for production. The one
# deliberate exception is a deployment reached directly (no proxy) that has
# been told to serve plain HTTP: KUKGRADE_TRANSPORT=http, for a trusted
# network, turns the HTTPS redirect, secure cookies and HSTS off, since a
# browser would otherwise never send the session cookie back.
PLAIN_HTTP = not DEBUG and PROXY_HOPS == 0 and TRANSPORT == "http"
_SECURE_TRANSPORT = not DEBUG and not PLAIN_HTTP
# The app itself terminates TLS: reached directly, told to serve HTTPS, and not
# the development server (kukgrade/gunicorn_conf.py reads this).
SERVES_TLS = not DEBUG and PROXY_HOPS == 0 and TRANSPORT == "https"

INSTALLED_APPS = [
    "accounts",
    "accounts.apps.KukGradeAdminConfig",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "health",
    "ranks",
    "students",
    "syllabus",
    "gradings",
    "audit",
    "data_imports",
    "drf_spectacular",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    # Immediately after authentication: it needs request.user, and every
    # view behind it must be gated.
    "accounts.middleware.ForcePasswordChangeMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
# Development uses Django's staticfiles handler; only the collected image
# needs WhiteNoise, immediately after SecurityMiddleware.
if not DEBUG:
    MIDDLEWARE.insert(1, "whitenoise.middleware.WhiteNoiseMiddleware")

ROOT_URLCONF = "kukgrade.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [FRONTEND_DIST] if FRONTEND_DIST.is_dir() else [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "kukgrade.wsgi.application"

# PostgreSQL only. A SQLite fallback branch used to exist here; it could not
# actually run this application - migration 0006 issues raw PostgreSQL
# ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY DDL, and SQLite does not
# support the SELECT ... FOR UPDATE locking every write path in
# gradings/services.py depends on. A developer who found that switch got a
# bare SQL syntax error rather than a reason, so it was removed rather than
# fixed: nothing in this codebase can honestly run against SQLite.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "kukgrade"),
        "USER": os.environ.get("POSTGRES_USER", "kukgrade"),
        "PASSWORD": os.environ.get(
            "POSTGRES_PASSWORD",
            "kukgrade_local_password",
        ),
        # The image carries its own PostgreSQL, on a socket in this folder
        # (kukgrade/serve.py); the variable is set only inside that image.
        "HOST": os.environ.get("POSTGRES_HOST", "").strip()
        or os.environ.get("KUKGRADE_EMBEDDED_SOCKET")
        or "127.0.0.1",
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
    }
}

# The one password policy (accounts/password_policy.py), run by every path
# that sets a password. Django's numeric-only check is not listed: the
# character rules already require letters.
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "accounts.password_policy.LengthValidator"},
    {"NAME": "accounts.password_policy.CharacterRulesValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"
        ),
    },
]

# Who may sign in: Django's own rules, and no temporary password past its
# expiry. One backend, so the API's sign-in, the admin site's and every
# signed-in request all apply it (accounts/backends.py). Every session records
# this path: renaming or moving the class signs everyone out unless a
# migration re-points their sessions, as accounts 0007 did for this one.
AUTHENTICATION_BACKENDS = ["accounts.backends.AccountBackend"]

# How long a temporary password an administrator issues stays usable.
_TEMPORARY_PASSWORD_HOURS = env_int("KUKGRADE_TEMPORARY_PASSWORD_HOURS", 24)
if _TEMPORARY_PASSWORD_HOURS < 1:
    msg = "KUKGRADE_TEMPORARY_PASSWORD_HOURS must be at least 1."
    raise ImproperlyConfigured(msg)
TEMPORARY_PASSWORD_LIFETIME = timedelta(hours=_TEMPORARY_PASSWORD_HOURS)

LANGUAGE_CODE = "en-gb"
# The club's own zone: "today" for grading dates, student ages and age bands is
# the date there. Stored timestamps are UTC whatever this is. Django also sets
# the process's TZ from it. A container is set up with this one variable, the
# usual TZ; the screens are told the zone by /api/site/ and /api/about/.
TIME_ZONE = env_time_zone("TZ", "Europe/London")
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [FRONTEND_DIST] if FRONTEND_DIST.is_dir() else []
# Vite already puts a content hash in each production asset name. Keep its
# original URL in index.html while WhiteNoise applies immutable caching.
WHITENOISE_IMMUTABLE_FILE_TEST = r"^/static/assets/.+-[A-Za-z0-9_-]{8}\.(?:js|css)$"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.User"

# Private temp storage for uploaded data-import source files (student
# rosters, legacy grading workbooks) - never wired to a public MEDIA_URL.
# Must be a persistent volume in any containerised deployment, the same
# requirement the database's own data directory already has. Registered as
# a named STORAGES alias (Django 5.1+) rather than passed to FileField as a
# concrete FileSystemStorage instance, so migrations serialize the stable
# string "import_uploads" instead of baking this machine's absolute
# IMPORT_UPLOAD_ROOT path into a committed migration file.
IMPORT_UPLOAD_ROOT = Path(
    os.environ.get(
        "KUKGRADE_IMPORT_UPLOAD_ROOT",
        str(BASE_DIR / "var" / "import_uploads"),
    ),
)
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
    "import_uploads": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
        "OPTIONS": {"location": IMPORT_UPLOAD_ROOT, "base_url": None},
    },
}

# The largest spreadsheet the data-import feature accepts, enforced by
# data_imports.services.create_import_batch. Django's own request limits
# follow it: an upload that size stays in memory rather than spilling to the
# container's small /tmp, and a preview/commit request carrying per-row
# corrections for a file that size is not refused as too large.
IMPORT_UPLOAD_MAX_BYTES = env_int("KUKGRADE_UPLOAD_MAX_BYTES", 5 * 1024 * 1024)
DATA_UPLOAD_MAX_MEMORY_SIZE = IMPORT_UPLOAD_MAX_BYTES
FILE_UPLOAD_MAX_MEMORY_SIZE = IMPORT_UPLOAD_MAX_BYTES

# The browsable API renders an HTML UI over the whole authenticated API,
# including student names, WKSA IDs and grading notes. Debug only.
_RENDERER_CLASSES = ["rest_framework.renderers.JSONRenderer"]
if DEBUG:
    _RENDERER_CLASSES.append("rest_framework.renderers.BrowsableAPIRenderer")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_RENDERER_CLASSES": _RENDERER_CLASSES,
    "EXCEPTION_HANDLER": "kukgrade.exceptions.custom_exception_handler",
    "DEFAULT_PAGINATION_CLASS": "kukgrade.pagination.DefaultPagination",
    # Each list view declares its filters once, in `query_filters`; this
    # applies them and documents them in the schema (kukgrade/filtering.py).
    "DEFAULT_FILTER_BACKENDS": ["kukgrade.filtering.DeclaredQueryFilters"],
    # Scoped so it only throttles views that opt in with throttle_scope - a
    # view without one is never rate limited by this. Login, password change
    # and first-administrator setup opt in to their own scopes.
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {
        "login": "10/min",
        "password_change": "10/min",
        "setup": "10/min",
    },
    # How many proxies sit in front, each trusted: the client address is the
    # Nth-from-last X-Forwarded-For entry (see PROXY_HOPS). Zero ignores
    # X-Forwarded-For altogether.
    "NUM_PROXIES": PROXY_HOPS,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

# The frontend generates its TypeScript types from this schema rather than
# hand-maintaining them (2026-09-14 decision) - see
# frontend/package.json's generate:types script.
SPECTACULAR_SETTINGS = {
    "TITLE": "KukGrade API",
    "DESCRIPTION": (
        "Grading management API for Kuk Sool Won instructors and administrators."
    ),
    "VERSION": APP_VERSION,
    "SERVE_INCLUDE_SCHEMA": False,
    # Separate request and response components (StudentRequest,
    # PatchedStudentRequest, ...) so the frontend's request payloads are
    # generated too, without the read-only fields a response carries.
    "COMPONENT_SPLIT_REQUEST": True,
    # Five different models each have their own "status" field, and two have
    # a "category" field - without this every one of them collides on the
    # same generated enum name. CandidateOutcome.Outcome and syllabus.AgeBand
    # are each reused across two fields and get named inconsistently
    # depending on which field is processed first; pinning one name each
    # keeps the generated schema (and the frontend types built from it)
    # stable across regenerations.
    "ENUM_NAME_OVERRIDES": {
        "StudentStatusEnum": "students.models.Student.Status",
        "GradingSessionStatusEnum": "gradings.models.GradingSession.Status",
        "GradingCandidateStatusEnum": "gradings.models.GradingCandidate.Status",
        "WithdrawalReasonEnum": "gradings.models.GradingCandidate.WithdrawalReason",
        "CandidateAssessmentStatusEnum": "gradings.models.CandidateAssessment.Status",
        "CandidateOutcomeStatusEnum": "gradings.models.CandidateOutcome.Status",
        "CandidateOutcomeOutcomeEnum": "gradings.models.CandidateOutcome.Outcome",
        "BeltColourEnum": "ranks.models.BeltColour",
        "SyllabusItemCategoryEnum": "syllabus.models.SyllabusItem.Category",
        "AgeBandEnum": "syllabus.models.AgeBand",
        "GradingStageEnum": "gradings.read_models.GradingStage",
        "AuditEntityEnum": "audit.models.AuditEntity",
        "StudentImportRowOutcomeEnum": (
            "data_imports.services.StudentImportRowOutcome"
        ),
    },
}

# Which build this is, shown on the About page (docs/deployment.md passes them
# as build arguments). Unset when running from a checkout.
BUILD_COMMIT = os.environ.get("KUKGRADE_BUILD_COMMIT", "").strip()[:40]
if not re.fullmatch("[0-9a-f]{7,40}", BUILD_COMMIT):
    BUILD_COMMIT = ""
BUILD_TIME = os.environ.get("KUKGRADE_BUILD_TIME", "").strip()
try:
    datetime.fromisoformat(BUILD_TIME)
except ValueError:
    BUILD_TIME = ""

# The club this deployment serves, shown in the application's top bar.
CLUB_NAME = os.environ.get("KUKGRADE_CLUB_NAME", "").strip() or "Kuk Sool Won"

# The school's own prefix in its student IDs, 206-2 for Colchester
# (students/wksa_ids.py). Used in the example IDs shown; a transfer's ID may
# carry another school's. Its pattern is a literal here, since settings
# cannot import application code.
SCHOOL_ID_PREFIX = os.environ.get("KUKGRADE_SCHOOL_PREFIX", "").strip() or "206-2"
if not re.fullmatch("[0-9]{3}-[0-9]", SCHOOL_ID_PREFIX):
    msg = "KUKGRADE_SCHOOL_PREFIX must look like 206-2."
    raise ImproperlyConfigured(msg)

CORS_ALLOWED_ORIGINS = env_list(
    "DJANGO_CORS_ALLOWED_ORIGINS",
    "http://localhost:5173",
)
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env_list(
    "DJANGO_CSRF_TRUSTED_ORIGINS",
    "http://localhost:5173",
)
CSRF_FAILURE_VIEW = "kukgrade.exceptions.csrf_failure"
SESSION_COOKIE_SECURE = env_bool("DJANGO_SESSION_COOKIE_SECURE", _SECURE_TRANSPORT)
CSRF_COOKIE_SECURE = env_bool("DJANGO_CSRF_COOKIE_SECURE", _SECURE_TRANSPORT)
SESSION_COOKIE_HTTPONLY = True
# Signed out after two hours with no request. Saving on every request slides
# the expiry forward, so the two hours count from the last activity, not
# from sign-in. The frontend never polls, so an idle tab does not keep a
# session alive on its own.
SESSION_COOKIE_AGE = 2 * 60 * 60
SESSION_SAVE_EVERY_REQUEST = True
CSRF_COOKIE_HTTPONLY = False
SESSION_COOKIE_SAMESITE = os.environ.get("DJANGO_SESSION_COOKIE_SAMESITE", "Lax")
CSRF_COOKIE_SAMESITE = os.environ.get("DJANGO_CSRF_COOKIE_SAMESITE", "Lax")

# Transport security. Every value defaults to the secure setting; see
# _SECURE_TRANSPORT above.
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", _SECURE_TRANSPORT)
SECURE_HSTS_SECONDS = env_int(
    "DJANGO_SECURE_HSTS_SECONDS",
    31536000 if _SECURE_TRANSPORT else 0,
)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool(
    "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS",
    _SECURE_TRANSPORT,
)
# Preload is off by default: listing the domain in browsers' preload lists is
# close to permanent for kukgrade.co.uk and every subdomain, and the header's
# preload token alone lets anyone submit it. A year of HSTS plus Cloudflare's
# HTTPS redirect covers the first visit well enough. Opt in deliberately.
SECURE_HSTS_PRELOAD = env_bool("DJANGO_SECURE_HSTS_PRELOAD", False)
# check --deploy warns when preload is off; that is the decision above, not an
# oversight (2026-09-28 decision log entry).
SILENCED_SYSTEM_CHECKS = [] if SECURE_HSTS_PRELOAD else ["security.W021"]

# Set when proxies are declared in front (PROXY_HOPS above zero), so Django
# can tell an already-secure request from one that needs redirecting. Declaring
# a proxy is the opt-in: trusting this header is only safe when the proxy is
# guaranteed to strip or overwrite any client-supplied value first, and
# Django's own documentation warns that trusting it without that guarantee
# lets a client spoof "this request is already secure" and defeat
# SECURE_SSL_REDIRECT. That guarantee is a deployment fact this code cannot
# verify, so with no proxy declared the header is never trusted.
if PROXY_HOPS > 0:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# No request body, no user object and no exception argument is ever passed
# to a log call anywhere in this codebase - only plain, pre-formatted
# strings such as an email address, so a stray password or session cookie
# cannot end up in a log line by accident. "kukgrade.security" is the one
# app logger today, used for failed login attempts.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "plain": {
            "format": "{asctime} {levelname} {name} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "plain",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO",
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": False,
        },
        "kukgrade.security": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
    },
}
