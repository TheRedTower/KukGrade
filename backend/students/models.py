from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone

from ranks.models import Rank
from students import wksa_ids


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

    # Set by a caller that has already checked a whole batch of IDs against
    # the previous IDs in one query (the roster preview), so validating each
    # row does not query again. Saving always checks.
    previous_ids_checked = False

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
    # The import that added the student, by number, so an import's results
    # can show just its students; blank for one added by hand. By number for
    # the reason StudentExtraInfo.source_import is.
    source_import = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["last_name", "first_name", "wksa_id"]
        constraints = [
            # Either form and nothing else, whatever path wrote the row
            # (students/wksa_ids.py).
            models.CheckConstraint(
                condition=Q(wksa_id__regex=wksa_ids.DATABASE_PATTERN),
                name="student_wksa_id_format",
            ),
            models.CheckConstraint(
                condition=Q(status__in=["ACTIVE", "INACTIVE", "LEFT"]),
                name="student_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.full_name} ({self.wksa_id})"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def clean(self) -> None:
        super().clean()
        self.wksa_id = wksa_ids.normalise(self.wksa_id)
        self.first_name = (self.first_name or "").strip()
        self.last_name = (self.last_name or "").strip()

        stored = (
            Student.objects.filter(pk=self.pk)
            .values("wksa_id", "current_rank_id")
            .first()
            if not self._state.adding and self.pk is not None
            else None
        )

        errors: dict[str, list[str]] = {}
        form = wksa_ids.form_of(self.wksa_id)
        if not self.wksa_id:
            errors["wksa_id"] = ["WKSA ID is required."]
        elif form is None:
            errors["wksa_id"] = [wksa_ids.format_message()]
        elif (
            not self.previous_ids_checked
            and (self._state.adding or (stored and stored["wksa_id"] != self.wksa_id))
            and wksa_id_ever_held(self.wksa_id)
        ):
            errors["wksa_id"] = [wksa_ids.PREVIOUS_ID_TAKEN_MESSAGE]
        elif stored and (
            refusal := wksa_ids.change_refusal(stored["wksa_id"], self.wksa_id)
        ):
            errors["wksa_id"] = [refusal]
        elif (
            self.current_rank_id is not None
            and self.current_rank.category == Rank.Category.BLACK_BELT
            and form is not wksa_ids.BLACK_BELT_ID
        ):
            errors["wksa_id"] = [wksa_ids.BLACK_BELT_RANK_MESSAGE]
        if not self.first_name:
            errors["first_name"] = ["First name is required."]
        if not self.last_name:
            errors["last_name"] = ["Last name is required."]
        if self.date_of_birth and self.date_of_birth > timezone.localdate():
            errors["date_of_birth"] = ["Date of birth cannot be in the future."]
        if stored:
            previous_rank_id = stored["current_rank_id"]
            if previous_rank_id != self.current_rank_id and self.promotions.exists():
                errors["current_rank"] = [
                    "Use the promotion workflow to change current rank after "
                    "promotion history exists.",
                ]

        if errors:
            raise ValidationError(errors)

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def can_be_graded(self) -> bool:
        """Whether this student may be registered as a grading candidate."""
        return self.status != Student.Status.LEFT

    @property
    def age_band(self) -> str:
        """The canonical age band relative to today."""
        from gradings.age import resolve_age_band

        return resolve_age_band(self.date_of_birth, timezone.localdate())

    @property
    def age_band_display(self) -> str:
        from syllabus.models import AgeBand

        return AgeBand(self.age_band).label


class PreviousWksaId(models.Model):
    """A student ID a student held before WKSA gave them a black belt ID.

    Written only when the ID changes (`students.services.update_student`),
    never edited. A number is never reused, so each is unique for good and
    anything outside KukGrade that still quotes one is found by it
    (decision log, 2026-10-20). Always a student ID: a mistyped black belt
    ID can be corrected, but the mistaken value is not kept here.
    """

    student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        related_name="previous_wksa_ids",
    )
    wksa_id = models.CharField(max_length=32, unique=True)
    replaced_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["replaced_at", "pk"]
        constraints = [
            models.CheckConstraint(
                condition=Q(wksa_id__regex=wksa_ids.STUDENT_ID_DATABASE_PATTERN),
                name="previous_wksa_id_student_form",
            ),
            # A student ID changes once, to the black belt ID, so a student
            # has at most one previous ID - which also keeps a search by it
            # to one row per student.
            models.UniqueConstraint(
                fields=["student"],
                name="previous_wksa_id_one_per_student",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.wksa_id} (replaced {self.replaced_at:%Y-%m-%d})"


class RetiredWksaId(models.Model):
    """An ID whose student was deleted: still never given to anyone else.

    Written by `students.services.delete_student` for the deleted student's
    current ID and every previous one (owner, 2026-10-20: "same for
    deletions"). Either form, since a deleted black belt's ID is retired too.
    Nothing else about the student is kept here; the deletion's audit event
    has the rest.
    """

    wksa_id = models.CharField(max_length=32, unique=True)
    retired_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["retired_at", "pk"]
        constraints = [
            models.CheckConstraint(
                condition=Q(wksa_id__regex=wksa_ids.DATABASE_PATTERN),
                name="retired_wksa_id_format",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.wksa_id} (retired {self.retired_at:%Y-%m-%d})"


def wksa_id_ever_held(wksa_id: str) -> bool:
    """Whether a student held `wksa_id` before: replaced, or deleted."""
    return (
        PreviousWksaId.objects.filter(wksa_id=wksa_id).exists()
        or RetiredWksaId.objects.filter(wksa_id=wksa_id).exists()
    )


class StudentExtraInfo(models.Model):
    """Something a file said about a student that KukGrade has no field for.

    A column the importer chose to keep (decision log, 2026-10-20 import
    overhaul) - a parent's phone, a note - stored as the file labelled it,
    rather than dropped or turned into a new field. Personal data like the
    rest of the student, and deleted with them.
    """

    student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        related_name="extra_information",
    )
    label = models.CharField(max_length=150)
    value = models.TextField()
    # Which import it came from, by number: an import is never deleted, but
    # the student app does not depend on the imports app.
    source_import = models.PositiveIntegerField(null=True, blank=True)
    added_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["student", "label"]
        constraints = [
            models.UniqueConstraint(
                fields=["student", "label"],
                name="student_extra_info_one_per_label",
            ),
            models.CheckConstraint(
                condition=~Q(label="") & ~Q(value=""),
                name="student_extra_info_not_blank",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.label}: {self.value}"
