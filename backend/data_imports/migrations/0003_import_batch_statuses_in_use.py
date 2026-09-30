from __future__ import annotations

from django.db import migrations, models

# NEEDS_REVIEW, READY, PARTIAL and FAILED were never assigned by any code
# path, so no row can hold one: only the declared choices change.


class Migration(migrations.Migration):
    dependencies = [
        ("data_imports", "0002_drop_import_batch_error_summary"),
    ]

    operations = [
        migrations.AlterField(
            model_name="importbatch",
            name="status",
            field=models.CharField(
                choices=[
                    ("UPLOADED", "Uploaded"),
                    ("COMMITTED", "Committed"),
                    ("CANCELLED", "Cancelled"),
                    ("EXPIRED", "Expired"),
                ],
                default="UPLOADED",
                max_length=16,
            ),
        ),
    ]
