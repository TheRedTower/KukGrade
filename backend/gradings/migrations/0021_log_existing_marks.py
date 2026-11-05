"""Each mark already on an item becomes the first entry in its change log.

An item kept only its current mark, with who made it and when. The change log
(2026-11-04, marking workflow) keeps how a mark came to be, and every later
change needs a reason; so a mark made before the log existed is entered as the
first change, from "not assessed" to the mark, by the person and at the time
the item already records. That first entry needs no reason.
"""

from __future__ import annotations

from typing import Any

from django.db import migrations


def log_existing_marks(apps: Any, _schema_editor: Any) -> None:
    Item = apps.get_model("gradings", "CandidateAssessmentItem")
    Change = apps.get_model("gradings", "AssessmentItemResultChange")
    marked = Item.objects.filter(result__in=["MET", "NOT_MET"]).exclude(
        assessor__isnull=True,
    )
    entries = []
    for item in marked.iterator():
        entries.append(
            Change(
                item=item,
                sequence=1,
                from_result="NOT_ASSESSED",
                to_result=item.result,
                changed_by_id=item.assessor_id,
                reason="",
            ),
        )
        if len(entries) >= 500:
            _save(Change, entries)
            entries = []
    _save(Change, entries)


def _save(Change: Any, entries: list[Any]) -> None:
    created = Change.objects.bulk_create(entries)
    # auto_now_add stamps "now"; the mark was made when the item says it was,
    # so each entry is set to that time (the historical model has no guards).
    for entry in created:
        Change.objects.filter(pk=entry.pk).update(
            changed_at=entry.item.assessed_at or entry.item.updated_at,
        )


class Migration(migrations.Migration):
    dependencies = [
        ("gradings", "0020_item_result_changes"),
    ]

    operations = [
        # Going back drops the table itself, so there is nothing to undo here.
        migrations.RunPython(log_existing_marks, migrations.RunPython.noop),
    ]
