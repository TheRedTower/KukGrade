from __future__ import annotations

from typing import Any

from django.db import migrations

RANKS = [
    ("WHITE", "White", 1, "COLOURED_BELT", True),
    ("YELLOW_STRIPE", "Yellow Stripe", 2, "COLOURED_BELT", True),
    ("YELLOW", "Yellow", 3, "COLOURED_BELT", True),
    ("BLUE_STRIPE", "Blue Stripe", 4, "COLOURED_BELT", True),
    ("BLUE", "Blue", 5, "COLOURED_BELT", True),
    ("RED_STRIPE", "Red Stripe", 6, "COLOURED_BELT", True),
    ("RED", "Red", 7, "COLOURED_BELT", True),
    ("BROWN_STRIPE", "Brown Stripe", 8, "COLOURED_BELT", True),
    ("BROWN", "Brown", 9, "COLOURED_BELT", True),
    ("BLACK_STRIPE", "Black Stripe", 10, "COLOURED_BELT", True),
    ("DAHN_BO", "Dahn Bo", 11, "BLACK_BELT_CANDIDATE", True),
    ("JKN", "JKN", 12, "BLACK_BELT", True),
    ("KSN", "KSN", 13, "BLACK_BELT", True),
    ("PSBN", "PSBN", 14, "BLACK_BELT", True),
    ("SBN", "SBN", 15, "BLACK_BELT", True),
    ("PKJN", "PKJN", 16, "BLACK_BELT", True),
]


def seed_rank_catalogue(apps: Any, _schema_editor: Any) -> None:
    Rank = apps.get_model("ranks", "Rank")

    for code, name, order, category, active in RANKS:
        Rank.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "order": order,
                "category": category,
                "active": active,
            },
        )


def unseed_rank_catalogue(apps: Any, _schema_editor: Any) -> None:
    Rank = apps.get_model("ranks", "Rank")

    for code, name, order, category, active in reversed(RANKS):
        Rank.objects.filter(
            code=code,
            name=name,
            order=order,
            category=category,
            active=active,
        ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("ranks", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_rank_catalogue, unseed_rank_catalogue),
    ]
