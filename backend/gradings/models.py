from __future__ import annotations

from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q

from syllabus.models import AgeBand, SyllabusItem


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
        if self._state.adding and self.status != self.Status.DRAFT:
            raise ValidationError(
                {"status": ["New grading sessions must start in draft status."]},
            )
        if not self._state.adding:
            from gradings.services import validate_session_grading_date_change

            validate_session_grading_date_change(self)
            previous_status = (
                GradingSession.objects.filter(pk=self.pk)
                .values_list("status", flat=True)
                .first()
            )
            if previous_status != self.status:
                raise ValidationError(
                    {
                        "status": [
                            "Use transition_grading_session() for grading "
                            "session status changes.",
                        ],
                    },
                )


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
                validate_candidate_assessment_changes,
                validate_candidate_can_be_changed,
                validate_session_accepts_candidates,
                validate_testing_for_rank,
            )

            if self._state.adding:
                validate_session_accepts_candidates(self.session)
            else:
                validate_candidate_can_be_changed(self)
                previous = (
                    GradingCandidate.objects.filter(pk=self.pk)
                    .values(
                        "session_id",
                        "student_id",
                        "testing_for_rank_id",
                        "status",
                    )
                    .first()
                )
                validate_candidate_assessment_changes(
                    self,
                    session_changed=bool(
                        previous and previous["session_id"] != self.session_id
                    ),
                    student_changed=bool(
                        previous and previous["student_id"] != self.student_id
                    ),
                    testing_for_rank_changed=bool(
                        previous
                        and previous["testing_for_rank_id"] != self.testing_for_rank_id
                    ),
                    status=(
                        self.status
                        if previous and previous["status"] != self.status
                        else None
                    ),
                )
            validate_testing_for_rank(self.student, self.testing_for_rank)


