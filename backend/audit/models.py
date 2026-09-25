"""An append-only record of who did what.

Deliberately its own app: the log must not depend on the apps it records, and
an audit record has to outlive the schema it describes. That is also why
`entity_type` is a plain string rather than a ContentType foreign key - a
ContentType reference breaks exactly when a model is renamed or removed, which
is when the history matters most.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

if TYPE_CHECKING:
    from accounts.models import User

IMMUTABLE_MESSAGE = "Audit events are append-only and cannot be changed or deleted."


class AuditAction(models.TextChoices):
    SESSION_CREATED = "SESSION_CREATED", "Grading session created"
    SESSION_TRANSITIONED = "SESSION_TRANSITIONED", "Grading session transitioned"
    SESSION_DELETED = "SESSION_DELETED", "Grading session deleted"

    CANDIDATE_REGISTERED = "CANDIDATE_REGISTERED", "Candidate registered"
    CANDIDATE_UPDATED = "CANDIDATE_UPDATED", "Candidate updated"
    CANDIDATE_WITHDRAWN = "CANDIDATE_WITHDRAWN", "Candidate withdrawn"
    CANDIDATE_DELETED = "CANDIDATE_DELETED", "Candidate deleted"

    ASSESSMENT_GENERATED = "ASSESSMENT_GENERATED", "Assessment generated"
    ASSESSMENT_STARTED = "ASSESSMENT_STARTED", "Assessment started"
    ASSESSMENT_COMPLETED = "ASSESSMENT_COMPLETED", "Assessment completed"
    ASSESSMENT_REOPENED = "ASSESSMENT_REOPENED", "Assessment reopened"
    ASSESSMENT_DELETED = "ASSESSMENT_DELETED", "Assessment deleted"
    ITEM_RESULT_RECORDED = "ITEM_RESULT_RECORDED", "Assessment item result recorded"

    OUTCOME_CREATED = "OUTCOME_CREATED", "Outcome created"
    OUTCOME_PROPOSED = "OUTCOME_PROPOSED", "Outcome proposed"
    OUTCOME_FINALISED = "OUTCOME_FINALISED", "Outcome finalised"

    PROMOTION_RECORDED = "PROMOTION_RECORDED", "Promotion recorded"

    STUDENT_CREATED = "STUDENT_CREATED", "Student created"
    STUDENT_UPDATED = "STUDENT_UPDATED", "Student updated"
    STUDENT_STATUS_CHANGED = "STUDENT_STATUS_CHANGED", "Student status changed"
    STUDENT_DELETED = "STUDENT_DELETED", "Student deleted"

    USER_CREATED = "USER_CREATED", "User created"
    USER_UPDATED = "USER_UPDATED", "User updated"
    USER_AUTHORITY_CHANGED = "USER_AUTHORITY_CHANGED", "User authority changed"
    USER_DELETED = "USER_DELETED", "User deleted"

    IMPORT_BATCH_COMMITTED = "IMPORT_BATCH_COMMITTED", "Import batch committed"
    IMPORT_BATCH_CANCELLED = "IMPORT_BATCH_CANCELLED", "Import batch cancelled"
    IMPORT_BATCH_EXPIRED = "IMPORT_BATCH_EXPIRED", "Import batch expired"

    LEGACY_GRADING_LINKED = "LEGACY_GRADING_LINKED", "Legacy grading record linked"
    LEGACY_GRADING_UNLINKED = (
        "LEGACY_GRADING_UNLINKED",
        "Legacy grading record unlinked",
    )
    LEGACY_GRADING_RANK_RESOLVED = (
        "LEGACY_GRADING_RANK_RESOLVED",
        "Legacy grading record rank resolved",
    )
    LEGACY_GRADING_VOIDED = "LEGACY_GRADING_VOIDED", "Legacy grading record voided"


# Logistics - who runs the roster - is an administrator concern, the same
# boundary the Users API itself draws. A Master or a holder of
# can_view_grading_audit_log who cannot open /api/users/ must not read who
# was created, edited, or granted authority through the audit log instead:
# the same information through a side door. See AuditEventQuerySet.visible_to.
USER_MANAGEMENT_ACTIONS: tuple[str, ...] = (
    AuditAction.USER_CREATED,
    AuditAction.USER_UPDATED,
    AuditAction.USER_AUTHORITY_CHANGED,
    AuditAction.USER_DELETED,
)


class AuditEventQuerySet(models.QuerySet["AuditEvent"]):
    def visible_to(self, user: User) -> AuditEventQuerySet:
        """The events `user` may read, once permitted to read the log at all
        (accounts.permissions.can_view_audit_log). Shared by the API and
        Django admin so the two cannot disagree."""
        if user.has_perm("accounts.view_user"):
            return self
        return self.exclude(action__in=USER_MANAGEMENT_ACTIONS)

    def delete(self) -> tuple[int, dict[str, int]]:
        raise ValidationError({"audit": [IMMUTABLE_MESSAGE]})

    def update(self, **kwargs: Any) -> int:
        raise ValidationError({"audit": [IMMUTABLE_MESSAGE]})


class AuditEvent(models.Model):
    # PROTECT so that deleting a user can never erase who did something.
    # Null only for actions with no human actor.
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="audit_events",
        null=True,
        blank=True,
    )
    # Who acted, as they were at the time. `actor` can later be reassigned to
    # the deleted-user placeholder (accounts.services.delete_platform_user);
    # these copies are what keep the trail attributable to the real person.
    actor_email = models.EmailField(blank=True)
    actor_name = models.CharField(max_length=301, blank=True)
    action = models.CharField(max_length=64, choices=AuditAction.choices)
    entity_type = models.CharField(max_length=64)
    entity_id = models.CharField(max_length=64)
    occurred_at = models.DateTimeField(auto_now_add=True)
    summary = models.TextField()
    # {"before": {...}, "after": {...}} for a revision; {} otherwise.
    metadata = models.JSONField(default=dict, blank=True)

    objects = AuditEventQuerySet.as_manager()

    class Meta:
        ordering = ["-occurred_at", "-pk"]
        indexes = [
            models.Index(
                fields=["entity_type", "entity_id", "-occurred_at"],
                name="audit_entity_idx",
            ),
            models.Index(fields=["-occurred_at"], name="audit_occurred_idx"),
            models.Index(fields=["action", "-occurred_at"], name="audit_action_idx"),
            models.Index(fields=["actor", "-occurred_at"], name="audit_actor_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(entity_type=""),
                name="audit_entity_type_not_blank",
            ),
            models.CheckConstraint(
                condition=~models.Q(entity_id=""),
                name="audit_entity_id_not_blank",
            ),
            models.CheckConstraint(
                condition=~models.Q(summary=""),
                name="audit_summary_not_blank",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.action} {self.entity_type}#{self.entity_id}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        # `_state.adding` rather than a pk check: the pk is typed non-optional,
        # so `pk is not None` is always true and would make this a no-op.
        if not self._state.adding:
            raise ValidationError({"audit": [IMMUTABLE_MESSAGE]})
        self.full_clean()
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        raise ValidationError({"audit": [IMMUTABLE_MESSAGE]})
