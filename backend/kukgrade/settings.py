"""Django settings for the KukGrade backend foundation."""

from __future__ import annotations

import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


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
    "drf_spectacular",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "kukgrade.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
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

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": (
            "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"
        ),
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

LANGUAGE_CODE = "en-gb"
TIME_ZONE = "Europe/London"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.User"

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
    "PAGE_SIZE": 50,
    # Scoped so it only throttles views that opt in with throttle_scope - a
    # view without one is never rate limited by this. LoginView is the only
    # one that sets it today, since unlimited password attempts is the risk
    # this exists to close.
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"login": "10/min", "password_change": "10/min"},
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
        "CandidateAssessmentStatusEnum": "gradings.models.CandidateAssessment.Status",
        "CandidateOutcomeStatusEnum": "gradings.models.CandidateOutcome.Status",
        "CandidateOutcomeOutcomeEnum": "gradings.models.CandidateOutcome.Outcome",
        "RankCategoryEnum": "ranks.models.Rank.Category",
        "SyllabusItemCategoryEnum": "syllabus.models.SyllabusItem.Category",
        "AgeBandEnum": "syllabus.models.AgeBand",
    },
}

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
SECURE_HSTS_PRELOAD = env_bool("DJANGO_SECURE_HSTS_PRELOAD", not DEBUG)

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
