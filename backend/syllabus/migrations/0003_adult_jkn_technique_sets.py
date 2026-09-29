from __future__ import annotations

from typing import Any

from django.db import migrations

ADULTS = "AGE_18_AND_OVER"
NOTE = "Required for Black Belt Promotion for Adults."

# Owner decision 2026-09-29: adults testing for Jo Kyo Nim do all seven
# black-belt technique sets. The chart marks the first five "required for
# 13-17" and the last two "required for adults"; 0002 seeded adults with only
# the last two. Ranges are the chart's, the same as the 13-17 rows.
ADDED = [
    ("JOONG_GEUP_SOHN_MOHK_SOO", 100, 1, 7),
    ("AHP_EUE_BOHK_SOO", 110, 1, 20),
    ("DEE_EUE_BOHK_SOO", 120, 1, 23),
    ("KWAHN_JUHL_KI", 130, 1, 13),
    ("TOO_KI", 140, 1, 13),
]
# The two adults already had, moved after the five to keep the chart's order.
RESEQUENCED = [
    ("MOHK_JOH_LEU_KI", 100, 150),
    ("BAHNG_TOO_KI", 110, 160),
]


def add_adult_jkn_technique_sets(apps: Any, _schema_editor: Any) -> None:
    Rank = apps.get_model("ranks", "Rank")
    SyllabusItem = apps.get_model("syllabus", "SyllabusItem")
    SyllabusRequirement = apps.get_model("syllabus", "SyllabusRequirement")
    jkn = Rank.objects.get(code="JKN")

    for item_code, _seeded, sequence in RESEQUENCED:
        SyllabusRequirement.objects.filter(
            rank=jkn,
            age_band=ADULTS,
            item__code=item_code,
        ).update(sequence=sequence)
    for item_code, sequence, start_number, end_number in ADDED:
        SyllabusRequirement.objects.update_or_create(
            rank=jkn,
            age_band=ADULTS,
            item=SyllabusItem.objects.get(code=item_code),
            defaults={
                "required": True,
                "sequence": sequence,
                "start_number": start_number,
                "end_number": end_number,
                "notes": NOTE,
                "active": True,
            },
        )


def remove_adult_jkn_technique_sets(apps: Any, _schema_editor: Any) -> None:
    Rank = apps.get_model("ranks", "Rank")
    SyllabusRequirement = apps.get_model("syllabus", "SyllabusRequirement")
    jkn = Rank.objects.get(code="JKN")

    for item_code, sequence, start_number, end_number in ADDED:
        SyllabusRequirement.objects.filter(
            rank=jkn,
            age_band=ADULTS,
            item__code=item_code,
            sequence=sequence,
            start_number=start_number,
            end_number=end_number,
            notes=NOTE,
        ).delete()
    for item_code, seeded, sequence in RESEQUENCED:
        SyllabusRequirement.objects.filter(
            rank=jkn,
            age_band=ADULTS,
            item__code=item_code,
            sequence=sequence,
        ).update(sequence=seeded)


class Migration(migrations.Migration):
    dependencies = [
        ("syllabus", "0002_seed_wksa_2014_syllabus"),
    ]

    operations = [
        migrations.RunPython(
            add_adult_jkn_technique_sets,
            remove_adult_jkn_technique_sets,
        ),
    ]
