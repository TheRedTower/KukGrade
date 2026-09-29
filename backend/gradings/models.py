from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q

from syllabus.models import (
    AgeBand,
    SyllabusItem,
    format_numbered_range,
    numbered_range_errors,
)

if TYPE_CHECKING:
    from accounts.models import User


class GradingSessionQuerySet(models.QuerySet["GradingSession"]):
    def delete(self) -> tuple[int, dict[str, int]]:
        # QuerySet.delete() does not call Model.delete(), so the rule has to
        # be applied here too or a bulk delete walks straight past it.
        from gradings.services import validate_session_can_be_deleted

        for session in self:
            validate_session_can_be_deleted(session)
        return super().delete()


class GradingSession(models.Model):
    if TYPE_CHECKING:
        created_by_id: int
        candidates: models.Manager[GradingCandidate]

    # Set only by GradingSessionAdminForm.clean(), after it has already
    # validated the transition itself. Without this, ModelForm._post_clean()
    # calls full_clean() with the new status already on the instance, which
    # this same guard then rejects before save_model() - the service call
    # that actually performs the transition - is ever reached, so the admin
    # status dropdown could not be used at all, for any transition.
    _allow_status_transition: bool = False

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
    # Required only when cancelling a LOCKED session. Cancelling a draft is
    # routine; abandoning a grading people have already been assessed in is
    # exceptional and has to say why.
    cancellation_reason = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_grading_sessions",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = GradingSessionQuerySet.as_manager()

    class Meta:
        ordering = ["-grading_date", "created_at"]
        permissions = [
            (
                "can_override_locked_session",
                "Can withdraw a candidate from, or cancel, a locked session",
            ),
            (
                "delete_any_gradingsession",
                "Can delete a grading session in any status",
            ),
        ]
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

    def delete(
        self,
        *args: Any,
        actor: User | None = None,
        **kwargs: Any,
    ) -> tuple[int, dict[str, int]]:
        from gradings.services import validate_session_can_be_deleted

        validate_session_can_be_deleted(self, actor=actor)
        return super().delete(*args, **kwargs)

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
            if previous_status != self.status and not self._allow_status_transition:
                raise ValidationError(
                    {
                        "status": [
                            "Use transition_grading_session() for grading "
                            "session status changes.",
                        ],
                    },
                )


class GradingCandidateQuerySet(models.QuerySet["GradingCandidate"]):
    def delete(self) -> tuple[int, dict[str, int]]:
        from gradings.services import validate_candidate_can_be_deleted

        for candidate in self:
            validate_candidate_can_be_deleted(candidate)
        return super().delete()


CANDIDATE_STUDENT_FIXED_MESSAGE = (
    "A registration's student cannot be changed. Remove the candidate and "
    "register the right student instead."
)
OTHER_WITHDRAWAL_NOTE_MESSAGE = "Say what the other reason is."
CANDIDATE_REGISTERED_ON_CREATION_MESSAGE = (
    "A candidate is registered as REGISTERED, then withdrawn afterwards with "
    "a reason if they do not grade."
)


