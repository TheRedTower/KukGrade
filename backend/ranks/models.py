from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import OuterRef, Q, Subquery


class RankQuerySet(models.QuerySet["Rank"]):
    def next_active_after(self, order: Any) -> RankQuerySet:
        """Active ranks above `order`, lowest first: the first is the next rank.

        The one statement of that rule. `order` may be an `OuterRef`, which is
        how `with_next_active_rank` applies it per row in a single query.
        """
        return self.filter(active=True, order__gt=order).order_by("order")

    def with_next_active_rank(self) -> RankQuerySet:
        return self.annotate(
            next_rank_id=Subquery(
                Rank.objects.next_active_after(OuterRef("order")).values("pk")[:1],
            ),
        )


class BeltColour(models.TextChoices):
    WHITE = "WHITE", "White"
    YELLOW = "YELLOW", "Yellow"
    BLUE = "BLUE", "Blue"
    RED = "RED", "Red"
    BROWN = "BROWN", "Brown"
    BLACK = "BLACK", "Black"


class Rank(models.Model):
    class Category(models.TextChoices):
        COLOURED_BELT = "COLOURED_BELT", "Coloured belt"
        BLACK_BELT_CANDIDATE = "BLACK_BELT_CANDIDATE", "Black belt candidate"
        BLACK_BELT = "BLACK_BELT", "Black belt"

    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=100, unique=True)
    order = models.PositiveSmallIntegerField(unique=True)
    category = models.CharField(max_length=32, choices=Category.choices)
    # What the belt looks like. A stripe rank is the belt below it with a
    # stripe of the colour it is working towards - Blue stripe is a yellow
    # belt with a blue stripe - and Dahn Bo is a brown belt with two black
    # stripes, so every screen draws the rank from these fields rather than
    # guessing from its name. No stripe is a blank colour and a count of 0.
    belt_colour = models.CharField(max_length=16, choices=BeltColour.choices)
    stripe_colour = models.CharField(
        max_length=16,
        choices=BeltColour.choices,
        blank=True,
        default="",
    )
    stripe_count = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = RankQuerySet.as_manager()

    class Meta:
        ordering = ["order"]
        constraints = [
            models.CheckConstraint(
                condition=~Q(code=""),
                name="rank_code_not_blank",
            ),
            models.CheckConstraint(
                condition=~Q(name=""),
                name="rank_name_not_blank",
            ),
            models.CheckConstraint(
                condition=Q(order__gt=0),
                name="rank_order_positive",
            ),
            models.CheckConstraint(
                condition=Q(
                    category__in=[
                        "COLOURED_BELT",
                        "BLACK_BELT_CANDIDATE",
                        "BLACK_BELT",
                    ],
                ),
                name="rank_category_valid",
            ),
            models.CheckConstraint(
                condition=Q(belt_colour__in=BeltColour.values),
                name="rank_belt_colour_valid",
            ),
            models.CheckConstraint(
                condition=Q(stripe_colour="") | Q(stripe_colour__in=BeltColour.values),
                name="rank_stripe_colour_valid",
            ),
            models.CheckConstraint(
                condition=Q(stripe_colour="", stripe_count=0)
                | (~Q(stripe_colour="") & Q(stripe_count__gte=1)),
                name="rank_stripes_have_a_colour",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.order}. {self.name}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def clean(self) -> None:
        super().clean()
        self.code = (self.code or "").strip()
        self.name = (self.name or "").strip()

        errors: dict[str, list[str]] = {}
        if not self.code:
            errors["code"] = ["Rank code is required."]
        if not self.name:
            errors["name"] = ["Rank name is required."]
        if self.order is not None and self.order <= 0:
            errors["order"] = ["Rank order must be positive."]
        if self.stripe_colour and self.stripe_colour == self.belt_colour:
            errors["stripe_colour"] = ["A stripe must differ from its belt."]
        if bool(self.stripe_colour) != (self.stripe_count > 0):
            errors["stripe_count"] = [
                "A stripe colour needs at least one stripe, and stripes need a colour.",
            ]

        if errors:
            raise ValidationError(errors)
