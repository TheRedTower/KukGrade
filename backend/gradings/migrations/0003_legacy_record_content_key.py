from typing import Any

from django.db import migrations, models


def fill_content_keys(apps: Any, schema_editor: Any) -> None:
    """Every record already imported gets its key, as clean() now sets it."""
    from gradings.models import legacy_content_key

    record_model = apps.get_model("gradings", "LegacyGradingRecord")
    records = list(record_model.objects.all())
    for record_ in records:
        record_.content_key = legacy_content_key(record_)
    record_model.objects.bulk_update(records, ["content_key"], batch_size=500)


class Migration(migrations.Migration):
    dependencies = [
        ("gradings", "0002_candidate_order_by_rank"),
    ]

    operations = [
        migrations.AddField(
            model_name="legacygradingrecord",
            name="content_key",
            field=models.CharField(default="", editable=False, max_length=64),
            preserve_default=False,
        ),
        migrations.RunPython(fill_content_keys, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name="legacygradingrecord",
            index=models.Index(
                fields=["content_key"], name="legacy_record_content_idx"
            ),
        ),
    ]
