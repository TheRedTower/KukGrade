"""WKSA IDs take one of two forms, and the database refuses anything else.

Existing IDs are first tidied the way Student.clean() now tidies them -
surrounding space dropped, the black belt `A` upper-cased. Any ID still in
neither form stops the migration with a list of them: KukGrade cannot invent
the right ID, so they are corrected (in Django admin, or by whoever issued
them) and the migration run again. The pattern is a copy of
students.wksa_ids.DATABASE_PATTERN, as migrations must not import
application code.
"""

from __future__ import annotations

import re
from typing import Any

from django.db import migrations, models

PATTERN = "^([0-9]{3}-[0-9]-[0-9]{3}|A-[0-9]{5})$"


def tidy_and_check(apps: Any, schema_editor: Any) -> None:
    Student = apps.get_model("students", "Student")
    taken = set(Student.objects.values_list("wksa_id", flat=True))
    wrong: list[str] = []
    for student in Student.objects.order_by("wksa_id"):
        tidied = student.wksa_id.strip().upper()
        if tidied != student.wksa_id and tidied not in taken:
            taken.discard(student.wksa_id)
            taken.add(tidied)
            Student.objects.filter(pk=student.pk).update(wksa_id=tidied)
            student.wksa_id = tidied
        if not re.fullmatch(PATTERN, student.wksa_id):
            wrong.append(
                f"{student.wksa_id!r} ({student.first_name} {student.last_name})",
            )
    if wrong:
        msg = (
            "These WKSA IDs are neither a student ID (123-4-150) nor a black "
            "belt ID (A-20819). Correct them, then migrate again:\n  "
            + "\n  ".join(wrong)
        )
        raise RuntimeError(msg)


class Migration(migrations.Migration):
    dependencies = [
        ("students", "0005_student_status"),
    ]

    operations = [
        migrations.RunPython(tidy_and_check, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name="student",
            name="student_wksa_id_not_blank",
        ),
        migrations.AddConstraint(
            model_name="student",
            constraint=models.CheckConstraint(
                condition=models.Q(wksa_id__regex=PATTERN),
                name="student_wksa_id_format",
            ),
        ),
    ]
