from __future__ import annotations

from typing import Any

from django.db import migrations


def assign_white_rank(apps: Any, _schema_editor: Any) -> None:
    Rank = apps.get_model("ranks", "Rank")
    Student = apps.get_model("students", "Student")

    white = Rank.objects.get(code="WHITE")
    Student.objects.filter(current_rank__isnull=True).update(current_rank=white)


def clear_white_rank(apps: Any, _schema_editor: Any) -> None:
    Rank = apps.get_model("ranks", "Rank")
    Student = apps.get_model("students", "Student")

    white = Rank.objects.get(code="WHITE")
    Student.objects.filter(current_rank=white).update(current_rank=None)


class Migration(migrations.Migration):
    dependencies = [
        ("students", "0002_add_nullable_current_rank"),
    ]

    operations = [
        migrations.RunPython(assign_white_rank, clear_white_rank),
    ]
