"""The sixteen ranks every fresh install starts with, with their belts.

A stripe rank is the belt below it with one stripe of the colour it is working
towards; Dahn Bo Nim (shown as DBN, as the black belt titles are abbreviated)
is a brown belt with two black stripes. The black belt titles are plain black.
"""

from __future__ import annotations

from typing import Any

from django.db import migrations

# (code, name, order, category, belt, stripe colour, stripe count)
RANKS = [
    ("WHITE", "White", 1, "COLOURED_BELT", "WHITE", "", 0),
    ("YELLOW_STRIPE", "Yellow Stripe", 2, "COLOURED_BELT", "WHITE", "YELLOW", 1),
    ("YELLOW", "Yellow", 3, "COLOURED_BELT", "YELLOW", "", 0),
    ("BLUE_STRIPE", "Blue Stripe", 4, "COLOURED_BELT", "YELLOW", "BLUE", 1),
    ("BLUE", "Blue", 5, "COLOURED_BELT", "BLUE", "", 0),
    ("RED_STRIPE", "Red Stripe", 6, "COLOURED_BELT", "BLUE", "RED", 1),
    ("RED", "Red", 7, "COLOURED_BELT", "RED", "", 0),
    ("BROWN_STRIPE", "Brown Stripe", 8, "COLOURED_BELT", "RED", "BROWN", 1),
    ("BROWN", "Brown", 9, "COLOURED_BELT", "BROWN", "", 0),
    ("BLACK_STRIPE", "Black Stripe", 10, "COLOURED_BELT", "BROWN", "BLACK", 1),
    ("DAHN_BO", "DBN", 11, "BLACK_BELT_CANDIDATE", "BROWN", "BLACK", 2),
    ("JKN", "JKN", 12, "BLACK_BELT", "BLACK", "", 0),
    ("KSN", "KSN", 13, "BLACK_BELT", "BLACK", "", 0),
    ("PSBN", "PSBN", 14, "BLACK_BELT", "BLACK", "", 0),
    ("SBN", "SBN", 15, "BLACK_BELT", "BLACK", "", 0),
    ("PKJN", "PKJN", 16, "BLACK_BELT", "BLACK", "", 0),
]


def seed_ranks(apps: Any, _schema_editor: Any) -> None:
    Rank = apps.get_model("ranks", "Rank")
    for code, name, order, category, belt, stripe, count in RANKS:
        Rank.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "order": order,
                "category": category,
                "active": True,
                "belt_colour": belt,
                "stripe_colour": stripe,
                "stripe_count": count,
            },
        )


def unseed_ranks(apps: Any, _schema_editor: Any) -> None:
    Rank = apps.get_model("ranks", "Rank")
    Rank.objects.filter(code__in=[rank[0] for rank in RANKS]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("ranks", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_ranks, unseed_ranks),
    ]
