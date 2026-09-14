"""Replace the binary active flag with active / inactive / left.

`is_active=True` becomes ACTIVE and `is_active=False` becomes INACTIVE. That
is the conservative reading: an existing inactive student is on a break, not
gone, and LEFT is the value that blocks grading registration. Anyone who has
actually left is marked so deliberately, which matches the rule that missing a
grading must never imply someone left.
"""

from __future__ import annotations

from typing import Any

from django.db import migrations, models


def set_status_from_flag(apps: Any, _schema_editor: Any) -> None:
    Student = apps.get_model("students", "Student")
    Student.objects.filter(is_active=True).update(status="ACTIVE")
    Student.objects.filter(is_active=False).update(status="INACTIVE")


def set_flag_from_status(apps: Any, _schema_editor: Any) -> None:
    Student = apps.get_model("students", "Student")
    Student.objects.filter(status="ACTIVE").update(is_active=True)
    Student.objects.exclude(status="ACTIVE").update(is_active=False)


class Migration(migrations.Migration):
    dependencies = [
        ("students", "0004_require_current_rank"),
    ]

    operations = [
        migrations.AddField(
            model_name="student",
            name="status",
            field=models.CharField(
                choices=[
                    ("ACTIVE", "Active"),
                    ("INACTIVE", "Inactive"),
                    ("LEFT", "Left"),
                ],
                default="ACTIVE",
                max_length=16,
            ),
        ),
        migrations.RunPython(set_status_from_flag, set_flag_from_status),
        migrations.RemoveField(model_name="student", name="is_active"),
        migrations.AddConstraint(
            model_name="student",
            constraint=models.CheckConstraint(
                condition=models.Q(status__in=["ACTIVE", "INACTIVE", "LEFT"]),
                name="student_status_valid",
            ),
        ),
    ]
