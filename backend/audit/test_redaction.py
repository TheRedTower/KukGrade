"""Erasing a student's details from events written before the log dropped them."""

from __future__ import annotations

from io import StringIO

import pytest
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError

from audit.models import AuditAction, AuditEntity, AuditEvent
from audit.redaction import NAME_ERASED, redact_student_details

pytestmark = pytest.mark.django_db

SNAPSHOT = {
    "wksa_id": "123-4-001",
    "first_name": "Zephyrine",
    "last_name": "Quillfeather",
    "date_of_birth": "2014-06-07",
    "current_rank": "WHITE",
    "status": "ACTIVE",
}


def old_event(
    summary: str,
    metadata: dict[str, object] | None = None,
    student_pk: str = "1",
) -> AuditEvent:
    """An event as it was written before: the person's name inside it."""
    return AuditEvent.objects.create(
        action=AuditAction.STUDENT_UPDATED,
        entity_type=AuditEntity.STUDENT,
        entity_id=student_pk,
        summary=summary,
        metadata=metadata or {},
    )


def erase(**overrides: object) -> int:
    details: dict[str, object] = {
        "wksa_id": "123-4-001",
        "first_name": "Zephyrine",
        "last_name": "Quillfeather",
    }
    details.update(overrides)
    return redact_student_details(**details)  # type: ignore[arg-type]


def test_it_removes_the_name_from_summaries_and_keeps_the_id() -> None:
    created = old_event("Student Zephyrine Quillfeather (123-4-001) created.")
    promoted = old_event(
        "Zephyrine Quillfeather (123-4-001) promoted from White to Yellow."
    )
    assessed = old_event(
        "Assessment for Zephyrine Quillfeather (123-4-001) in 'Autumn' "
        "deleted while LOCKED.",
    )

    changed = erase()

    created.refresh_from_db()
    promoted.refresh_from_db()
    assessed.refresh_from_db()
    assert changed == 3
    assert created.summary == "Student 123-4-001 created."
    assert promoted.summary == "student 123-4-001 promoted from White to Yellow."
    assert (
        assessed.summary
        == "Assessment for student 123-4-001 in 'Autumn' deleted while LOCKED."
    )


def test_it_removes_the_personal_fields_of_every_snapshot_of_that_student() -> None:
    event = old_event(
        "Student Zephyrine Quillfeather (123-4-001) updated.",
        {
            "before": SNAPSHOT,
            "after": {**SNAPSHOT, "first_name": "Marigold", "status": "INACTIVE"},
            "rebanded": [],
        },
    )

    erase()

    event.refresh_from_db()
    assert event.metadata["before"] == {
        "wksa_id": "123-4-001",
        "current_rank": "WHITE",
        "status": "ACTIVE",
    }
    # The later name is in the same event and goes too, found by the ID.
    assert event.metadata["after"] == {
        "wksa_id": "123-4-001",
        "current_rank": "WHITE",
        "status": "INACTIVE",
    }
    assert event.metadata["rebanded"] == []


def test_a_name_inside_other_text_is_erased() -> None:
    event = old_event(
        "Something about Zephyrine Quillfeather happened.",
        {"note": "Zephyrine Quillfeather", "other": "2015-01-01"},
    )

    erase()

    event.refresh_from_db()
    assert event.summary == f"Something about {NAME_ERASED} happened."
    assert event.metadata == {"note": NAME_ERASED, "other": "2015-01-01"}


def test_another_student_with_the_same_birthday_keeps_theirs() -> None:
    other = old_event(
        "Student Marigold Thistlewood (123-4-002) created.",
        {
            "before": {
                **SNAPSHOT,
                "wksa_id": "123-4-002",
                "first_name": "Marigold",
                "last_name": "Thistlewood",
            },
        },
    )
    before = other.metadata

    changed = erase()

    other.refresh_from_db()
    assert changed == 0
    assert other.metadata == before


def test_it_leaves_other_students_and_other_details_alone() -> None:
    other = old_event(
        "Student Zephyrine Fairweather (123-4-002) created.",
        {"before": {**SNAPSHOT, "wksa_id": "123-4-002", "last_name": "Fairweather"}},
    )
    unrelated = old_event("Grading session 'Autumn' created for 2027-03-20.")
    before = (other.summary, other.metadata, unrelated.summary)

    changed = erase()

    other.refresh_from_db()
    unrelated.refresh_from_db()
    assert changed == 0
    assert (other.summary, other.metadata, unrelated.summary) == before


def test_a_dry_run_counts_and_changes_nothing() -> None:
    event = old_event("Student Zephyrine Quillfeather (123-4-001) created.")

    changed = erase(dry_run=True)

    event.refresh_from_db()
    assert changed == 1
    assert "Quillfeather" in event.summary
    assert not AuditEvent.objects.filter(action=AuditAction.AUDIT_REDACTED).exists()


