"""Assessment items keep the syllabus's notation wording (2026-10-18, F-09).

A form taught in parts across ranks reads "Parts 1-3" in the cumulative
syllabus, which the latest mapping's notes alone ("Chart notation: (pt.3).")
cannot give, so the wording is copied onto the snapshot when an assessment is
generated. Existing items are given the wording the screens already showed
for them - their own notes normalised - so no past record changes how it
reads. The normalisation is copied here rather than imported, so this
migration does not change if syllabus.services does.
"""

import re
from typing import Any

from django.db import migrations, models

_CHART_NOTATION_RE = re.compile(r"^Chart notation: \((.+)\)\.$")
_PART_OF_RE = re.compile(r"^(\d+)/(\d+)$")
_PART_LABEL_RE = re.compile(r"^pt\.(\d+)$", re.IGNORECASE)


def _normalised(notes: str) -> str:
    match = _CHART_NOTATION_RE.match(notes.strip())
    if not match:
        return ""
    inner = match.group(1)
    part_of = _PART_OF_RE.match(inner)
    if part_of:
        return f"Part {part_of.group(1)} of {part_of.group(2)}"
    part_label = _PART_LABEL_RE.match(inner)
    if part_label:
        return f"Part {part_label.group(1)}"
    return inner


def backfill_notation(apps: Any, _schema_editor: Any) -> None:
    item_model = apps.get_model("gradings", "CandidateAssessmentItem")
    items = item_model.objects.filter(requirement_notes__startswith="Chart notation:")
    for item in items.only("pk", "requirement_notes").iterator():
        notation = _normalised(item.requirement_notes)
        if notation:
            item_model.objects.filter(pk=item.pk).update(notation=notation)


class Migration(migrations.Migration):
    dependencies = [
        ("gradings", "0012_withdrawal_always_attributed"),
    ]

    operations = [
        migrations.AddField(
            model_name="candidateassessmentitem",
            name="notation",
            field=models.CharField(
                blank=True,
                help_text=(
                    "The syllabus's display wording for this item's chart "
                    "notation - 'Part 1 of 2', 'Parts 1-3' - as it stood when "
                    "the assessment was generated; empty when there is none."
                ),
                max_length=80,
            ),
        ),
        migrations.RunPython(backfill_notation, migrations.RunPython.noop),
    ]
