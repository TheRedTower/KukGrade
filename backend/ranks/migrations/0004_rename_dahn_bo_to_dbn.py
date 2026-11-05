from __future__ import annotations

from typing import Any

from django.db import migrations


def _rename(apps: Any, old: str, new: str) -> None:
    Rank = apps.get_model("ranks", "Rank")
    Rank.objects.filter(code="DAHN_BO", name=old).update(name=new)


def to_dbn(apps: Any, _schema_editor: Any) -> None:
    _rename(apps, "Dahn Bo", "DBN")


def to_dahn_bo(apps: Any, _schema_editor: Any) -> None:
    _rename(apps, "DBN", "Dahn Bo")


class Migration(migrations.Migration):
    """Dahn Bo Nim is shown as DBN, as the black belt titles already are
    (JKN, KSN, PSBN, SBN, PKJN). The code stays DAHN_BO."""

    dependencies = [
        ("ranks", "0003_belt_colours"),
    ]

    operations = [
        migrations.RunPython(to_dbn, to_dahn_bo),
    ]
