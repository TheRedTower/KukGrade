from __future__ import annotations

from django.db import migrations, models
from django.db.models import Q

# Items already generated are numbered in the order they were listed in until
# now - copied sequence, then name, then id - so no existing record reads
# differently. Nothing else on the rows changes.
NUMBER_EXISTING_ITEMS = """
UPDATE gradings_candidateassessmentitem AS item
SET position = numbered.position
FROM (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY assessment_id
            ORDER BY requirement_sequence, item_name, id
        ) AS position
    FROM gradings_candidateassessmentitem
) AS numbered
WHERE item.id = numbered.id
"""


class Migration(migrations.Migration):
    dependencies = [
        ("gradings", "0010_withdrawal_reason_other"),
    ]

    operations = [
        migrations.AddField(
            model_name="candidateassessmentitem",
            name="position",
            field=models.PositiveIntegerField(null=True),
        ),
        migrations.RunSQL(NUMBER_EXISTING_ITEMS, reverse_sql=migrations.RunSQL.noop),
        migrations.AlterField(
            model_name="candidateassessmentitem",
            name="position",
            field=models.PositiveIntegerField(),
        ),
        migrations.AlterModelOptions(
            name="candidateassessmentitem",
            options={"ordering": ["position", "pk"]},
        ),
        migrations.AddConstraint(
            model_name="candidateassessmentitem",
            constraint=models.CheckConstraint(
                condition=Q(position__gt=0),
                name="candidate_item_position_positive",
            ),
        ),
        migrations.AddConstraint(
            model_name="candidateassessmentitem",
            constraint=models.UniqueConstraint(
                fields=["assessment", "position"],
                name="unique_assessment_item_position",
            ),
        ),
    ]
