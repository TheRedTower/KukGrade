"""What an audit event's metadata says, in words a person reads.

The metadata is kept as each action wrote it, with stored codes and ids; the
audit screen shows it as a list of label and value pairs built here, so no
screen shows a code ("DRAFT"), a key ("after_lock") or an id.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from django.apps import apps
from django.utils import dateformat, timezone

from accounts.permissions import AUTHORITY_WORDS
from audit.models import AuditAction, AuditEntity, AuditEvent

# What each key is called on screen. Keys inside `before` and `after` are the
# record's fields, named the same way.
LABELS: dict[str, str] = {
    "status": "Status",
    "cancellation_reason": "Reason for cancelling",
    "title": "Title",
    "grading_date": "Grading date",
    "location": "Location",
    "notes": "Notes",
    "email": "Email",
    "first_name": "First name",
    "last_name": "Last name",
    "date_of_birth": "Date of birth",
    "name": "Name",
    "role": "Role",
    "rank": "Rank",
    "is_active": "Can sign in",
    "is_staff": "Admin site access",
    "is_superuser": "Full admin site access",
    "superuser": "Full admin site access",
    "temporary_password_expires_at": "Temporary password expires",
    "kept_for_their_records": "Kept for what they recorded",
    "kept_for_their_history": "Kept for their grading history",
    "testing_for_rank": "Testing for",
    "withdrawal_reason": "Reason for withdrawing",
    "withdrawal_note": "Withdrawal note",
    "note": "Note",
    "reason": "Reason",
    "discarded_proposal": "Proposal discarded",
    "cascaded_candidates": "Candidates removed",
    "candidates": "Candidates",
    "age_band": "Age band",
    "rebanded": "Age band moved",
    "item_count": "Requirements",
    "result": "Mark",
    "after_lock": "After the session locked",
    "had_outcome": "Had an outcome",
    "proposed_outcome": "Proposed outcome",
    "proposal_notes": "Proposal notes",
    "final_outcome": "Final decision",
    "overrode_proposal": "Overrode the proposal",
    "conditional_requirements": "Conditions",
    "from_rank": "From",
    "to_rank": "To",
    "effective_date": "Effective date",
    "wksa_id": "WKSA ID",
    "previous_wksa_ids": "Earlier WKSA IDs",
    "current_rank": "Rank",
    "field": "Which rank",
    "source_text": "Written in the file",
    "resolved_rank_code": "Matched to",
    "whole_import": "Whole import voided",
    "kind": "Import type",
    "record_count": "Records created",
    "events_changed": "Events changed",
    **{key: words[0] for key, words in AUTHORITY_WORDS.items()},
}

# Keys that are not shown: ids that tie an event to its records (the history
# links use them), a file fingerprint, and the list `before` and `after`
# already show.
HIDDEN: frozenset[str] = frozenset(
    {
        "student_id",
        "candidate_id",
        "session_id",
        "batch_id",
        "legacy_record_id",
        "previous_student_id",
        "change",
        "comment",
        "assessment",
        "outcome",
        "proposed_by",
        "id",
        "session",
        "student",
        "sha256_prefix",
        "changed_fields",
        # Who a downloaded file holds, for the histories; `candidates` names
        # them by WKSA ID.
        "candidate_ids",
        "student_ids",
    },
)

# Personal details a student event records only as having changed.
_CHANGED_ONLY = ("first_name", "last_name", "date_of_birth")

# Where a stored code's name is kept: (app, model, field), read by name so the
# log keeps no import of the apps it records.
_Field = tuple[str, str, str]

_STATUSES: dict[str, _Field] = {
    AuditEntity.GRADING_SESSION: ("gradings", "GradingSession", "status"),
    AuditEntity.GRADING_CANDIDATE: ("gradings", "GradingCandidate", "status"),
    AuditEntity.CANDIDATE_ASSESSMENT: ("gradings", "CandidateAssessment", "status"),
    AuditEntity.STUDENT: ("students", "Student", "status"),
}

_WITHDRAWAL: _Field = ("gradings", "GradingCandidate", "withdrawal_reason")

_CHOICES: dict[str, _Field] = {
    "result": ("gradings", "CandidateAssessmentItem", "result"),
    "proposed_outcome": ("gradings", "CandidateOutcome", "final_outcome"),
    "final_outcome": ("gradings", "CandidateOutcome", "final_outcome"),
    "role": ("accounts", "User", "role"),
    "age_band": ("gradings", "GradingCandidate", "age_band"),
    "withdrawal_reason": _WITHDRAWAL,
    "kind": ("data_imports", "ImportBatch", "kind"),
}

_RANK_CODES = frozenset(
    {"from_rank", "to_rank", "current_rank", "resolved_rank_code", "rank"},
)
_DATES = frozenset({"grading_date", "effective_date"})
_TIMES = frozenset({"temporary_password_expires_at"})


@dataclass
class RankNames:
    """Rank names by code and by id, read once for a page of events."""

    by_code: dict[str, str] = field(default_factory=dict)
    by_id: dict[str, str] = field(default_factory=dict)

    @classmethod
    def read(cls) -> RankNames:
        names = cls()
        ranks = apps.get_model("ranks", "Rank").objects
        for pk, code, name in ranks.values_list("pk", "code", "name"):
            names.by_code[code] = name
            names.by_id[str(pk)] = name
        return names


def _label(key: str) -> str:
    return LABELS.get(key) or key.replace("_", " ").capitalize()


def _choice(where: _Field, value: str) -> str:
    app, model, name = where
    choices = apps.get_model(app, model)._meta.get_field(name).choices or ()
    return str(dict(choices).get(value, value))


def _rank_field(value: str) -> str:
    """Which of a historical record's two ranks: its field's own name."""
    record = apps.get_model("gradings", "LegacyGradingRecord")
    try:
        return str(record._meta.get_field(value).verbose_name).capitalize()
    except LookupError:
        return value


class _Words:
    def __init__(self, event: AuditEvent, ranks: RankNames) -> None:
        self.event = event
        self.ranks = ranks

    def value(self, key: str, value: Any) -> str:
        if _empty(value):
            return "none"
        if isinstance(value, bool):
            return "Yes" if value else "No"
        if key == "status" and self.event.entity_type in _STATUSES:
            return _choice(_STATUSES[self.event.entity_type], str(value))
        if key == "reason" and self.event.action == AuditAction.CANDIDATE_WITHDRAWN:
            return _choice(_WITHDRAWAL, str(value))
        if key in _CHOICES:
            return _choice(_CHOICES[key], str(value))
        if key in _RANK_CODES:
            return self.ranks.by_code.get(str(value), str(value))
        if key == "testing_for_rank":
            return self.ranks.by_id.get(str(value), str(value))
        if key == "field":
            return _rank_field(str(value))
        if key in _DATES:
            return _date(str(value))
        if key in _TIMES:
            return _time(str(value))
        if key == "cascaded_candidates":
            return ", ".join(str(c.get("student_wksa_id", "")) for c in value)
        if key == "rebanded":
            return ", ".join(
                f"{_choice(_CHOICES['age_band'], str(c.get('from')))} to "
                f"{_choice(_CHOICES['age_band'], str(c.get('to')))}"
                for c in value
            )
        if isinstance(value, list):
            return ", ".join(str(item) for item in value)
        return str(value)


def _date(value: str) -> str:
    try:
        return dateformat.format(date.fromisoformat(value), "j M Y")
    except ValueError:
        return value


def _time(value: str) -> str:
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return value
    if timezone.is_aware(moment):
        moment = timezone.localtime(moment)
    return dateformat.format(moment, "j M Y, H:i")


def event_details(event: AuditEvent, ranks: RankNames) -> list[dict[str, str]]:
    """The event's metadata as label and value pairs, in the order written."""
    words = _Words(event, ranks)
    metadata: Mapping[str, Any] = event.metadata or {}
    details: list[dict[str, str]] = []

    def add(key: str, text: str) -> None:
        details.append({"label": _label(key), "value": text})

    changes_shown = False
    for key, value in metadata.items():
        if key in HIDDEN:
            continue
        if key in ("before", "after"):
            # Shown once, field by field, where the first of the two comes.
            if not changes_shown:
                _changes(metadata.get("before"), metadata.get("after"), words, add)
                changes_shown = True
            continue
        if _empty(value):
            continue
        add(key, words.value(key, value))
    for key in metadata.get("changed_fields") or []:
        if key in _CHANGED_ONLY:
            add(key, "Changed")
    return details


def _changes(
    before: Any,
    after: Any,
    words: _Words,
    add: Callable[[str, str], None],
) -> None:
    """Each field `before` and `after` hold that differs, as "was to now"."""
    old = before if isinstance(before, dict) else {}
    new = after if isinstance(after, dict) else {}
    for key in [*new, *(k for k in old if k not in new)]:
        if key in HIDDEN or old.get(key) == new.get(key):
            continue
        was, now = old.get(key), new.get(key)
        if _empty(now) and key not in old:
            continue
        # Set for the first time: what it is now says it all.
        shown = words.value(key, now)
        add(key, shown if _empty(was) else f"{words.value(key, was)} to {shown}")


def _empty(value: Any) -> bool:
    return value is None or value == "" or value == []
