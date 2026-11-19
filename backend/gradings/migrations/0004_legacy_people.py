from typing import Any

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def give_records_people(apps: Any, schema_editor: Any) -> None:
    """Every record already saved gets its person, as a save now gives one:
    the live records grouped by gradings.legacy_people, all at once."""
    from gradings.legacy_people import entry_for, group_entries, person_fields
    from gradings.models import SHEET_NOTE_NAME
    from ranks.matching import active_rank_lookup

    record_model = apps.get_model("gradings", "LegacyGradingRecord")
    person_model = apps.get_model("gradings", "LegacyPerson")
    rank_model = apps.get_model("ranks", "Rank")
    ranks = active_rank_lookup(rank_model.objects.filter(active=True))
    records = list(
        record_model.objects.exclude(source_name=SHEET_NOTE_NAME)
        .select_related("current_rank", "testing_for_rank")
        .order_by("pk"),
    )
    # The live records are grouped, as an import groups them; a voided one is
    # no one's evidence, so each is a person of its own.
    live = [record_ for record_ in records if not record_.is_void]
    entries = [entry_for(record_, ranks) for record_ in live]
    grouping = group_entries(entries, [])
    for indices in grouping.new_people:
        person = person_model.objects.create(
            **person_fields(
                [entries[index] for index in indices],
                compared_all=grouping.compared_all,
            ),
        )
        for index in indices:
            live[index].person = person
    for record_ in records:
        if record_.is_void:
            record_.person = person_model.objects.create(
                **person_fields(
                    [entry_for(record_, ranks)],
                    compared_all=True,
                ),
            )
    record_model.objects.bulk_update(records, ["person"], batch_size=500)


class Migration(migrations.Migration):
    dependencies = [
        ("data_imports", "0002_sheet_left_out"),
        ("gradings", "0003_legacy_record_content_key"),
        ("ranks", "0002_seed_ranks"),
        ("students", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="legacygradingrecord",
            name="person_confirmed",
            field=models.BooleanField(default=False),
        ),
        migrations.CreateModel(
            name="LegacyPerson",
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
                (
                    "state",
                    models.CharField(
                        choices=[
                            ("PROPOSED", "Not decided yet"),
                            ("LINKED", "Linked to a student"),
                            ("NOT_A_STUDENT", "Not a current student"),
                            ("LATER", "Later"),
                        ],
                        default="PROPOSED",
                        max_length=16,
                    ),
                ),
                (
                    "confidence",
                    models.CharField(
                        choices=[
                            ("HIGH", "High"),
                            ("MEDIUM", "Medium"),
                            ("LOW", "Low"),
                        ],
                        max_length=8,
                    ),
                ),
                ("reasons", models.JSONField(blank=True, default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "student",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="legacy_people",
                        to="students.student",
                    ),
                ),
            ],
            options={
                "ordering": ["pk"],
            },
        ),
        migrations.AddField(
            model_name="legacygradingrecord",
            name="person",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="records",
                to="gradings.legacyperson",
            ),
        ),
        migrations.RunPython(give_records_people, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="legacygradingrecord",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("person__isnull", True), ("source_name", "Sheet note")),
                    models.Q(
                        models.Q(("source_name", "Sheet note"), _negated=True),
                        ("person__isnull", False),
                    ),
                    _connector="OR",
                ),
                name="legacy_record_person_unless_sheet_note",
            ),
        ),
        migrations.AddIndex(
            model_name="legacyperson",
            index=models.Index(fields=["state"], name="legacy_person_state_idx"),
        ),
        migrations.AddConstraint(
            model_name="legacyperson",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("state", "LINKED"), ("student__isnull", False)),
                    models.Q(
                        models.Q(("state", "LINKED"), _negated=True),
                        ("student__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="legacy_person_student_when_linked",
            ),
        ),
        migrations.AddConstraint(
            model_name="legacyperson",
            constraint=models.CheckConstraint(
                condition=models.Q(("confidence__in", ["HIGH", "MEDIUM", "LOW"])),
                name="legacy_person_confidence_valid",
            ),
        ),
    ]
