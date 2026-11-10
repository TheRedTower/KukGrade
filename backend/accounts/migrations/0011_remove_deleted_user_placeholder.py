"""Remove the deleted-user placeholder account.

Deleting a user once moved their history onto it. A user with history is now
closed instead and keeps their name on it
(accounts.services.delete_platform_user), so nothing moves history onto the
placeholder any more.

It is removed only when nothing refers to it. Where something does - a note
from before comments that migrations 0019 and 0024 of gradings had nobody
else to credit - it stays as a closed account, as any user with history does:
it cannot sign in and leaves the Users list, and what it holds still reads
"Deleted User".
"""

from __future__ import annotations

from typing import Any

from django.contrib.auth.hashers import make_password
from django.db import migrations
from django.utils import timezone

# The literal from 0005_seed_deleted_user_placeholder: migrations must not
# import application code.
DELETED_USER_PLACEHOLDER_EMAIL = "deleted-user@kukgrade.internal"


def _referenced(user: Any) -> bool:
    return any(
        relation.related_model._base_manager.filter(
            **{relation.field.name: user}
        ).exists()
        for relation in type(user)._meta.related_objects
    )


def remove_placeholder(apps: Any, _schema_editor: Any) -> None:
    User = apps.get_model("accounts", "User")
    placeholder = User.objects.filter(email=DELETED_USER_PLACEHOLDER_EMAIL).first()
    if placeholder is None:
        return
    if _referenced(placeholder):
        if placeholder.deleted_at is None:
            User.objects.filter(pk=placeholder.pk).update(deleted_at=timezone.now())
        return
    placeholder.delete()


def restore_placeholder(apps: Any, _schema_editor: Any) -> None:
    User = apps.get_model("accounts", "User")
    placeholder, _created = User.objects.get_or_create(
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
    User.objects.filter(pk=placeholder.pk).update(deleted_at=None)


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0010_user_deleted_at"),
        # The last migration that may credit a note to the placeholder.
        ("gradings", "0024_drop_assessor_notes"),
    ]

    operations = [
        migrations.RunPython(remove_placeholder, restore_placeholder),
    ]
