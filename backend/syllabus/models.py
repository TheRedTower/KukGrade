from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q


def numbered_range_errors(
    start_number: int | None,
    end_number: int | None,
) -> dict[str, list[str]]:
    """Validation for an optional start-end range (e.g. techniques 1-5),
    shared by a requirement and the assessment snapshot copied from it."""
    errors: dict[str, list[str]] = {}
    if (start_number is None) != (end_number is None):
        message = "Start and end numbers must be provided together."
        errors["end_number" if start_number is not None else "start_number"] = [
            message,
        ]
    if start_number is not None and start_number < 1:
        errors["start_number"] = ["Start number must be at least 1."]
    if (
        start_number is not None
        and end_number is not None
        and end_number < start_number
    ):
        errors["end_number"] = [
            "End number must be greater than or equal to start number.",
        ]
    return errors


def format_numbered_range(start_number: int | None, end_number: int | None) -> str:
    if start_number is None or end_number is None:
        return ""
    if start_number == end_number:
        return str(start_number)
    return f"{start_number}-{end_number}"


class AgeBand(models.TextChoices):
    if TYPE_CHECKING:
        label: str

    AGE_8_AND_UNDER = "AGE_8_AND_UNDER", "8 and under"
    AGE_9_TO_12 = "AGE_9_TO_12", "9-12"
    AGE_13_TO_17 = "AGE_13_TO_17", "13-17"
    AGE_18_AND_OVER = "AGE_18_AND_OVER", "18+"


class Programme(models.TextChoices):
    """The curriculum an age band is taught from."""

    JUNIOR = "JUNIOR", "Junior & Little Dragon"
    ADULT = "ADULT", "Adult & Youth"


# Each age band's programme and the name the syllabus gives its students -
# served by /api/syllabus/age-bands/ so no screen restates them.
AGE_BAND_PROGRAMME: dict[str, Programme] = {
    AgeBand.AGE_8_AND_UNDER: Programme.JUNIOR,
    AgeBand.AGE_9_TO_12: Programme.JUNIOR,
    AgeBand.AGE_13_TO_17: Programme.ADULT,
    AgeBand.AGE_18_AND_OVER: Programme.ADULT,
}
AGE_BAND_STUDENTS: dict[str, str] = {
    AgeBand.AGE_8_AND_UNDER: "Little Dragon",
    AgeBand.AGE_9_TO_12: "Junior",
    AgeBand.AGE_13_TO_17: "Youth",
    AgeBand.AGE_18_AND_OVER: "Adult",
}
# Each age band's oldest age, youngest band first; None is no upper bound.
# The one statement of the boundaries: syllabus.age bands a date of birth by
# it, and each band's label says the same (a test holds them together).
AGE_BAND_OLDEST: dict[str, int | None] = {
    AgeBand.AGE_8_AND_UNDER: 8,
    AgeBand.AGE_9_TO_12: 12,
    AgeBand.AGE_13_TO_17: 17,
    AgeBand.AGE_18_AND_OVER: None,
}


def age_band_description(band: str) -> str:
    """What the syllabus calls the band's students, and their ages: "Junior
    ages 9-12"."""
    return f"{AGE_BAND_STUDENTS[band]} ages {AgeBand(band).label}"


class SyllabusCategory(models.TextChoices):
    ETIQUETTE = "ETIQUETTE", "Etiquette"
    FUNDAMENTALS = "FUNDAMENTALS", "Fundamentals"
    HAND_TECHNIQUES = "HAND_TECHNIQUES", "Hand techniques"
    KICKING = "KICKING", "Kicking"
    FALLING = "FALLING", "Falling"
    BREAKING = "BREAKING", "Breaking"
    TECHNIQUE_SET = "TECHNIQUE_SET", "Technique set"
    FORM = "FORM", "Form"
    WEAPONS = "WEAPONS", "Weapons"
    OTHER = "OTHER", "Other"


