from __future__ import annotations

from typing import Any

from django.db import migrations, models
from django.db.models import Q


def admin_error_becomes_other(apps: Any, _schema_editor: Any) -> None:
    """Rows withdrawn as registered in error become Other, keeping that in
    the note. Before lock such a registration is now removed instead."""
    GradingCandidate = apps.get_model("gradings", "GradingCandidate")
    for candidate in GradingCandidate.objects.filter(withdrawal_reason="ADMIN_ERROR"):
        note = candidate.withdrawal_note.strip()
        candidate.withdrawal_reason = "OTHER"
        candidate.withdrawal_note = (
            f"Registered in error. {note}" if note else "Registered in error."
        )
        candidate.save(update_fields=["withdrawal_reason", "withdrawal_note"])


class Migration(migrations.Migration):
    dependencies = [
        ("gradings", "0009_candidate_from_rank_and_delete_any_permission"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="gradingcandidate",
            name="grading_candidate_withdrawal_reason_valid",
        ),
        migrations.RunPython(admin_error_becomes_other, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="gradingcandidate",
            name="withdrawal_reason",
            field=models.CharField(
                blank=True,
                choices=[
                    ("INJURY", "Injured during grading"),
                    ("WITHDREW", "Withdrew voluntarily"),
                    ("ABSENT", "Did not attend"),
                    ("OTHER", "Other"),
                ],
                max_length=32,
            ),
        ),
        migrations.AddConstraint(
            model_name="gradingcandidate",
            constraint=models.CheckConstraint(
                condition=Q(
                    withdrawal_reason__in=["INJURY", "WITHDREW", "ABSENT", "OTHER"]
                )
                | Q(withdrawal_reason=""),
                name="grading_candidate_withdrawal_reason_valid",
            ),
        ),
        migrations.AddConstraint(
            model_name="gradingcandidate",
            constraint=models.CheckConstraint(
                condition=~Q(withdrawal_reason="OTHER", withdrawal_note=""),
                name="grading_candidate_other_withdrawal_has_note",
            ),
        ),
    ]
