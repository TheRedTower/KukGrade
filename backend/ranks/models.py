from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q


class Rank(models.Model):
    class Category(models.TextChoices):
        COLOURED_BELT = "COLOURED_BELT", "Coloured belt"
        BLACK_BELT_CANDIDATE = "BLACK_BELT_CANDIDATE", "Black belt candidate"
        BLACK_BELT = "BLACK_BELT", "Black belt"

    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=100, unique=True)
    order = models.PositiveSmallIntegerField(unique=True)
    category = models.CharField(max_length=32, choices=Category.choices)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

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

        if errors:
            raise ValidationError(errors)