def test_the_erasure_is_recorded_without_the_details_and_is_repeatable() -> None:
    old_event("Student Zephyrine Quillfeather (123-4-001) created.")
    old_event("Zephyrine Quillfeather (123-4-001) promoted from White to Yellow.")

    first = erase()
    second = erase()

    [record] = AuditEvent.objects.filter(action=AuditAction.AUDIT_REDACTED)
    assert (first, second) == (2, 0)
    assert record.metadata == {"wksa_id": "123-4-001", "events_changed": 2}
    assert "Zephyrine" not in record.summary + str(record.metadata)


def test_events_stay_immutable_for_everyone_else_afterwards() -> None:
    event = old_event("Student Zephyrine Quillfeather (123-4-001) created.")
    erase()
    event.refresh_from_db()

    event.summary = "changed"
    with pytest.raises(ValidationError):
        event.save()
    with pytest.raises(ValidationError):
        AuditEvent.objects.filter(pk=event.pk).update(summary="changed")
    with pytest.raises(ValidationError):
        event.delete()


def test_the_command_reports_and_checks_its_arguments() -> None:
    old_event("Student Zephyrine Quillfeather (123-4-001) created.")
    arguments = [
        "--wksa-id=123-4-001",
        "--first-name=Zephyrine",
        "--last-name=Quillfeather",
    ]
    out = StringIO()

    call_command("redact_student_audit", *arguments, "--dry-run", stdout=out)
    call_command("redact_student_audit", *arguments, stdout=out)

    assert out.getvalue().splitlines() == [
        "would change 1 audit event(s).",
        "changed 1 audit event(s).",
    ]


def test_a_blank_name_is_refused_and_nothing_is_rewritten() -> None:
    event = old_event("Student Zephyrine Quillfeather (123-4-001) created.")

    for first, last in [("", ""), ("  ", " "), ("", "   ")]:
        with pytest.raises(ValueError, match="needed"):
            erase(first_name=first, last_name=last)
    with pytest.raises(ValueError, match="needed"):
        erase(wksa_id=" ")

    event.refresh_from_db()
    assert event.summary == "Student Zephyrine Quillfeather (123-4-001) created."
    assert not AuditEvent.objects.filter(action=AuditAction.AUDIT_REDACTED).exists()


def test_the_command_refuses_a_blank_name() -> None:
    with pytest.raises(CommandError, match="needed"):
        call_command(
            "redact_student_audit",
            "--wksa-id=123-4-001",
            "--first-name= ",
            "--last-name= ",
        )


def test_a_changed_student_id_is_followed_to_the_older_snapshots() -> None:
    """A student ID replaced by a black belt ID: the older events still go."""
    older = old_event(
        "Student Zephyrine Quillfeather (123-4-001) updated.",
        {"before": SNAPSHOT, "after": {**SNAPSHOT, "status": "INACTIVE"}},
    )
    changed_id = old_event(
        "Student Zephyrine Quillfeather (A-00042) updated.",
        {
            "before": SNAPSHOT,
            "after": {**SNAPSHOT, "wksa_id": "A-00042", "current_rank": "DBN"},
        },
    )
    later = old_event(
        "Student Zephyrine Quillfeather (A-00042) updated.",
        {
            "before": {**SNAPSHOT, "wksa_id": "A-00042", "current_rank": "DBN"},
            "after": {
                **SNAPSHOT,
                "wksa_id": "A-00042",
                "current_rank": "DBN",
                "status": "LEFT",
            },
        },
    )
    # Only the new ID is given, as an operator would after the change.
    erase(wksa_id="A-00042")

    for event in (older, changed_id, later):
        event.refresh_from_db()
        for snapshot in event.metadata.values():
            assert not set(snapshot) & {"first_name", "last_name", "date_of_birth"}
        assert "Quillfeather" not in event.summary
    assert older.summary == "Student 123-4-001 updated."
    assert later.summary == "Student A-00042 updated."


def test_an_id_the_student_never_held_is_not_followed() -> None:
    """A typo ID may be another student's real number; theirs stay untouched."""
    elsewhere = old_event(
        "Student Marigold Thistlewood (123-4-001) created.",
        {
            "before": {
                **SNAPSHOT,
                "first_name": "Marigold",
                "last_name": "Thistlewood",
            }
        },
    )
    before = elsewhere.metadata

    erase(wksa_id="A-00042")

    elsewhere.refresh_from_db()
    assert elsewhere.metadata == before


