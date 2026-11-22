"""The three technique sets the WKSA 2014 chart closes its black belt
techniques with - Yahng Sohn Mohk Soo, Ssahng Soo and Dahn Doh Mahk Ki, which
"may be taught, if time allows" - as optional JKN requirements. Yahng Sohn
Mohk Soo and Ssahng Soo are for the Adult & Youth age bands; Dahn Doh Mahk Ki
(knife defence) for adults only (owner, 2026-11-22). The chart gives them no
numbered range.

An install whose syllabus already maps one of them at JKN for a band keeps its
own mapping: this only adds what is missing.
"""

from __future__ import annotations

from typing import Any

from django.db import migrations

NOTE = "May be taught, if time allows."
ADULT_AND_YOUTH = ["AGE_13_TO_17", "AGE_18_AND_OVER"]
ADULT = ["AGE_18_AND_OVER"]
# (item, sequence, age bands)
ITEMS = [
    ("YAHNG_SOHN_MOHK_SOO", 170, ADULT_AND_YOUTH),
    ("SSAHNG_SOO", 180, ADULT_AND_YOUTH),
    ("DAHN_DOH_MAHK_KI", 190, ADULT),
]


def seed(apps: Any, _schema_editor: Any) -> None:
    Rank = apps.get_model("ranks", "Rank")
    SyllabusItem = apps.get_model("syllabus", "SyllabusItem")
    SyllabusRequirement = apps.get_model("syllabus", "SyllabusRequirement")

    jkn = Rank.objects.filter(code="JKN").first()
    if jkn is None:
        return
    items = SyllabusItem.objects.in_bulk(
        [code for code, _, _ in ITEMS],
        field_name="code",
    )
    for code, sequence, age_bands in ITEMS:
        item = items.get(code)
        if item is None:
            continue
        for age_band in age_bands:
            SyllabusRequirement.objects.get_or_create(
                rank=jkn,
                age_band=age_band,
                item=item,
                defaults={
                    "required": False,
                    "sequence": sequence,
                    "start_number": None,
                    "end_number": None,
                    "notes": NOTE,
                    "active": True,
                },
            )


def unseed(apps: Any, _schema_editor: Any) -> None:
    SyllabusRequirement = apps.get_model("syllabus", "SyllabusRequirement")
    for code, sequence, age_bands in ITEMS:
        SyllabusRequirement.objects.filter(
            rank__code="JKN",
            age_band__in=age_bands,
            item__code=code,
            required=False,
            sequence=sequence,
            start_number__isnull=True,
            notes=NOTE,
        ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("syllabus", "0002_seed_syllabus"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
