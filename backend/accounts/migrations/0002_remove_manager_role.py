"""Drop the unused `manager` role.

Nothing in the codebase read it, and the confirmed capability map has
instructors and administrators only. Any existing manager becomes an
instructor, which is the lower-privileged of the two.
"""

from __future__ import annotations

from typing import Any

from django.db import migrations, models


def demote_managers(apps: Any, _schema_editor: Any) -> None:
    User = apps.get_model("accounts", "User")
    User.objects.filter(role="manager").update(role="instructor")


def noop(_apps: Any, _schema_editor: Any) -> None:
    """Irreversible by design: the original role is not recoverable."""


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(demote_managers, noop),
        migrations.AlterField(
            model_name="user",
            name="role",
            field=models.CharField(
                choices=[
                    ("instructor", "Instructor"),
                    ("administrator", "Administrator"),
                ],
                default="instructor",
                max_length=32,
            ),
        ),
    ]
