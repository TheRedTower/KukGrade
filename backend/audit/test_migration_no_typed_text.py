"""The migration that cleared typed text from events already written
(audit.0006_no_typed_text), run on events in the shapes written before it."""

from __future__ import annotations

import json
from typing import Any

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from audit.details import RankNames, event_details
from audit.models import AuditEvent

BEFORE = [("audit", "0005_kept_records_in_the_database")]
AFTER = [("audit", "0006_no_typed_text")]
TYPED = "Zeta-wrote-this"

OLD_EVENTS: dict[str, tuple[str, str, dict[str, Any]]] = {
    "notes": (
        "ASSESSMENT_UPDATED",
        "Assessment notes for student 123-4-001 updated.",
        {"before": {"notes": ""}, "after": {"notes": f"{TYPED} overall"}},
    ),
    "proposal": (
        "OUTCOME_PROPOSED",
        "Outcome proposed as Fail, revising an earlier Pass.",
        {
            "before": {"proposed_outcome": "PASS", "proposal_notes": f"{TYPED} 1"},
            "after": {"proposed_outcome": "FAIL", "proposal_notes": f"{TYPED} 2"},
        },
    ),
    "cancelled": (
        "SESSION_TRANSITIONED",
        "Grading session moved from Locked to Cancelled.",
        {
            "before": {"status": "LOCKED"},
            "after": {"status": "CANCELLED", "cancellation_reason": TYPED},
        },
    ),
    "withdrawal": (
        "CANDIDATE_WITHDRAWN",
        "Student 123-4-001 withdrawn from a locked session (Other).",
        {
            "reason": "OTHER",
            "note": f"{TYPED} withdrawal",
            "discarded_proposal": {
                "proposed_outcome": "PASS",
                "proposal_notes": f"{TYPED} 3",
            },
        },
    ),
    "decision": (
        "OUTCOME_FINALISED",
        "Final decision Conditional recorded for student 123-4-001.",
        {"final_outcome": "CONDITIONAL", "conditional_requirements": TYPED},
    ),
    "void": (
        "LEGACY_GRADING_VOIDED",
        f"Historical grading record voided with its whole import: {TYPED}\nmore",
        {"reason": TYPED, "whole_import": True},
    ),
    "untouched": (
        "SESSION_TRANSITIONED",
        "Grading session moved from Draft to Open.",
        {"before": {"status": "DRAFT"}, "after": {"status": "OPEN"}},
    ),
}


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_events_already_written_keep_no_typed_text() -> None:
    executor = MigrationExecutor(connection)
    executor.migrate(BEFORE)
    event_model = executor.loader.project_state(BEFORE).apps.get_model(
        "audit", "AuditEvent"
    )
    ids = {
        name: event_model.objects.create(
            action=action,
            entity_type="GradingSession",
            entity_id="1",
            summary=summary,
            metadata=metadata,
        ).pk
        for name, (action, summary, metadata) in OLD_EVENTS.items()
    }

    # Past the database's refusal to change an event: kukgrade.kept's bypass.
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate(AFTER)

    events = {name: AuditEvent.objects.get(pk=pk) for name, pk in ids.items()}
    assert not any(
        TYPED in f"{event.summary} {json.dumps(event.metadata)}"
        for event in events.values()
    )
    assert events["notes"].metadata == {
        "before": {},
        "after": {},
        "changed_fields": ["notes"],
    }
    assert events["proposal"].metadata["changed_fields"] == ["proposal_notes"]
    assert events["proposal"].metadata["after"] == {"proposed_outcome": "FAIL"}
    assert events["cancelled"].metadata["changed_fields"] == ["cancellation_reason"]
    assert events["withdrawal"].metadata == {
        "reason": "OTHER",
        "discarded_proposal": {"proposed_outcome": "PASS"},
        "note_given": True,
    }
    assert events["decision"].metadata == {"final_outcome": "CONDITIONAL"}
    assert events["void"].summary == (
        "Historical grading record voided with its whole import."
    )
    assert events["void"].metadata == {"whole_import": True}
    assert events["untouched"].metadata == OLD_EVENTS["untouched"][2]
    assert {
        row["label"]: row["value"]
        for row in event_details(events["notes"], RankNames.read())
    } == {"Notes": "Changed"}