def reused_typo_id_events() -> tuple[list[AuditEvent], list[AuditEvent]]:
    """Alice's mistyped ID is corrected, then given to Bob."""
    alice_snapshot = {**SNAPSHOT, "wksa_id": "A-00042"}
    alice = [
        old_event(
            "Student Zephyrine Quillfeather (A-00042) updated.",
            {
                "before": alice_snapshot,
                "after": {**alice_snapshot, "wksa_id": "A-00043"},
            },
            student_pk="1",
        ),
        old_event(
            "Student Zephyrine Quillfeather (A-00043) updated.",
            {
                "before": {**alice_snapshot, "wksa_id": "A-00043"},
                "after": {**alice_snapshot, "wksa_id": "A-00043", "status": "LEFT"},
            },
            student_pk="1",
        ),
    ]
    bob_snapshot = {
        **SNAPSHOT,
        "wksa_id": "A-00042",
        "first_name": "Marigold",
        "last_name": "Thistlewood",
    }
    bob = [
        old_event(
            "Student Marigold Thistlewood (A-00042) updated.",
            {"before": bob_snapshot, "after": {**bob_snapshot, "status": "LEFT"}},
            student_pk="2",
        ),
    ]
    return alice, bob


def test_an_id_held_by_two_student_records_is_refused_and_nothing_changes() -> None:
    alice, bob = reused_typo_id_events()
    untouched = [(e.summary, e.metadata) for e in alice + bob]

    with pytest.raises(ValueError, match="more than one student record.*1, 2"):
        erase(wksa_id="A-00042", first_name="Marigold", last_name="Thistlewood")

    for event, was in zip(alice + bob, untouched, strict=True):
        event.refresh_from_db()
        assert (event.summary, event.metadata) == was


def test_the_student_id_picks_one_record_and_leaves_the_other_whole() -> None:
    alice, bob = reused_typo_id_events()

    changed = erase(
        wksa_id="A-00042",
        first_name="Marigold",
        last_name="Thistlewood",
        student_id="2",
    )

    for event in alice:
        event.refresh_from_db()
        assert event.metadata["before"]["first_name"] == "Zephyrine"
        assert event.metadata["before"]["date_of_birth"] == "2014-06-07"
        assert "Quillfeather" in event.summary
    bob[0].refresh_from_db()
    assert changed == 1
    assert "Thistlewood" not in bob[0].summary
    assert not set(bob[0].metadata["before"]) & {
        "first_name",
        "last_name",
        "date_of_birth",
    }


def test_the_command_takes_the_student_id() -> None:
    reused_typo_id_events()
    out = StringIO()

    call_command(
        "redact_student_audit",
        "--wksa-id=A-00042",
        "--first-name=Marigold",
        "--last-name=Thistlewood",
        "--student-id=2",
        "--dry-run",
        stdout=out,
    )
    with pytest.raises(CommandError, match="more than one student record"):
        call_command(
            "redact_student_audit",
            "--wksa-id=A-00042",
            "--first-name=Marigold",
            "--last-name=Thistlewood",
        )

    assert out.getvalue().strip() == "would change 1 audit event(s)."


def test_a_holder_known_only_by_a_new_format_event_is_seen() -> None:
    """Bob arrived after the change: "Student ID created." and no snapshot."""
    alice, _bob = reused_typo_id_events()
    new_bob = old_event("Student A-00042 created.", {}, student_pk="3")
    untouched = [(e.summary, e.metadata) for e in alice]

    with pytest.raises(ValueError, match="more than one student record"):
        erase(wksa_id="A-00042", first_name="Marigold", last_name="Thistlewood")

    for event, was in zip(alice, untouched, strict=True):
        event.refresh_from_db()
        assert (event.summary, event.metadata) == was
    new_bob.refresh_from_db()
    assert new_bob.summary == "Student A-00042 created."


def test_a_current_holder_with_no_events_of_their_own_is_seen() -> None:
    """The ID is on a student today, whose events never named it."""
    from gradings.testing import student

    alice_snapshot = {**SNAPSHOT, "wksa_id": "A-00042"}
    alice_event = old_event(
        "Student Zephyrine Quillfeather (A-00042) updated.",
        {"before": alice_snapshot, "after": {**alice_snapshot, "wksa_id": "A-00043"}},
        student_pk="9990001",
    )
    student(wksa_id="A-00042", first_name="Marigold", last_name="Thistlewood")
    before = alice_event.metadata

    with pytest.raises(ValueError, match="more than one student record"):
        erase(wksa_id="A-00042", first_name="Marigold", last_name="Thistlewood")

    alice_event.refresh_from_db()
    assert alice_event.metadata == before


def test_a_previous_holder_is_seen() -> None:
    from gradings.testing import student
    from students.models import PreviousWksaId

    holder = student(wksa_id="A-00099", first_name="Marigold", last_name="Thistlewood")
    PreviousWksaId.objects.create(student=holder, wksa_id="123-4-001")
    old_event(
        "Student Zephyrine Quillfeather (123-4-001) updated.",
        {"before": SNAPSHOT},
        student_pk="9990002",
    )

    with pytest.raises(ValueError, match="more than one student record"):
        erase()
