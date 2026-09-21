from __future__ import annotations

from typing import Any

from django.contrib.auth.hashers import make_password
from django.db import migrations

# Kept in sync by hand with accounts.services.DELETED_USER_PLACEHOLDER_EMAIL -
# migrations must not import application code, since that code is free to
# change shape after this migration is written and frozen.
DELETED_USER_PLACEHOLDER_EMAIL = "deleted-user@kukgrade.internal"


def seed_deleted_user_placeholder(apps: Any, _schema_editor: Any) -> None:
    User = apps.get_model("accounts", "User")
    User.objects.get_or_create(
        email=DELETED_USER_PLACEHOLDER_EMAIL,
        defaults={
            "password": make_password(None),
            "first_name": "Deleted",
            "last_name": "User",
            "role": "instructor",
            "is_active": False,
            "is_staff": False,
            "must_change_password": True,
        },
    )


def unseed_deleted_user_placeholder(apps: Any, _schema_editor: Any) -> None:
    User = apps.get_model("accounts", "User")
    User.objects.filter(email=DELETED_USER_PLACEHOLDER_EMAIL).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0004_user_must_change_password"),
    ]

    operations = [
        migrations.RunPython(
            seed_deleted_user_placeholder,
            unseed_deleted_user_placeholder,
        ),
    ]
