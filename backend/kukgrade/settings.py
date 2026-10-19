"""Django settings for the KukGrade backend foundation."""

from __future__ import annotations

import os
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.exceptions import ImproperlyConfigured

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

INSTALLED_APPS = [
    "accounts",
    "django.contrib.admin",
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
        "HOST": os.environ.get("POSTGRES_HOST", "127.0.0.1"),
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

LANGUAGE_CODE = "en-gb"
# The club's own zone: "today" for grading dates, student ages and age bands is
# the date there. Stored timestamps are UTC whatever this is. Django also sets
# the process's TZ from it, so the container needs no separate TZ variable.
TIME_ZONE = env_time_zone("DJANGO_TIME_ZONE", "Europe/London")
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
    # view without one is never rate limited by this. LoginView is the only
    # one that sets it today, since unlimited password attempts is the risk
    # this exists to close.
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"login": "10/min", "password_change": "10/min"},
    # Production sits behind Cloudflare and then Traefik: two trusted hops,
    # so the client address is the second-to-last X-Forwarded-For entry.
    # Zero ignores untrusted X-Forwarded-For in native development.
    "NUM_PROXIES": env_int("DJANGO_NUM_PROXIES", 0),
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
    "VERSION": "1.0.0",
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

# The club this deployment serves, shown in the application's top bar.
CLUB_NAME = os.environ.get("KUKGRADE_CLUB_NAME", "").strip() or "Kuk Sool Won"

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
SESSION_COOKIE_SECURE = env_bool("DJANGO_SESSION_COOKIE_SECURE", not DEBUG)
CSRF_COOKIE_SECURE = env_bool("DJANGO_CSRF_COOKIE_SECURE", not DEBUG)
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

# Transport security. Every value defaults to the secure setting whenever
# DEBUG is false, so a production deployment is hardened by default and a
# developer opts out locally rather than opting in for production.
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", not DEBUG)
SECURE_HSTS_SECONDS = env_int(
    "DJANGO_SECURE_HSTS_SECONDS",
    0 if DEBUG else 31536000,
)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool(
    "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS",
    not DEBUG,
)
# Preload is off by default: listing the domain in browsers' preload lists is
# close to permanent for kukgrade.co.uk and every subdomain, and the header's
# preload token alone lets anyone submit it. A year of HSTS plus Cloudflare's
# HTTPS redirect covers the first visit well enough. Opt in deliberately.
SECURE_HSTS_PRELOAD = env_bool("DJANGO_SECURE_HSTS_PRELOAD", False)
# check --deploy warns when preload is off; that is the decision above, not an
# oversight (2026-09-28 decision log entry).
SILENCED_SYSTEM_CHECKS = [] if SECURE_HSTS_PRELOAD else ["security.W021"]

# Set when TLS terminates at a reverse proxy that forwards the scheme, so
# Django can tell an already-secure request from one that needs redirecting.
# Defaults off even in production, unlike every other transport setting
# above: trusting this header is only safe when the proxy is guaranteed to
# strip or overwrite any client-supplied value first, and Django's own
# documentation warns that enabling it without that guarantee lets a client
# spoof "this request is already secure" and defeat SECURE_SSL_REDIRECT.
# That guarantee is a deployment fact this code cannot verify, so it has to
# be opted into rather than assumed.
if env_bool("DJANGO_BEHIND_TLS_PROXY", False):
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
