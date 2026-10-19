"""Keep sessions signed in across the switch to AccountBackend.

A session records the dotted path of the backend that signed it in, and
Django loads its user only while that path is still listed in
AUTHENTICATION_BACKENDS. Replacing Django's ModelBackend with
accounts.backends.AccountBackend (0006's slice) would otherwise sign out
everyone signed in at the time. Re-pointing those sessions keeps them, now
checked by AccountBackend - Django's own rules plus temporary-password expiry.

Uses only Django's own session store, never application code.
"""

from __future__ import annotations

from typing import Any

from django.db import migrations

MODEL_BACKEND = "django.contrib.auth.backends.ModelBackend"
ACCOUNT_BACKEND = "accounts.backends.AccountBackend"
BACKEND_SESSION_KEY = "_auth_user_backend"


def _repoint(apps: Any, old: str, new: str) -> None:
    from django.contrib.sessions.backends.db import SessionStore

    Session = apps.get_model("sessions", "Session")
    store = SessionStore()
    for session in Session.objects.iterator():
        data = store.decode(session.session_data)
        if data.get(BACKEND_SESSION_KEY) != old:
            continue
        data[BACKEND_SESSION_KEY] = new
        session.session_data = store.encode(data)
        session.save(update_fields=["session_data"])


def forwards(apps: Any, schema_editor: Any) -> None:
    _repoint(apps, MODEL_BACKEND, ACCOUNT_BACKEND)


def backwards(apps: Any, schema_editor: Any) -> None:
    _repoint(apps, ACCOUNT_BACKEND, MODEL_BACKEND)


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0006_user_temporary_password_expires_at"),
        ("sessions", "0001_initial"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
