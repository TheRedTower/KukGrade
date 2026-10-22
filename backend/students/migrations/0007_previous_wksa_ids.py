"""A student keeps the student ID a black belt ID replaced, and a deleted
student's IDs are retired (2026-10-20).

The school owner confirmed a number stays with its student and is never given
to anyone else, so each previous ID is unique for good. IDs already replaced
before this existed are in the audit trail - every student edit from
2026-10-20 records the ID before and after - and are carried over here, so
nothing that has already happened is lost; so are the IDs of students
deleted before, which every deletion's audit event names. Uses only the migration's own
models; the pattern is a copy of students.wksa_ids, as migrations must not
import application code.
"""

import re
from typing import Any

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models

STUDENT_ID = re.compile(r"^[0-9]{3}-[0-9]-[0-9]{3}$")
BLACK_BELT_ID = re.compile(r"^A-[0-9]{5}$")


ANY_ID = re.compile(r"^([0-9]{3}-[0-9]-[0-9]{3}|A-[0-9]{5})$")


def carry_over_from_audit(apps: Any, schema_editor: Any) -> None:
    Event = apps.get_model("audit", "AuditEvent")
    Student = apps.get_model("students", "Student")
    Previous = apps.get_model("students", "PreviousWksaId")
    Retired = apps.get_model("students", "RetiredWksaId")

    held = set(Student.objects.values_list("wksa_id", flat=True))
    held.update(Previous.objects.values_list("wksa_id", flat=True))
    held.update(Retired.objects.values_list("wksa_id", flat=True))
    # Older deletion events named only the final ID. Keep replacements from
    # their update events until the deletion supplies the retirement time.
    deleted_replacements: dict[str, set[str]] = {}
    events = Event.objects.filter(entity_type="Student").order_by("occurred_at", "pk")
    for event in events.iterator():
        metadata = event.metadata if isinstance(event.metadata, dict) else {}
        if event.action == "STUDENT_DELETED":
            for wksa_id in [
                metadata.get("wksa_id"),
                *(metadata.get("previous_wksa_ids") or []),
                *deleted_replacements.pop(event.entity_id, set()),
            ]:
                if isinstance(wksa_id, str) and ANY_ID.match(wksa_id):
                    if wksa_id not in held:
                        Retired.objects.create(
                            wksa_id=wksa_id,
                            retired_at=event.occurred_at,
                        )
                        held.add(wksa_id)
            continue
        before = (metadata.get("before") or {}).get("wksa_id")
        after = (metadata.get("after") or {}).get("wksa_id")
        if not before or not after or before == after:
            continue
        if (
            not STUDENT_ID.match(before)
            or not BLACK_BELT_ID.match(after)
            or before in held
        ):
            continue
        if not event.entity_id.isdecimal():
            continue
        student = Student.objects.filter(pk=int(event.entity_id)).first()
        if student is None:
            deleted_replacements.setdefault(event.entity_id, set()).add(before)
            continue
        Previous.objects.create(
            student=student,
            wksa_id=before,
            replaced_at=event.occurred_at,
        )
        held.add(before)


class Migration(migrations.Migration):
    dependencies = [
        ("audit", "0008_plain_labels"),
        ("students", "0006_wksa_id_format"),
    ]

    operations = [
        migrations.CreateModel(
            name="PreviousWksaId",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("wksa_id", models.CharField(max_length=32, unique=True)),
                (
                    "replaced_at",
                    models.DateTimeField(default=django.utils.timezone.now),
                ),
                (
                    "student",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="previous_wksa_ids",
                        to="students.student",
                    ),
                ),
            ],
            options={
                "ordering": ["replaced_at", "pk"],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(
                            ("wksa_id__regex", "^[0-9]{3}-[0-9]-[0-9]{3}$"),
                        ),
                        name="previous_wksa_id_student_form",
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="RetiredWksaId",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("wksa_id", models.CharField(max_length=32, unique=True)),
                (
                    "retired_at",
                    models.DateTimeField(default=django.utils.timezone.now),
                ),
            ],
            options={
                "ordering": ["retired_at", "pk"],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(
                            (
                                "wksa_id__regex",
                                "^([0-9]{3}-[0-9]-[0-9]{3}|A-[0-9]{5})$",
                            ),
                        ),
                        name="retired_wksa_id_format",
                    ),
                ],
            },
        ),
        migrations.RunPython(carry_over_from_audit, migrations.RunPython.noop),
    ]
