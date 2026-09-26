from __future__ import annotations

from typing import Any

import django.db.models.deletion
from django.db import migrations, models


def backfill_from_rank(apps: Any, _schema_editor: Any) -> None:
    """Best reconstruction of the rank each candidate held when registered.

    A promoted candidate's own Promotion records it exactly. Otherwise the
    student's promotion history is replayed to the session date: the rank
    reached by the latest promotion before it, else where the first later
    promotion started from, else the student's current rank (never promoted).
    """
    GradingCandidate = apps.get_model("gradings", "GradingCandidate")
    Promotion = apps.get_model("gradings", "Promotion")

    candidates = GradingCandidate.objects.select_related("session", "student")
    for candidate in candidates.iterator():
        own = Promotion.objects.filter(grading_candidate=candidate).first()
        if own is not None:
            rank_id = own.from_rank_id
        else:
            history = Promotion.objects.filter(student_id=candidate.student_id)
            earlier = (
                history.filter(effective_date__lt=candidate.session.grading_date)
                .order_by("-effective_date", "-promoted_at")
                .first()
            )
            later = (
                history.filter(effective_date__gte=candidate.session.grading_date)
                .order_by("effective_date", "promoted_at")
                .first()
            )
            if earlier is not None:
                rank_id = earlier.to_rank_id
            elif later is not None:
                rank_id = later.from_rank_id
            else:
                rank_id = candidate.student.current_rank_id
        GradingCandidate.objects.filter(pk=candidate.pk).update(from_rank_id=rank_id)


class Migration(migrations.Migration):
    dependencies = [
        ("gradings", "0008_legacygradingrecord"),
        ("ranks", "0002_seed_rank_catalogue"),
    ]

    operations = [
        migrations.AddField(
            model_name="gradingcandidate",
            name="from_rank",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="grading_candidates_from_rank",
                to="ranks.rank",
            ),
        ),
        migrations.RunPython(backfill_from_rank, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="gradingcandidate",
            name="from_rank",
            field=models.ForeignKey(
                editable=False,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="grading_candidates_from_rank",
                to="ranks.rank",
            ),
        ),
        migrations.AlterModelOptions(
            name="gradingsession",
            options={
                "ordering": ["-grading_date", "created_at"],
                "permissions": [
                    (
                        "can_override_locked_session",
                        "Can withdraw a candidate from, or cancel, a locked session",
                    ),
                    (
                        "delete_any_gradingsession",
                        "Can delete a grading session in any status",
                    ),
                ],
            },
        ),
    ]