class SyllabusItem(models.Model):
    Category = SyllabusCategory

    code = models.CharField(max_length=80, unique=True)
    name = models.CharField(max_length=160)
    korean_name = models.CharField(max_length=160, blank=True)
    category = models.CharField(max_length=32, choices=Category.choices)
    description = models.TextField(blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category", "name", "code"]
        indexes = [
            models.Index(fields=["category", "name"], name="syl_item_cat_name_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=~Q(code=""),
                name="syllabus_item_code_not_blank",
            ),
            models.CheckConstraint(
                condition=~Q(name=""),
                name="syllabus_item_name_not_blank",
            ),
            models.CheckConstraint(
                condition=Q(category__in=SyllabusCategory.values),
                name="syllabus_item_category_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.code}: {self.name}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def clean(self) -> None:
        super().clean()
        self.code = (self.code or "").strip()
        self.name = (self.name or "").strip()
        self.korean_name = (self.korean_name or "").strip()

        errors: dict[str, list[str]] = {}
        if not self.code:
            errors["code"] = ["Syllabus item code is required."]
        if not self.name:
            errors["name"] = ["Syllabus item name is required."]

        if errors:
            raise ValidationError(errors)


# The WKSA chart's own category sequence - the six core areas, then
# Techniques, Forms and Weapons - which is the order Category declares.
CATEGORY_ORDER: dict[str, int] = {
    code: index for index, code in enumerate(SyllabusItem.Category.values)
}

# The six universal core grading areas, which every rank shares;
# Techniques, Forms, Weapons and Other are rank-specific content. Served as
# `category_is_core` so screens group by it without keeping their own list.
CORE_CATEGORIES: frozenset[str] = frozenset(
    {
        SyllabusItem.Category.ETIQUETTE,
        SyllabusItem.Category.FUNDAMENTALS,
        SyllabusItem.Category.HAND_TECHNIQUES,
        SyllabusItem.Category.KICKING,
        SyllabusItem.Category.FALLING,
        SyllabusItem.Category.BREAKING,
    },
)


class SyllabusRequirement(models.Model):
    rank = models.ForeignKey(
        "ranks.Rank",
        on_delete=models.PROTECT,
        related_name="syllabus_requirements",
    )
    item = models.ForeignKey(
        SyllabusItem,
        on_delete=models.PROTECT,
        related_name="requirements",
    )
    age_band = models.CharField(max_length=32, choices=AgeBand.choices)
    required = models.BooleanField(default=True)
    sequence = models.PositiveIntegerField()
    start_number = models.PositiveIntegerField(null=True, blank=True)
    end_number = models.PositiveIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["rank__order", "age_band", "sequence", "item__name"]
        indexes = [
            models.Index(
                fields=["rank", "age_band", "sequence"],
                name="syl_req_rank_age_seq_idx",
            ),
            models.Index(
                fields=["item", "rank", "age_band"],
                name="syl_req_item_rank_age_idx",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["rank", "age_band", "item"],
                name="unique_syllabus_requirement_rank_age_item",
            ),
            models.CheckConstraint(
                condition=Q(age_band__in=AgeBand.values),
                name="syllabus_requirement_age_band_valid",
            ),
            models.CheckConstraint(
                condition=Q(sequence__gt=0),
                name="syllabus_requirement_sequence_positive",
            ),
            models.CheckConstraint(
                condition=(
                    Q(start_number__isnull=True, end_number__isnull=True)
                    | Q(start_number__isnull=False, end_number__isnull=False)
                ),
                name="syllabus_requirement_range_complete",
            ),
            models.CheckConstraint(
                condition=Q(start_number__isnull=True) | Q(start_number__gte=1),
                name="syllabus_requirement_start_positive",
            ),
            models.CheckConstraint(
                condition=Q(end_number__isnull=True)
                | Q(end_number__gte=F("start_number")),
                name="syllabus_requirement_end_not_before_start",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.rank.code} {self.age_band} {self.item.code}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def clean(self) -> None:
        super().clean()
        self.notes = (self.notes or "").strip()

        errors = numbered_range_errors(self.start_number, self.end_number)
        if self.sequence is not None and self.sequence <= 0:
            errors["sequence"] = ["Sequence must be positive."]

        if errors:
            raise ValidationError(errors)

    @property
    def display_range(self) -> str:
        return format_numbered_range(self.start_number, self.end_number)
