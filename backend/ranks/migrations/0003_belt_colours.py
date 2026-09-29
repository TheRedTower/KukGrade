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

# (belt, stripe colour, stripe count) per seeded rank. A stripe rank is the
# belt below it with one stripe of the colour it is working towards; Dahn Bo
# is a brown belt with two black stripes. The black-belt titles are plain
# black until their appearance is decided.
BELTS = {
    "WHITE": ("WHITE", "", 0),
    "YELLOW_STRIPE": ("WHITE", "YELLOW", 1),
    "YELLOW": ("YELLOW", "", 0),
    "BLUE_STRIPE": ("YELLOW", "BLUE", 1),
    "BLUE": ("BLUE", "", 0),
    "RED_STRIPE": ("BLUE", "RED", 1),
    "RED": ("RED", "", 0),
    "BROWN_STRIPE": ("RED", "BROWN", 1),
    "BROWN": ("BROWN", "", 0),
    "BLACK_STRIPE": ("BROWN", "BLACK", 1),
    "DAHN_BO": ("BROWN", "BLACK", 2),
    "JKN": ("BLACK", "", 0),
    "KSN": ("BLACK", "", 0),
    "PSBN": ("BLACK", "", 0),
    "SBN": ("BLACK", "", 0),
    "PKJN": ("BLACK", "", 0),
}


def set_belt_colours(apps: Any, _schema_editor: Any) -> None:
    Rank = apps.get_model("ranks", "Rank")
    for code, (belt, stripe, count) in BELTS.items():
        Rank.objects.filter(code=code).update(
            belt_colour=belt,
            stripe_colour=stripe,
            stripe_count=count,
        )


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
        migrations.AddField(
            model_name="rank",
            name="stripe_count",
            field=models.PositiveSmallIntegerField(default=0),
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
        migrations.AddConstraint(
            model_name="rank",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("stripe_colour", ""), ("stripe_count", 0)),
                    models.Q(
                        models.Q(("stripe_colour", ""), _negated=True),
                        ("stripe_count__gte", 1),
                    ),
                    _connector="OR",
                ),
                name="rank_stripes_have_a_colour",
            ),
        ),
    ]