class CandidateAssessment(models.Model):
    class Status(models.TextChoices):
        NOT_STARTED = "NOT_STARTED", "Not started"
        IN_PROGRESS = "IN_PROGRESS", "In progress"
        COMPLETED = "COMPLETED", "Completed"

    candidate = models.OneToOneField(
        GradingCandidate,
        on_delete=models.CASCADE,
        related_name="assessment",
    )
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.NOT_STARTED,
    )
    generated_at = models.DateTimeField(auto_now_add=True)
    generated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="generated_candidate_assessments",
    )
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["candidate__session__grading_date", "candidate__student__last_name"]
        indexes = [
            models.Index(fields=["status"], name="cand_assess_status_idx"),
            models.Index(
                fields=["generated_at"],
                name="cand_assess_generated_idx",
            ),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(
                    status__in=["NOT_STARTED", "IN_PROGRESS", "COMPLETED"],
                ),
                name="candidate_assessment_status_valid",
            ),
            models.CheckConstraint(
                condition=(
                    Q(
                        status="NOT_STARTED",
                        started_at__isnull=True,
                        completed_at__isnull=True,
                    )
                    | Q(
                        status="IN_PROGRESS",
                        started_at__isnull=False,
                        completed_at__isnull=True,
                    )
                    | Q(
                        status="COMPLETED",
                        started_at__isnull=False,
                        completed_at__isnull=False,
                        completed_at__gte=F("started_at"),
                    )
                ),
                name="candidate_assessment_timestamps_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"Assessment for {self.candidate}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def clean(self) -> None:
        super().clean()
        self.notes = (self.notes or "").strip()


class CandidateAssessmentItem(models.Model):
    class Result(models.TextChoices):
        NOT_ASSESSED = "NOT_ASSESSED", "Not assessed"
        MET = "MET", "Met"
        NOT_MET = "NOT_MET", "Not met"

    assessment = models.ForeignKey(
        CandidateAssessment,
        on_delete=models.CASCADE,
        related_name="items",
    )
    source_requirement = models.ForeignKey(
        "syllabus.SyllabusRequirement",
        on_delete=models.SET_NULL,
        related_name="assessment_items",
        null=True,
        blank=True,
    )
    source_item = models.ForeignKey(
        "syllabus.SyllabusItem",
        on_delete=models.SET_NULL,
        related_name="assessment_items",
        null=True,
        blank=True,
    )
    source_rank = models.ForeignKey(
        "ranks.Rank",
        on_delete=models.SET_NULL,
        related_name="assessment_items_for_rank",
        null=True,
        blank=True,
    )
    source_age_band = models.CharField(max_length=32, choices=AgeBand.choices)
    item_code = models.CharField(max_length=80)
    item_name = models.CharField(max_length=160)
    korean_name = models.CharField(max_length=160, blank=True)
    category = models.CharField(max_length=32, choices=SyllabusItem.Category.choices)
    requirement_sequence = models.PositiveIntegerField()
    required = models.BooleanField(default=True)
    start_number = models.PositiveIntegerField(null=True, blank=True)
    end_number = models.PositiveIntegerField(null=True, blank=True)
    requirement_notes = models.TextField(blank=True)
    result = models.CharField(
        max_length=32,
        choices=Result.choices,
        default=Result.NOT_ASSESSED,
    )
    assessor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="assessed_candidate_items",
        null=True,
        blank=True,
    )
    assessed_at = models.DateTimeField(null=True, blank=True)
    assessor_notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["requirement_sequence", "item_name", "pk"]
        indexes = [
            models.Index(
                fields=["assessment", "result"],
                name="cand_item_assess_result_idx",
            ),
            models.Index(
                fields=["category", "required"],
                name="cand_item_cat_required_idx",
            ),
            models.Index(fields=["item_code"], name="cand_item_code_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(
                    source_age_band__in=[
                        "AGE_8_AND_UNDER",
                        "AGE_9_TO_12",
                        "AGE_13_TO_17",
                        "AGE_18_AND_OVER",
                    ],
                ),
                name="candidate_item_age_band_valid",
            ),
            models.CheckConstraint(
                condition=Q(
                    category__in=[
                        "ETIQUETTE",
                        "FUNDAMENTALS",
                        "HAND_TECHNIQUES",
                        "KICKING",
                        "FALLING",
                        "BREAKING",
                        "TECHNIQUE_SET",
                        "FORM",
                        "WEAPONS",
                        "OTHER",
                    ],
                ),
                name="candidate_item_category_valid",
            ),
            models.CheckConstraint(
                condition=Q(
                    result__in=["NOT_ASSESSED", "MET", "NOT_MET"],
                ),
                name="candidate_item_result_valid",
            ),
            models.CheckConstraint(
                condition=Q(requirement_sequence__gt=0),
                name="candidate_item_sequence_positive",
            ),
            models.CheckConstraint(
                condition=(
                    Q(start_number__isnull=True, end_number__isnull=True)
                    | Q(start_number__isnull=False, end_number__isnull=False)
                ),
                name="candidate_item_range_complete",
            ),
            models.CheckConstraint(
                condition=Q(start_number__isnull=True) | Q(start_number__gte=1),
                name="candidate_item_start_positive",
            ),
            models.CheckConstraint(
                condition=Q(end_number__isnull=True)
                | Q(end_number__gte=F("start_number")),
                name="candidate_item_end_not_before_start",
            ),
            models.UniqueConstraint(
                fields=["assessment", "source_requirement"],
                condition=Q(source_requirement__isnull=False),
                name="unique_assessment_source_requirement",
            ),
            models.UniqueConstraint(
                fields=[
                    "assessment",
                    "source_age_band",
                    "item_code",
                    "requirement_sequence",
                ],
                name="unique_assessment_item_snapshot",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.item_code}: {self.item_name}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def clean(self) -> None:
        super().clean()
        self.item_code = (self.item_code or "").strip()
        self.item_name = (self.item_name or "").strip()
        self.korean_name = (self.korean_name or "").strip()
        self.requirement_notes = (self.requirement_notes or "").strip()
        self.assessor_notes = (self.assessor_notes or "").strip()

        errors: dict[str, list[str]] = {}
        if not self.item_code:
            errors["item_code"] = ["Item code is required."]
        if not self.item_name:
            errors["item_name"] = ["Item name is required."]
        if self.requirement_sequence is not None and self.requirement_sequence <= 0:
            errors["requirement_sequence"] = ["Requirement sequence must be positive."]

        has_start = self.start_number is not None
        has_end = self.end_number is not None
        if has_start != has_end:
            message = "Start and end numbers must be provided together."
            if has_start:
                errors["end_number"] = [message]
            else:
                errors["start_number"] = [message]
        if self.start_number is not None and self.start_number < 1:
            errors["start_number"] = ["Start number must be at least 1."]
        if (
            self.start_number is not None
            and self.end_number is not None
            and self.end_number < self.start_number
        ):
            errors["end_number"] = [
                "End number must be greater than or equal to start number.",
            ]

        if errors:
            raise ValidationError(errors)

    @property
    def has_numbered_range(self) -> bool:
        return self.start_number is not None and self.end_number is not None

    @property
    def display_range(self) -> str:
        if not self.has_numbered_range:
            return ""
        if self.start_number == self.end_number:
            return str(self.start_number)
        return f"{self.start_number}-{self.end_number}"
