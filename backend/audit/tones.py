"""How an event reads at a glance: a badge tone and the outcome it carries.

An event's tone comes from its action and its structured outcome, never from
words in the prose summary, which once labelled a password reset or a failed
grading "Approved". Actions with nothing to say stay neutral. The outcome's
name is read from the gradings app by name, so the log keeps no import of it.
"""

from __future__ import annotations

from typing import Any

from django.apps import apps
from django.db import models

from audit.models import AuditAction, AuditEvent


class Tone(models.TextChoices):
    SUCCESS = "success", "Done"
    WARNING = "warning", "Needs a look"
    INFO = "info", "Under way"
    NEUTRAL = "neutral", "Neither"


_TONES: dict[str, Tone] = {
    AuditAction.PROMOTION_RECORDED: Tone.SUCCESS,
    AuditAction.OUTCOME_PROPOSED: Tone.INFO,
    AuditAction.ASSESSMENT_STARTED: Tone.INFO,
    AuditAction.CANDIDATE_WITHDRAWN: Tone.WARNING,
}


def _text(metadata: Any, *path: str) -> str | None:
    value = metadata
    for key in path:
        value = value.get(key) if isinstance(value, dict) else None
    return value if isinstance(value, str) else None


def outcome_code(event: AuditEvent) -> str | None:
    """The grading outcome an outcome event records, if it holds one."""
    if event.action == AuditAction.OUTCOME_FINALISED:
        return _text(event.metadata, "final_outcome")
    if event.action == AuditAction.OUTCOME_PROPOSED:
        return _text(event.metadata, "after", "proposed_outcome")
    return None


def tone(event: AuditEvent) -> Tone:
    if event.action == AuditAction.OUTCOME_FINALISED:
        return Tone.SUCCESS if outcome_code(event) == "PASS" else Tone.WARNING
    return _TONES.get(event.action, Tone.NEUTRAL)


def outcome_display(event: AuditEvent) -> str | None:
    """The outcome's name as every screen shows it, or None."""
    code = outcome_code(event)
    if code is None:
        return None
    field = apps.get_model("gradings", "CandidateOutcome")._meta.get_field(
        "final_outcome",
    )
    labels: dict[str, str] = dict(field.choices or ())
    return labels.get(code, code)