class GradingCandidate(models.Model):
    if TYPE_CHECKING:
        session_id: int
        student_id: int
        from_rank_id: int
        testing_for_rank_id: int
        withdrawn_by_id: int | None
        assessment: CandidateAssessment
        outcome: CandidateOutcome
        promotion: Promotion

    # Set only by withdraw_locked_candidate(), which checks authority first.
    _allow_locked_withdrawal: bool = False

    class Status(models.TextChoices):
        REGISTERED = "REGISTERED", "Registered"
        WITHDRAWN = "WITHDRAWN", "Withdrawn"
        COMPLETED = "COMPLETED", "Completed"

    class WithdrawalReason(models.TextChoices):
        INJURY = "INJURY", "Injured during grading"
        WITHDREW = "WITHDREW", "Withdrew voluntarily"
        ABSENT = "ABSENT", "Did not attend"
        # Anything else, said in the note - an Other with no note records
        # nothing, so the model refuses it.
        OTHER = "OTHER", "Other"

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
    # The rank the student held when registered. Snapshotted rather than read
    # from Student.current_rank, which moves on after promotion - without it
    # a sealed record would show the student's later rank as where they
    # started. Set on first save from the student's current rank.
    from_rank = models.ForeignKey(
        "ranks.Rank",
        on_delete=models.PROTECT,
        related_name="grading_candidates_from_rank",
        editable=False,
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
    # Every withdrawal records why, who and when - before the session locks
    # (attendance) as well as after it (withdraw_locked_candidate).
    withdrawal_reason = models.CharField(
        max_length=32,
        choices=WithdrawalReason.choices,
        blank=True,
    )
    withdrawal_note = models.TextField(blank=True)
    withdrawn_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="withdrawn_grading_candidates",
        null=True,
        blank=True,
    )
    withdrawn_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = GradingCandidateQuerySet.as_manager()

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
            models.CheckConstraint(
                condition=Q(
                    withdrawal_reason__in=[
                        "INJURY",
                        "WITHDREW",
                        "ABSENT",
                        "OTHER",
                    ],
                )
                | Q(withdrawal_reason=""),
                name="grading_candidate_withdrawal_reason_valid",
            ),
            models.CheckConstraint(
                condition=~Q(withdrawal_reason="OTHER", withdrawal_note=""),
                name="grading_candidate_other_withdrawal_has_note",
            ),
            # Attribution travels together, and only ever on a withdrawal.
            models.CheckConstraint(
                condition=(
                    Q(
                        withdrawal_reason="",
                        withdrawn_by__isnull=True,
                        withdrawn_at__isnull=True,
                    )
                    | Q(
                        status="WITHDRAWN",
                        withdrawn_by__isnull=False,
                        withdrawn_at__isnull=False,
                    )
                    & ~Q(withdrawal_reason="")
                ),
                name="grading_candidate_withdrawal_attribution_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.student} for {self.testing_for_rank} at {self.session}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        if self._state.adding and not self.from_rank_id and self.student_id:
            self.from_rank_id = self.student.current_rank_id
        self.full_clean()
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        from gradings.services import validate_candidate_can_be_deleted

        validate_candidate_can_be_deleted(self)
        return super().delete(*args, **kwargs)

    def clean(self) -> None:
        super().clean()
        self.notes = (self.notes or "").strip()
        self.withdrawal_note = (self.withdrawal_note or "").strip()
        if (
            self.withdrawal_reason == GradingCandidate.WithdrawalReason.OTHER
            and not self.withdrawal_note
        ):
            raise ValidationError({"withdrawal_note": [OTHER_WITHDRAWAL_NOTE_MESSAGE]})

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
                # Withdrawal and completion each have their own path, which
                # records why and by whom.
                if self.status != GradingCandidate.Status.REGISTERED:
                    raise ValidationError(
                        {"status": [CANDIDATE_REGISTERED_ON_CREATION_MESSAGE]},
                    )
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
                if previous and previous["student_id"] != self.student_id:
                    raise ValidationError(
                        {"student": [CANDIDATE_STUDENT_FIXED_MESSAGE]},
                    )
                validate_candidate_assessment_changes(
                    self,
                    session_changed=bool(
                        previous and previous["session_id"] != self.session_id
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
    if TYPE_CHECKING:
        candidate_id: int
        assessed_by_id: int | None
        outcome: CandidateOutcome
        items: models.Manager[CandidateAssessmentItem]

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
            # Not redundant with the OneToOne on `candidate`: it is the
            # unique target the composite foreign key from CandidateOutcome
            # references, which is what stops an outcome being attached to
            # another candidate's assessment.
            models.UniqueConstraint(
                fields=["id", "candidate"],
                name="unique_assessment_id_candidate",
            ),
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


class CandidateOutcomeQuerySet(models.QuerySet["CandidateOutcome"]):
    def update(self, **kwargs: Any) -> int:
        # clean() already refuses to change a finalised outcome through
        # save(); QuerySet.update() bypasses clean() entirely and was the
        # one path left that could rewrite a finalised decision from a
        # shell with no validation and no trace.
        if self.filter(status=CandidateOutcome.Status.FINALISED).exists():
            raise ValidationError(
                {"status": ["Finalised candidate outcomes are immutable."]},
            )
        return super().update(**kwargs)


class CandidateOutcome(models.Model):
    if TYPE_CHECKING:
        candidate_id: int
        assessment_id: int
        proposed_by_id: int | None
        decided_by_id: int | None
        promotion: Promotion

    _allow_status_transition: bool = False

    class Outcome(models.TextChoices):
        PASS = "PASS", "Pass"
        FAIL = "FAIL", "Fail"
        CONDITIONAL = "CONDITIONAL", "Conditional"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PROPOSED = "PROPOSED", "Proposed"
        FINALISED = "FINALISED", "Finalised"

    candidate = models.OneToOneField(
        GradingCandidate,
        on_delete=models.CASCADE,
        related_name="outcome",
    )
    assessment = models.OneToOneField(
        CandidateAssessment,
        on_delete=models.PROTECT,
        related_name="outcome",
    )
    proposed_outcome = models.CharField(  # noqa: DJ001
        max_length=32,
        choices=Outcome.choices,
        null=True,
        blank=True,
    )
    proposed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="proposed_candidate_outcomes",
        null=True,
        blank=True,
    )
    proposed_at = models.DateTimeField(null=True, blank=True)
    proposal_notes = models.TextField(blank=True)
    final_outcome = models.CharField(  # noqa: DJ001
        max_length=32,
        choices=Outcome.choices,
        null=True,
        blank=True,
    )
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="decided_candidate_outcomes",
        null=True,
        blank=True,
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_notes = models.TextField(blank=True)
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    conditional_requirements = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = CandidateOutcomeQuerySet.as_manager()

    class Meta:
        ordering = [
            "candidate__session__grading_date",
            "candidate__student__last_name",
            "candidate__student__first_name",
        ]
        indexes = [
            models.Index(fields=["status"], name="cand_outcome_status_idx"),
            models.Index(
                fields=["proposed_outcome"],
                name="cand_outcome_proposed_idx",
            ),
            models.Index(fields=["final_outcome"], name="cand_outcome_final_idx"),
            models.Index(fields=["decided_at"], name="cand_outcome_decided_idx"),
        ]
        permissions = [
            (
                "can_make_final_grading_decision",
                "Can make final grading decision",
            ),
            (
                "can_view_grading_audit_log",
                "Can view grading and syllabus audit events",
            ),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=["DRAFT", "PROPOSED", "FINALISED"]),
                name="candidate_outcome_status_valid",
            ),
            models.CheckConstraint(
                condition=Q(proposed_outcome__isnull=True)
                | Q(proposed_outcome__in=["PASS", "FAIL", "CONDITIONAL"]),
                name="candidate_outcome_proposed_valid",
            ),
            models.CheckConstraint(
                condition=Q(final_outcome__isnull=True)
                | Q(final_outcome__in=["PASS", "FAIL", "CONDITIONAL"]),
                name="candidate_outcome_final_valid",
            ),
            models.CheckConstraint(
                condition=(
                    Q(
                        status="DRAFT",
                        proposed_outcome__isnull=True,
                        proposed_by__isnull=True,
                        proposed_at__isnull=True,
                        final_outcome__isnull=True,
                        decided_by__isnull=True,
                        decided_at__isnull=True,
                        conditional_requirements="",
                    )
                    | Q(
                        status="PROPOSED",
                        proposed_outcome__isnull=False,
                        proposed_by__isnull=False,
                        proposed_at__isnull=False,
                        final_outcome__isnull=True,
                        decided_by__isnull=True,
                        decided_at__isnull=True,
                        conditional_requirements="",
                    )
                    | Q(
                        status="FINALISED",
                        proposed_outcome__isnull=False,
                        proposed_by__isnull=False,
                        proposed_at__isnull=False,
                        final_outcome__isnull=False,
                        decided_by__isnull=False,
                        decided_at__isnull=False,
                        decided_at__gte=F("proposed_at"),
                    )
                ),
                name="candidate_outcome_status_fields_valid",
            ),
            models.CheckConstraint(
                condition=(
                    Q(
                        final_outcome="CONDITIONAL",
                        conditional_requirements__gt="",
                    )
                    | (
                        Q(final_outcome__isnull=True)
                        | Q(final_outcome__in=["PASS", "FAIL"])
                    )
                    & Q(conditional_requirements="")
                ),
                name="candidate_outcome_conditions_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"Outcome for {self.candidate}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        if self.status == self.Status.FINALISED:
            raise ValidationError(
                {"status": ["Finalised candidate outcomes cannot be deleted."]},
            )
        return super().delete(*args, **kwargs)

    def clean(self) -> None:
        super().clean()
        self.proposal_notes = (self.proposal_notes or "").strip()
        self.decision_notes = (self.decision_notes or "").strip()
        self.conditional_requirements = (self.conditional_requirements or "").strip()

        errors: dict[str, list[str]] = {}
        if (
            self.candidate_id
            and self.assessment_id
            and self.assessment.candidate_id != self.candidate_id
        ):
            errors["assessment"] = [
                "Outcome assessment must belong to the same grading candidate.",
            ]

        if not self._state.adding and self.pk is not None:
            previous = (
                CandidateOutcome.objects.filter(pk=self.pk)
                .values(
                    "candidate_id",
                    "assessment_id",
                    "status",
                    "proposed_outcome",
                    "proposed_by_id",
                    "proposed_at",
                    "proposal_notes",
                    "final_outcome",
                    "decided_by_id",
                    "decided_at",
                    "decision_notes",
                    "conditional_requirements",
                )
                .first()
            )
            if previous is not None:
                status_changed = previous["status"] != self.status
                if status_changed and not self._allow_status_transition:
                    errors["status"] = [
                        "Use the candidate outcome workflow services for "
                        "status changes.",
                    ]
                if previous["status"] == self.Status.FINALISED:
                    protected_changes = (
                        previous["candidate_id"] != self.candidate_id
                        or previous["assessment_id"] != self.assessment_id
                        or previous["status"] != self.status
                        or previous["proposed_outcome"] != self.proposed_outcome
                        or previous["proposed_by_id"] != self.proposed_by_id
                        or previous["proposed_at"] != self.proposed_at
                        or previous["proposal_notes"] != self.proposal_notes
                        or previous["final_outcome"] != self.final_outcome
                        or previous["decided_by_id"] != self.decided_by_id
                        or previous["decided_at"] != self.decided_at
                        or previous["decision_notes"] != self.decision_notes
                        or previous["conditional_requirements"]
                        != self.conditional_requirements
                    )
                    if protected_changes:
                        errors["status"] = [
                            "Finalised candidate outcomes are immutable.",
                        ]

        if self.status == self.Status.DRAFT:
            if self.proposed_outcome is not None:
                errors["proposed_outcome"] = [
                    "Draft outcomes cannot have a proposed outcome.",
                ]
            if self.proposed_by_id is not None or self.proposed_at is not None:
                errors["proposed_by"] = [
                    "Draft outcomes cannot have proposal attribution.",
                ]
            if self.final_outcome is not None:
                errors["final_outcome"] = [
                    "Draft outcomes cannot have a final outcome.",
                ]
        if self.status == self.Status.PROPOSED:
            if self.proposed_outcome is None:
                errors["proposed_outcome"] = ["Proposed outcome is required."]
            if self.proposed_by_id is None or self.proposed_at is None:
                errors["proposed_by"] = [
                    "Proposal attribution is required.",
                ]
            if self.final_outcome is not None:
                errors["final_outcome"] = [
                    "Proposed outcomes cannot have final decision fields.",
                ]
        if self.status == self.Status.FINALISED:
            if self.proposed_outcome is None:
                errors["proposed_outcome"] = ["Proposed outcome is required."]
            if self.proposed_by_id is None or self.proposed_at is None:
                errors["proposed_by"] = ["Proposal attribution is required."]
            if self.final_outcome is None:
                errors["final_outcome"] = ["Final outcome is required."]
            if self.decided_by_id is None or self.decided_at is None:
                errors["decided_by"] = [
                    "Final decision attribution is required.",
                ]
            if (
                self.proposed_at is not None
                and self.decided_at is not None
                and self.decided_at < self.proposed_at
            ):
                errors["decided_at"] = [
                    "Decision timestamp cannot be before proposal timestamp.",
                ]

        if self.final_outcome == self.Outcome.CONDITIONAL:
            if not self.conditional_requirements:
                errors["conditional_requirements"] = [
                    "Conditional requirements are required for conditional outcomes.",
                ]
        elif self.conditional_requirements:
            errors["conditional_requirements"] = [
                "Conditional requirements must be blank for pass or fail outcomes.",
            ]

        if errors:
            raise ValidationError(errors)


class CandidateAssessmentItem(models.Model):
    if TYPE_CHECKING:
        assessment_id: int
        syllabus_item_id: int

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
    # The item's place in the assessment, from 1, in syllabus order. The
    # copied sequence cannot order a cumulative assessment: it is only the
    # item's place among its own rank's requirements.
    position = models.PositiveIntegerField()
    required = models.BooleanField(default=True)
    start_number = models.PositiveIntegerField(null=True, blank=True)
    end_number = models.PositiveIntegerField(null=True, blank=True)
    requirement_notes = models.TextField(blank=True)
    result = models.CharField(
        max_length=32,
        choices=Result.choices,
        default=Result.NOT_ASSESSED,
    )
    # PROTECT, not SET_NULL. Every other attribution field on these models
    # already protects: generated_by, proposed_by, decided_by, promoted_by.
    # Nulling an assessor on user deletion would both erase who judged an
    # item and violate the attribution constraint below.
    assessor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="assessed_candidate_items",
        null=True,
        blank=True,
    )
    assessed_at = models.DateTimeField(null=True, blank=True)
    assessor_notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "pk"]
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
                condition=Q(position__gt=0),
                name="candidate_item_position_positive",
            ),
            models.UniqueConstraint(
                fields=["assessment", "position"],
                name="unique_assessment_item_position",
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
            # A recorded judgement always says who made it and when; an
            # unassessed item never claims either.
            models.CheckConstraint(
                condition=(
                    Q(
                        result="NOT_ASSESSED",
                        assessor__isnull=True,
                        assessed_at__isnull=True,
                    )
                    | Q(
                        result__in=["MET", "NOT_MET"],
                        assessor__isnull=False,
                        assessed_at__isnull=False,
                    )
                ),
                name="candidate_item_assessor_matches_result",
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

        errors = numbered_range_errors(self.start_number, self.end_number)
        if not self.item_code:
            errors["item_code"] = ["Item code is required."]
        if not self.item_name:
            errors["item_name"] = ["Item name is required."]
        if self.requirement_sequence is not None and self.requirement_sequence <= 0:
            errors["requirement_sequence"] = ["Requirement sequence must be positive."]
        if self.position is not None and self.position <= 0:
            errors["position"] = ["Position must be positive."]

        if errors:
            raise ValidationError(errors)

    @property
    def display_range(self) -> str:
        return format_numbered_range(self.start_number, self.end_number)


class PromotionQuerySet(models.QuerySet["Promotion"]):
    def delete(self) -> tuple[int, dict[str, int]]:
        raise ValidationError(
            {"promotion": ["Promotion records are immutable and cannot be deleted."]},
        )

    def update(self, **kwargs: Any) -> int:
        # save() and delete() already refuse; QuerySet.update() bypasses both
        # (no clean(), no delete()) and was the one path left that could
        # silently rewrite a promotion's rank or attribution from a shell.
        raise ValidationError(
            {"promotion": ["Promotion records are immutable and cannot be changed."]},
        )


class Promotion(models.Model):
    if TYPE_CHECKING:
        student_id: int
        outcome_id: int
        grading_candidate_id: int
        from_rank_id: int
        to_rank_id: int
        promoted_by_id: int

    student = models.ForeignKey(
        "students.Student",
        on_delete=models.PROTECT,
        related_name="promotions",
    )
    outcome = models.OneToOneField(
        CandidateOutcome,
        on_delete=models.PROTECT,
        related_name="promotion",
    )
    grading_candidate = models.OneToOneField(
        GradingCandidate,
        on_delete=models.PROTECT,
        related_name="promotion",
    )
    from_rank = models.ForeignKey(
        "ranks.Rank",
        on_delete=models.PROTECT,
        related_name="promotions_from_rank",
    )
    to_rank = models.ForeignKey(
        "ranks.Rank",
        on_delete=models.PROTECT,
        related_name="promotions_to_rank",
    )
    promoted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="recorded_promotions",
    )
    promoted_at = models.DateTimeField(auto_now_add=True)
    effective_date = models.DateField()
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = PromotionQuerySet.as_manager()

    class Meta:
        ordering = ["-effective_date", "-promoted_at", "-pk"]
        indexes = [
            models.Index(
                fields=["student", "-effective_date", "-promoted_at"],
                name="promotion_student_history_idx",
            ),
            models.Index(fields=["effective_date"], name="promotion_effective_idx"),
            models.Index(fields=["promoted_at"], name="promotion_promoted_idx"),
        ]
        permissions = [
            ("can_promote_student", "Can promote student"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=~Q(from_rank=F("to_rank")),
                name="promotion_from_to_rank_distinct",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.student} promoted from {self.from_rank} to {self.to_rank}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        raise ValidationError(
            {"promotion": ["Promotion records are immutable and cannot be deleted."]},
        )

    def clean(self) -> None:
        super().clean()
        self.notes = (self.notes or "").strip()

        errors: dict[str, list[str]] = {}
        if (
            self.outcome_id
            and self.grading_candidate_id
            and self.outcome.candidate_id != self.grading_candidate_id
        ):
            errors["outcome"] = [
                "Promotion outcome must belong to the grading candidate.",
            ]
        if (
            self.outcome_id
            and self.grading_candidate_id
            and self.outcome.assessment.candidate_id != self.grading_candidate_id
        ):
            errors["assessment"] = [
                "Promotion outcome assessment must belong to the grading candidate.",
            ]
        if (
            self.grading_candidate_id
            and self.student_id
            and self.grading_candidate.student_id != self.student_id
        ):
            errors["student"] = [
                "Promotion student must match the grading candidate student.",
            ]
        if (
            self.grading_candidate_id
            and self.to_rank_id
            and self.grading_candidate.testing_for_rank_id != self.to_rank_id
        ):
            errors["to_rank"] = [
                "Promotion target rank must match the candidate testing-for rank.",
            ]
        if (
            self.from_rank_id
            and self.to_rank_id
            and self.from_rank_id == self.to_rank_id
        ):
            errors["to_rank"] = ["Promotion target rank must differ from source rank."]

        if not self._state.adding and self.pk is not None:
            previous = (
                Promotion.objects.filter(pk=self.pk)
                .values(
                    "student_id",
                    "outcome_id",
                    "grading_candidate_id",
                    "from_rank_id",
                    "to_rank_id",
                    "promoted_by_id",
                    "promoted_at",
                    "effective_date",
                    "notes",
                )
                .first()
            )
            if previous is not None:
                changed_fields = [
                    field
                    for field, value in previous.items()
                    if getattr(self, field) != value
                ]
                if changed_fields:
                    errors["promotion"] = [
                        "Promotion records are immutable after creation.",
                    ]

        if errors:
            raise ValidationError(errors)


class LegacyGradingRecordQuerySet(models.QuerySet["LegacyGradingRecord"]):
    def delete(self) -> tuple[int, dict[str, int]]:
        raise ValidationError(
            {
                "legacy_grading_record": [
                    "Legacy grading records cannot be deleted - void instead.",
                ],
            },
        )

    def update(self, **kwargs: Any) -> int:
        # Every legitimate change goes through gradings.legacy_services on a
        # single locked instance (so clean()'s source-field immutability
        # check and the accompanying audit event both run); a bulk
        # queryset .update() would bypass both silently.
        raise ValidationError(
            {
                "legacy_grading_record": [
                    "Legacy grading records must be changed through "
                    "gradings.legacy_services, not updated directly.",
                ],
            },
        )


class LegacyRecordKind(models.TextChoices):
    GRADING_RESULT = "GRADING_RESULT", "Grading result"
    AUXILIARY_NOTE = "AUXILIARY_NOTE", "Auxiliary note"
    DID_NOT_ATTEND = "DID_NOT_ATTEND", "Did not attend"


class LegacyOutcome(models.TextChoices):
    PASS = "PASS", "Pass"
    FAIL = "FAIL", "Fail"
    CONDITIONAL = "CONDITIONAL", "Conditional"


class LegacyAttendance(models.TextChoices):
    ATTENDED = "ATTENDED", "Attended"
    DID_NOT_ATTEND = "DID_NOT_ATTEND", "Did not attend"
    UNKNOWN = "UNKNOWN", "Unknown"


class LegacyDatePrecision(models.TextChoices):
    MONTH = "MONTH", "Month"
    DAY = "DAY", "Day"


class LegacyGradingRecord(models.Model):
    """One row of imported historical grading evidence - never native.

    A distinct, deliberately weaker evidence model from CandidateAssessment/
    CandidateOutcome/Promotion: the historical workbook does not contain
    enough evidence (exact date, syllabus snapshot, item-level judgement,
    assessor, decision attribution) to honestly recreate those. See
    docs/data-import-and-legacy-migration.md.

    Source-text fields (everything except `student`, `current_rank`,
    `testing_for_rank` and the void fields) are immutable after import -
    `clean()` below enforces it. Only gradings.legacy_services mutates a row
    (link/unlink/resolve-rank/void), always through one locked instance
    save() so the immutability check and an audit event both run; ordinary
    queryset mutation and physical deletion are blocked outright
    (LegacyGradingRecordQuerySet above) - void is the only removal path,
    consistent with "historical records are never physically deleted"
    (import Decision 16).
    """

    if TYPE_CHECKING:
        student_id: int | None
        source_batch_id: int
        current_rank_id: int | None
        testing_for_rank_id: int | None
        voided_by_id: int | None

    # Every field that is NOT here is a source fact and is immutable after
    # creation - see clean() below, which derives the immutable set as
    # "every model field except these" rather than hand-listing the source
    # fields a second time.
    _MUTABLE_FIELD_NAMES: frozenset[str] = frozenset(
        {
            "id",
            "student_id",
            "current_rank_id",
            "testing_for_rank_id",
            "is_void",
            "void_reason",
            "voided_by_id",
            "voided_at",
            "created_at",
            "updated_at",
        },
    )

    # Nullable, PROTECT: a legacy record may be committed with no known
    # Student match (import Decision 2) but must never silently lose that link once
    # deleting a user is possible.
    student = models.ForeignKey(
        "students.Student",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="legacy_grading_records",
    )
    source_batch = models.ForeignKey(
        "data_imports.ImportBatch",
        on_delete=models.PROTECT,
        related_name="legacy_records",
    )
    record_kind = models.CharField(max_length=32, choices=LegacyRecordKind.choices)

    source_sheet = models.CharField(max_length=100)
    source_section = models.CharField(max_length=100, blank=True)
    source_locator = models.CharField(max_length=100)

    cycle_year = models.PositiveSmallIntegerField()
    cycle_month = models.PositiveSmallIntegerField()
    # Never invented beyond what the source states (import Decision 14) - MONTH
    # unless a specific day was genuinely present in the source.
    grading_date = models.DateField(null=True, blank=True)
    date_precision = models.CharField(
        max_length=8,
        choices=LegacyDatePrecision.choices,
        default=LegacyDatePrecision.MONTH,
    )

    source_name = models.CharField(max_length=200)

    source_current_rank_text = models.CharField(max_length=100, blank=True)
    current_rank = models.ForeignKey(
        "ranks.Rank",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="legacy_current_rank_records",
    )
    source_testing_for_rank_text = models.CharField(max_length=100, blank=True)
    testing_for_rank = models.ForeignKey(
        "ranks.Rank",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="legacy_testing_for_rank_records",
    )

    source_outcome_text = models.CharField(max_length=200, blank=True)
    # Deterministic Pass/Fail/Conditional mappings only (import Decision 5) -
    # never set from free-form/uncertain source text, so unlike
    # current_rank/testing_for_rank this has no separate admin-resolution
    # service and is immutable alongside the other source-derived fields.
    outcome = models.CharField(  # noqa: DJ001
        max_length=16,
        choices=LegacyOutcome.choices,
        null=True,
        blank=True,
    )
    attendance_status = models.CharField(
        max_length=16,
        choices=LegacyAttendance.choices,
        default=LegacyAttendance.UNKNOWN,
    )

    comments = models.TextField(blank=True)
    admin_note = models.TextField(blank=True)

    is_void = models.BooleanField(default=False)
    void_reason = models.TextField(blank=True)
    voided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="voided_legacy_grading_records",
    )
    voided_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = LegacyGradingRecordQuerySet.as_manager()

    class Meta:
        ordering = ["-cycle_year", "-cycle_month", "source_sheet", "source_locator"]
        permissions = [
            (
                "can_reconcile_imported_history",
                "Can reconcile imported historical grading records",
            ),
        ]
        indexes = [
            models.Index(fields=["student"], name="legacy_record_student_idx"),
            models.Index(
                fields=["cycle_year", "cycle_month"],
                name="legacy_record_cycle_idx",
            ),
            models.Index(
                fields=["record_kind", "is_void"],
                name="legacy_record_kind_void_idx",
            ),
            models.Index(
                fields=["outcome", "is_void"],
                name="legacy_record_outcome_void_idx",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["source_batch", "source_locator"],
                name="legacy_record_unique_locator_per_batch",
            ),
            models.CheckConstraint(
                condition=~Q(source_sheet=""),
                name="legacy_record_source_sheet_not_blank",
            ),
            models.CheckConstraint(
                condition=~Q(source_locator=""),
                name="legacy_record_source_locator_not_blank",
            ),
            models.CheckConstraint(
                condition=~Q(source_name=""),
                name="legacy_record_source_name_not_blank",
            ),
            models.CheckConstraint(
                condition=Q(is_void=False)
                | (
                    Q(is_void=True)
                    & ~Q(void_reason="")
                    & Q(voided_by__isnull=False)
                    & Q(voided_at__isnull=False)
                ),
                name="legacy_record_void_fields_complete",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.source_sheet}!{self.source_locator}: {self.source_name}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.full_clean()
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        raise ValidationError(
            {
                "legacy_grading_record": [
                    "Legacy grading records cannot be deleted - void instead.",
                ],
            },
        )

    def clean(self) -> None:
        super().clean()
        self.source_sheet = (self.source_sheet or "").strip()
        self.source_section = (self.source_section or "").strip()
        self.source_locator = (self.source_locator or "").strip()
        self.source_name = (self.source_name or "").strip()

        errors: dict[str, list[str]] = {}
        if not self.source_sheet:
            errors["source_sheet"] = ["Source sheet is required."]
        if not self.source_locator:
            errors["source_locator"] = ["Source locator is required."]
        if not self.source_name:
            errors["source_name"] = ["Source name is required."]
        if self.is_void and not self.void_reason.strip():
            errors["void_reason"] = ["A reason is required to void a record."]

        if not self._state.adding and self.pk is not None:
            immutable_field_names = [
                field.attname
                for field in self._meta.fields
                if field.attname not in self._MUTABLE_FIELD_NAMES
            ]
            previous = (
                LegacyGradingRecord.objects.filter(pk=self.pk)
                .values(*immutable_field_names)
                .first()
            )
            if previous is not None:
                changed_fields = [
                    field
                    for field, value in previous.items()
                    if getattr(self, field) != value
                ]
                if changed_fields:
                    errors["non_field_errors"] = [
                        "Source fields are immutable after import: "
                        + ", ".join(sorted(changed_fields))
                        + ".",
                    ]

        if errors:
            raise ValidationError(errors)
