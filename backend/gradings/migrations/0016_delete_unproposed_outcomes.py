"""An outcome record exists only once something has been proposed.

Opening one used to be a request of its own, so a proposal that was refused
(or never sent) left an empty DRAFT record behind. Such a record holds no
proposal, no decision and no attribution, so nothing is lost by removing it:
the next proposal opens it again. It is kept apart from the schema change that
follows, because a deletion and an ALTER cannot share one PostgreSQL
transaction while foreign key checks are pending.
"""

from __future__ import annotations

from typing import Any

from django.db import migrations


def delete_unproposed_outcomes(apps: Any, _schema_editor: Any) -> None:
    CandidateOutcome = apps.get_model("gradings", "CandidateOutcome")
    CandidateOutcome.objects.filter(status="DRAFT").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("gradings", "0015_set_aside_name"),
    ]

    operations = [
        # Nothing to restore on the way back: the removed rows carried no data.
        migrations.RunPython(delete_unproposed_outcomes, migrations.RunPython.noop),
    ]
