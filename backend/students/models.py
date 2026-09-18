from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone

from ranks.models import Rank


class Student(models.Model):
    if TYPE_CHECKING:
        from gradings.models import Promotion

        promotions: models.Manager[Promotion]
        current_rank_id: int
    class Status(models.TextChoices):
        # A temporary break - injury, exams, travel - which blocks nothing.
        # Missing a grading never sets this: only a person does, deliberately.
        ACTIVE = "ACTIVE", "Active"
        INACTIVE = "INACTIVE", "Inactive"
        # Gone. Blocks registration as a grading candidate, and is reversible
        # if they come back. Grading history is retained either way.
        LEFT = "LEFT", "Left"

    wksa_id = models.CharField(max_length=32, unique=True)
    first_name = models.CharField(max_length=150)
    last_name = models.CharField(max_length=150)
    date_of_birth = models.DateField()
    current_rank = models.ForeignKey(
        Rank,
        on_delete=models.PROTECT,
        related_name="students_currently_at_rank",
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["last_name", "first_name", "wksa_id"]
        constraints = [
            models.CheckConstraint(
                condition=~Q(wksa_id=""),
                name="student_wksa_id_not_blank",
            ),
            models.CheckConstraint(
                condition=Q(status__in=["ACTIVE", "INACTIVE", "LEFT"]),
                name="student_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.first_name} {self.last_name} ({self.wksa_id})"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def clean(self) -> None:
        super().clean()
        self.wksa_id = (self.wksa_id or "").strip()
        self.first_name = (self.first_name or "").strip()
        self.last_name = (self.last_name or "").strip()

        errors: dict[str, list[str]] = {}
        if not self.wksa_id:
            errors["wksa_id"] = ["WKSA ID is required."]
        if not self.first_name:
            errors["first_name"] = ["First name is required."]
        if not self.last_name:
            errors["last_name"] = ["Last name is required."]
        if self.date_of_birth and self.date_of_birth > timezone.localdate():
            errors["date_of_birth"] = ["Date of birth cannot be in the future."]
        if not self._state.adding and self.pk is not None:
            previous_rank_id = (
                Student.objects.filter(pk=self.pk)
                .values_list("current_rank_id", flat=True)
                .first()
            )
            if previous_rank_id != self.current_rank_id and self.promotions.exists():
                errors["current_rank"] = [
                    "Use the promotion workflow to change current rank after "
                    "promotion history exists.",
                ]

        if errors:
            raise ValidationError(errors)

    @property
    def can_be_graded(self) -> bool:
        """Whether this student may be registered as a grading candidate."""
        return self.status != Student.Status.LEFT

    @property
    def age_band(self) -> str:
        """The canonical age band relative to today."""
        from gradings.services import resolve_age_band

        return resolve_age_band(self.date_of_birth, timezone.localdate())

    @property
    def age_band_display(self) -> str:
        from syllabus.models import AgeBand

        return str(AgeBand(self.age_band).label)
