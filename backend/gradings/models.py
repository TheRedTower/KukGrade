from __future__ import annotations

from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from syllabus.models import AgeBand


class GradingSession(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        OPEN = "OPEN", "Open"
        LOCKED = "LOCKED", "Locked"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"

    title = models.CharField(max_length=200)
    grading_date = models.DateField()
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    location = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_grading_sessions",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-grading_date", "created_at"]
        indexes = [
            models.Index(
                fields=["status", "grading_date"],
                name="grad_session_status_date_idx",
            ),
            models.Index(fields=["grading_date"], name="grad_session_date_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=~Q(title=""),
                name="grading_session_title_not_blank",
            ),
            models.CheckConstraint(
                condition=Q(
                    status__in=[
                        "DRAFT",
                        "OPEN",
                        "LOCKED",
                        "COMPLETED",
                        "CANCELLED",
                    ],
                ),
                name="grading_session_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.grading_date:%Y-%m-%d})"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def clean(self) -> None:
        super().clean()
        self.title = (self.title or "").strip()
        self.location = (self.location or "").strip()
        self.notes = (self.notes or "").strip()

        if not self.title:
            raise ValidationError({"title": ["Title is required."]})
        if self.pk is not None:
            from gradings.services import validate_session_grading_date_change

            validate_session_grading_date_change(self)


class GradingCandidate(models.Model):
    class Status(models.TextChoices):
        REGISTERED = "REGISTERED", "Registered"
        WITHDRAWN = "WITHDRAWN", "Withdrawn"
        COMPLETED = "COMPLETED", "Completed"

    session = models.ForeignKey(
        GradingSession,
        on_delete=models.CASCADE,
        related_name="candidates",
    )
    student = models.ForeignKey(
        "students.Student",
        on_delete=models.PROTECT,
        related_name="grading_candidates",
    )
    testing_for_rank = models.ForeignKey(
        "ranks.Rank",
        on_delete=models.PROTECT,
        related_name="grading_candidates_testing_for_rank",
    )
    age_band = models.CharField(max_length=32, choices=AgeBand.choices)
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.REGISTERED,
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = [
            "session__grading_date",
            "student__last_name",
            "student__first_name",
        ]
        indexes = [
            models.Index(
                fields=["session", "status"],
                name="grad_cand_session_status_idx",
            ),
            models.Index(
                fields=["testing_for_rank", "age_band"],
                name="grad_cand_rank_age_idx",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["session", "student"],
                name="unique_grading_candidate_session_student",
            ),
            models.CheckConstraint(
                condition=Q(
                    age_band__in=[
                        "AGE_8_AND_UNDER",
                        "AGE_9_TO_12",
                        "AGE_13_TO_17",
                        "AGE_18_AND_OVER",
                    ],
                ),
                name="grading_candidate_age_band_valid",
            ),
            models.CheckConstraint(
                condition=Q(
                    status__in=[
                        "REGISTERED",
                        "WITHDRAWN",
                        "COMPLETED",
                    ],
                ),
                name="grading_candidate_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.student} for {self.testing_for_rank} at {self.session}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def clean(self) -> None:
        super().clean()
        self.notes = (self.notes or "").strip()

        if not self.age_band and self.student_id and self.session_id:
            from gradings.services import resolve_age_band

            self.age_band = resolve_age_band(
                self.student.date_of_birth,
                self.session.grading_date,
            )
        if self.session_id and self.student_id and self.testing_for_rank_id:
            from gradings.services import (
                validate_candidate_can_be_changed,
                validate_session_accepts_candidates,
                validate_testing_for_rank,
            )

            if self._state.adding:
                validate_session_accepts_candidates(self.session)
            else:
                validate_candidate_can_be_changed(self)
            validate_testing_for_rank(self.student, self.testing_for_rank)
