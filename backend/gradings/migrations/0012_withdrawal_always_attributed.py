"""A withdrawal always records why, who and when (decision 2026-09-26).

The attribution check admitted a WITHDRAWN candidate with no reason, actor or
time, so the rule was a service invariant only (audit F-14, 2026-10-04). The
same decision left rows withdrawn before it as they are, so the tightened
check is added NOT VALID: PostgreSQL enforces it on every insert and update
from now on without rejecting an existing row.
"""

from django.db import migrations, models

TABLE = "gradings_gradingcandidate"
NAME = "grading_candidate_withdrawal_attribution_valid"

ATTRIBUTED = (
    '("withdrawal_reason" = \'\' AND "withdrawn_at" IS NULL '
    'AND "withdrawn_by_id" IS NULL AND NOT ("status" = \'WITHDRAWN\')) '
    'OR ("status" = \'WITHDRAWN\' AND "withdrawn_at" IS NOT NULL '
    'AND "withdrawn_by_id" IS NOT NULL AND NOT ("withdrawal_reason" = \'\'))'
)
PREVIOUS = (
    '("withdrawal_reason" = \'\' AND "withdrawn_at" IS NULL '
    'AND "withdrawn_by_id" IS NULL) '
    'OR ("status" = \'WITHDRAWN\' AND "withdrawn_at" IS NOT NULL '
    'AND "withdrawn_by_id" IS NOT NULL AND NOT ("withdrawal_reason" = \'\'))'
)


class Migration(migrations.Migration):
    dependencies = [
        ("gradings", "0011_candidateassessmentitem_position"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveConstraint(model_name="gradingcandidate", name=NAME),
                migrations.AddConstraint(
                    model_name="gradingcandidate",
                    constraint=models.CheckConstraint(
                        condition=models.Q(
                            models.Q(
                                ("withdrawal_reason", ""),
                                ("withdrawn_at__isnull", True),
                                ("withdrawn_by__isnull", True),
                                models.Q(("status", "WITHDRAWN"), _negated=True),
                            ),
                            models.Q(
                                ("status", "WITHDRAWN"),
                                ("withdrawn_at__isnull", False),
                                ("withdrawn_by__isnull", False),
                                models.Q(("withdrawal_reason", ""), _negated=True),
                            ),
                            _connector="OR",
                        ),
                        name=NAME,
                    ),
                ),
            ],
            database_operations=[
                migrations.RunSQL(
                    sql=[
                        f'ALTER TABLE "{TABLE}" DROP CONSTRAINT "{NAME}"',
                        f'ALTER TABLE "{TABLE}" ADD CONSTRAINT "{NAME}" '
                        f"CHECK ({ATTRIBUTED}) NOT VALID",
                    ],
                    reverse_sql=[
                        f'ALTER TABLE "{TABLE}" DROP CONSTRAINT "{NAME}"',
                        f'ALTER TABLE "{TABLE}" ADD CONSTRAINT "{NAME}" '
                        f"CHECK ({PREVIOUS})",
                    ],
                ),
            ],
        ),
    ]
