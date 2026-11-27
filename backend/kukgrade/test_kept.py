"""Kept records: refused in the database as in the ORM, and passed only by the
named bypass, from the modules allowed to use it."""

from __future__ import annotations

import ast
from collections.abc import Iterator
from pathlib import Path

import pytest
from django.db import DatabaseError, connection, transaction

from audit.models import AuditEvent
from gradings.assessment_services import add_item_comment
from gradings.models import (
    AssessmentItemComment,
    AssessmentItemResultChange,
    CandidateAssessment,
    CandidateOutcome,
    GradingSession,
    LegacyGradingRecord,
    Promotion,
)
from gradings.outcome_services import promote_candidate
from gradings.testing import (
    assessment,
    candidate,
    finalised_outcome,
    grading_session,
    locked_completed_candidate,
    locked_session_with_undecided_candidate,
    promoter,
    user,
)
from kukgrade import kept

pytestmark = pytest.mark.django_db

BACKEND = Path(__file__).resolve().parent.parent

# Where a kept record may be changed or removed on purpose, and why.
ALLOWED = {
    "audit/redaction.py": "a student's details erased on request",
    "demo/reset.py": "the demo club emptied and built again",
    "demo/seed.py": "the demo's past gradings dated as they were",
    "gradings/assessment_services.py": "a deleted assessment's proposal",
    "gradings/legacy_person_services.py": "who an imported record is about",
    "gradings/services.py": "a deleted session's proposals",
}
BYPASSES = {"bypass_update", "bypass_delete", "bypassing"}


def _app_modules() -> Iterator[Path]:
    for path in BACKEND.rglob("*.py"):
        relative = path.relative_to(BACKEND)
        parts = relative.parts
        if parts[0] in {".venv", "node_modules"} or "migrations" in parts:
            continue
        if path.name.startswith("test") or path.name in {"testing.py", "conftest.py"}:
            continue
        yield path


# SQL that turns triggers off, written out instead of through kept.
TRIGGERS_OFF = ("DISABLE TRIGGER", "session_replication_role", "pgtrigger.ignore")


def _dotted(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_dotted(node.value)}.{node.attr}"
    return ""


