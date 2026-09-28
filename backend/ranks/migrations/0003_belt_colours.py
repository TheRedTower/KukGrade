from __future__ import annotations

from typing import Any

from django.db import migrations, models

COLOURS = [
    ("WHITE", "White"),
    ("YELLOW", "Yellow"),
    ("BLUE", "Blue"),
    ("RED", "Red"),
    ("BROWN", "Brown"),
    ("BLACK", "Black"),
]

# (belt, stripe) per seeded rank. A stripe rank is the belt below it with a
# stripe of the colour it is working towards. Dahn Bo and the black-belt
# titles are plain black until their appearance is decided.
BELTS = {
    "WHITE": ("WHITE", ""),
    "YELLOW_STRIPE": ("WHITE", "YELLOW"),
    "YELLOW": ("YELLOW", ""),
    "BLUE_STRIPE": ("YELLOW", "BLUE"),
    "BLUE": ("BLUE", ""),
    "RED_STRIPE": ("BLUE", "RED"),
    "RED": ("RED", ""),
    "BROWN_STRIPE": ("RED", "BROWN"),
    "BROWN": ("BROWN", ""),
    "BLACK_STRIPE": ("BROWN", "BLACK"),
    "DAHN_BO": ("BLACK", ""),
    "JKN": ("BLACK", ""),
    "KSN": ("BLACK", ""),
    "PSBN": ("BLACK", ""),
    "SBN": ("BLACK", ""),
    "PKJN": ("BLACK", ""),
}


def set_belt_colours(apps: Any, _schema_editor: Any) -> None:
    Rank = apps.get_model("ranks", "Rank")
    for code, (belt, stripe) in BELTS.items():
        Rank.objects.filter(code=code).update(belt_colour=belt, stripe_colour=stripe)


class Migration(migrations.Migration):
    dependencies = [
        ("ranks", "0002_seed_rank_catalogue"),
    ]

    operations = [
        migrations.AddField(
            model_name="rank",
            name="belt_colour",
            field=models.CharField(choices=COLOURS, default="BLACK", max_length=16),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="rank",
            name="stripe_colour",
            field=models.CharField(
                blank=True,
                choices=COLOURS,
                default="",
                max_length=16,
            ),
        ),
        migrations.RunPython(set_belt_colours, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="rank",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    (
                        "belt_colour__in",
                        ["WHITE", "YELLOW", "BLUE", "RED", "BROWN", "BLACK"],
                    ),
                ),
                name="rank_belt_colour_valid",
            ),
        ),
        migrations.AddConstraint(
            model_name="rank",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("stripe_colour", ""),
                    (
                        "stripe_colour__in",
                        ["WHITE", "YELLOW", "BLUE", "RED", "BROWN", "BLACK"],
                    ),
                    _connector="OR",
                ),
                name="rank_stripe_colour_valid",
            ),
        ),
    ]