def _calls(path: Path) -> Iterator[str]:
    """Every way past the guard a module uses: kept's bypasses (under any
    name the module gives kept), the base QuerySet's update and delete,
    pgtrigger's own ignore, and SQL that turns triggers off."""
    tree = ast.parse(path.read_text())
    kept_names = {"kukgrade.kept"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if node.module == "kukgrade" and alias.name == "kept":
                    kept_names.add(alias.asname or "kept")
                if node.module == "kukgrade.kept" and alias.name in BYPASSES:
                    yield "kept (imported by name)"
                if node.module == "pgtrigger" and alias.name == "ignore":
                    yield "pgtrigger.ignore"
                if alias.name == "QuerySet" and alias.asname:
                    yield "QuerySet (renamed)"
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "kukgrade.kept" and alias.asname:
                    kept_names.add(alias.asname)
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if any(words in node.value for words in TRIGGERS_OFF):
                yield "triggers off in SQL"
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        owner = _dotted(node.func.value)
        if owner in kept_names and node.func.attr in BYPASSES:
            yield f"kept.{node.func.attr}"
        elif owner == "pgtrigger" and node.func.attr == "ignore":
            yield "pgtrigger.ignore"
        elif owner.split(".")[-1] == "QuerySet" and node.func.attr in {
            "update",
            "delete",
        }:
            yield f"QuerySet.{node.func.attr}"


def test_only_the_allowed_modules_pass_the_kept_records_guard() -> None:
    found: dict[str, set[str]] = {}
    for path in _app_modules():
        relative = path.relative_to(BACKEND).as_posix()
        if relative == "kukgrade/kept.py":
            continue
        calls = set(_calls(path))
        if calls:
            found[relative] = calls

    assert set(found) == set(ALLOWED), found
    # The base QuerySet's update and delete and pgtrigger's ignore pass the
    # guard silently: only kept's helpers, called as kept.<helper>, which say
    # why and are what this test reads.
    unnamed = {
        "QuerySet.update",
        "QuerySet.delete",
        "QuerySet (renamed)",
        "pgtrigger.ignore",
        "kept (imported by name)",
        "triggers off in SQL",
    }
    silent = {where: calls & unnamed for where, calls in found.items()}
    assert {where: calls for where, calls in silent.items() if calls} == {}


def test_a_bypass_says_why() -> None:
    with pytest.raises(ValueError, match="Say why"), kept.bypassing(reason=" "):
        pass


def test_no_bypass_removes_a_row_that_goes_with_its_parent() -> None:
    with pytest.raises(ValueError, match="goes only with"):
        kept.bypass_delete(AssessmentItemComment.objects.all(), reason="Tidying.")


# --------------------------------------------------------------------------
# The database refuses what the ORM refuses
# --------------------------------------------------------------------------


def _sql(statement: str, *params: int, check_now: bool = False) -> None:
    """Run raw SQL in its own savepoint, as psql or a hand-written migration
    would; `check_now` runs the checks the commit would run, there and then."""
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute(statement, params)
        if check_now:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")


def _refused(statement: str, *params: int) -> None:
    # Refused, the savepoint rolls back, the checks' timing with it.
    with pytest.raises(DatabaseError, match="kept|pgtrigger"):
        _sql(statement, *params, check_now=True)


def test_an_audit_event_is_never_changed_or_removed() -> None:
    finalised_outcome(locked_completed_candidate()[0])
    event = AuditEvent.objects.first()
    assert event is not None

    _refused("UPDATE audit_auditevent SET summary = 'x' WHERE id = %s", event.pk)
    _refused("DELETE FROM audit_auditevent WHERE id = %s", event.pk)

    with kept.bypassing(AuditEvent, reason="Erasing a student's details."):
        _sql("UPDATE audit_auditevent SET summary = 'x' WHERE id = %s", event.pk)
    event.refresh_from_db()
    assert event.summary == "x"


def test_a_final_decision_is_kept_and_a_proposal_is_not() -> None:
    decided = finalised_outcome(locked_completed_candidate()[0])
    _session, undecided = locked_session_with_undecided_candidate()
    from gradings.outcome_services import propose_for_candidate

    proposal = propose_for_candidate(undecided, "PASS", "", user("kept-p@example.com"))
    table = CandidateOutcome._meta.db_table

    _refused(f"UPDATE {table} SET decision_notes = 'x' WHERE id = %s", decided.pk)  # noqa: S608
    # Who decided and who proposed, as they were titled then.
    for column in ("decided_by_title", "proposed_by_title"):
        _refused(f"UPDATE {table} SET {column} = 'x' WHERE id = %s", decided.pk)  # noqa: S608
    _refused(f"DELETE FROM {table} WHERE id = %s", decided.pk)  # noqa: S608
    # What is not the decision itself may change.
    _sql(f"UPDATE {table} SET updated_at = now() WHERE id = %s", decided.pk)  # noqa: S608
    _sql(f"UPDATE {table} SET proposal_notes = 'y' WHERE id = %s", proposal.pk)  # noqa: S608
    _sql(f"DELETE FROM {table} WHERE id = %s", proposal.pk)  # noqa: S608


def test_a_promotion_is_never_changed_or_removed() -> None:
    outcome = finalised_outcome(locked_completed_candidate()[0])
    promotion = promote_candidate(outcome, promoter("kept-promoter@example.com"))
    table = Promotion._meta.db_table

    _refused(f"UPDATE {table} SET notes = 'x' WHERE id = %s", promotion.pk)  # noqa: S608
    _refused(f"DELETE FROM {table} WHERE id = %s", promotion.pk)  # noqa: S608
    _sql(f"UPDATE {table} SET updated_at = now() WHERE id = %s", promotion.pk)  # noqa: S608


def test_a_comment_and_a_mark_change_go_only_with_their_item() -> None:
    from gradings.assessment_services import update_candidate_assessment_item

    prepared = assessment(
        candidate=candidate(session=grading_session(status=GradingSession.Status.OPEN)),
        status=CandidateAssessment.Status.IN_PROGRESS,
    )
    item = prepared.items.first()
    assert item is not None
    marker = user("kept-marker@example.com")
    comment = add_item_comment(item, "Strong stances.", marker)
    update_candidate_assessment_item(item, result="MET", assessor=marker)
    change = AssessmentItemResultChange.objects.get(item=item)

    for table, column, row in (
        (AssessmentItemComment._meta.db_table, "body", comment.pk),
        (AssessmentItemResultChange._meta.db_table, "reason", change.pk),
    ):
        _refused(f"UPDATE {table} SET {column} = 'x' WHERE id = %s", row)  # noqa: S608
        _refused(f"DELETE FROM {table} WHERE id = %s", row)  # noqa: S608

    # With the assessment they belong to, they go (Django's cascade).
    with transaction.atomic():
        CandidateAssessment.objects.filter(pk=prepared.pk).delete()
        with connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
    assert not AssessmentItemComment.objects.filter(pk=comment.pk).exists()


def test_what_the_workbook_said_is_kept_and_a_decision_is_not() -> None:
    from data_imports.testing import legacy_record

    record = legacy_record()
    table = LegacyGradingRecord._meta.db_table

    _refused(f"UPDATE {table} SET source_name = 'x' WHERE id = %s", record.pk)  # noqa: S608
    _refused(f"DELETE FROM {table} WHERE id = %s", record.pk)  # noqa: S608
    # The columns set after import (decisions, a void, bookkeeping) may change.
    _sql(f"UPDATE {table} SET updated_at = now() WHERE id = %s", record.pk)  # noqa: S608


def test_every_kept_model_has_its_database_refusal() -> None:
    from django.apps import apps

    for model in apps.get_models():
        if issubclass(model, kept.KeptModel):
            names = {trigger.name for trigger in model._meta.triggers}  # type: ignore[attr-defined]
            assert kept.NO_UPDATE in names, model.__name__
            assert names & {kept.NO_DELETE, kept.GOES_WITH_PARENT}, model.__name__


def test_the_bypass_passes_only_the_model_named() -> None:
    outcome = finalised_outcome(locked_completed_candidate()[0])
    promotion = promote_candidate(outcome, promoter("kept-only@example.com"))

    with kept.bypassing(AuditEvent, reason="Erasing a student's details."):
        _refused(
            f"UPDATE {Promotion._meta.db_table} SET notes = 'x' WHERE id = %s",  # noqa: S608
            promotion.pk,
        )
