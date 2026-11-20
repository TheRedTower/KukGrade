"""What to check in a historical import before it is saved: the exceptions
only, each one decision.

KukGrade reads most of a workbook itself: a rank it can read is taken as read,
and so is an outcome it knows. What is left is listed here, grouped by kind:

- a rank spelling it cannot read, or that the workbook marks with "?";
- an outcome it cannot read;
- names alike on one sheet: one person written twice, or both graded and
  listed as missing;
- a result with no outcome, or a main-table row with a rank missing.

Each can always be kept as written. A rank can be chosen, an outcome read as
Pass, Fail or Conditional, and a row left out. The workbook's text is never
changed: a chosen rank or a reading is the importer's, kept on the import
(ImportConfiguration) and applied when the records are saved. Reading only:
the service that records a decision is
data_imports.services.resolve_legacy_check.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

from django.db import models

from data_imports.ksw_adapter import (
    NO_CURRENT_RANK,
    NO_OUTCOME,
    NO_TESTING_FOR_RANK,
    CanonicalLegacyRow,
    missing_written,
    name_groups,
    names_in_conflict,
    outcome_words,
)
from data_imports.models import ImportBatch, ImportConfiguration, ImportRow
from gradings.models import LegacyOutcome, LegacyRecordKind
from ranks.matching import active_rank_lookup, suggest_rank
from ranks.models import Rank


class CheckKind(models.TextChoices):
    """What a check is about, in the order the list shows them."""

    RANK = "RANK", "Rank to read"
    OUTCOME = "OUTCOME", "Outcome to read"
    WRITTEN_TWICE = "WRITTEN_TWICE", "On one sheet twice"
    MISSING_AND_GRADED = "MISSING_AND_GRADED", "Missing and graded"
    NO_OUTCOME = "NO_OUTCOME", "No outcome"
    NO_RANK = "NO_RANK", "No rank"


class CheckDecision(models.TextChoices):
    RANK = "RANK", "Rank chosen"
    OUTCOME = "OUTCOME", "Outcome read"
    LEAVE_OUT = "LEAVE_OUT", "Row left out"
    KEEP = "KEEP", "Kept as written"


# The decisions each kind of check can take. Keeping as written always can.
DECISIONS: dict[str, tuple[str, ...]] = {
    CheckKind.RANK: (CheckDecision.RANK, CheckDecision.KEEP),
    CheckKind.OUTCOME: (CheckDecision.OUTCOME, CheckDecision.KEEP),
    CheckKind.WRITTEN_TWICE: (CheckDecision.LEAVE_OUT, CheckDecision.KEEP),
    CheckKind.MISSING_AND_GRADED: (CheckDecision.LEAVE_OUT, CheckDecision.KEEP),
    CheckKind.NO_OUTCOME: (CheckDecision.LEAVE_OUT, CheckDecision.KEEP),
    CheckKind.NO_RANK: (CheckDecision.LEAVE_OUT, CheckDecision.KEEP),
}


@dataclass(frozen=True)
class LegacyCheck:
    """One exception and where it stands. `key` names it for a decision and
    is the same each time the list is read while the rows it is about are.
    `rows` are those rows, in file order: those still in the import, and for
    a check about rows, those left out from it too."""

    key: str
    kind: str
    message: str
    rows: list[ImportRow]
    # The spelling a rank or outcome check is about, as first written.
    text: str = ""
    # The rank KukGrade reads a spelling marked "?" as, to offer first.
    suggested_rank_code: str | None = None
    # None while open.
    decision: str | None = None
    rank_code: str | None = None
    outcome: str | None = None
    # A check about rows: the rows it is about (and no others) may be left out.
    rows_to_leave_out: list[int] = field(default_factory=list)

    @property
    def is_open(self) -> bool:
        return self.decision is None


def rank_key(text: str) -> str:
    """The key of the check about a rank spelling, and how a spelling's chosen
    rank is kept (ImportConfiguration.rank_mappings): any case."""
    return f"{CheckKind.RANK}:{text.strip().lower()}"


def outcome_key(text: str) -> str:
    return f"{CheckKind.OUTCOME}:{outcome_words(text)}"


def rank_reader(configuration: ImportConfiguration) -> Callable[[str], Rank | None]:
    """How an import reads each rank spelling: the active rank chosen for it;
    else none when it is kept as written; else the rank KukGrade reads it as,
    unless the workbook marks it with "?". One read of the ranks."""
    ranks = active_rank_lookup()
    by_code = {rank.code: rank for rank in ranks.values()}
    chosen = configuration.rank_mappings
    kept = set(configuration.checks_kept)

    def read(text: str) -> Rank | None:
        cleaned = text.strip()
        if not cleaned:
            return None
        if cleaned.lower() in chosen:
            return by_code.get(chosen[cleaned.lower()])
        if rank_key(cleaned) in kept:
            return None
        suggested, doubtful = suggest_rank(cleaned, ranks)
        return None if doubtful else suggested

    return read


def outcome_reader(
    configuration: ImportConfiguration,
) -> Callable[[CanonicalLegacyRow], str | None]:
    """A record's outcome: as written when KukGrade knows the word, else as
    the importer read it, else none."""
    readings = configuration.outcome_readings

    def read(row: CanonicalLegacyRow) -> str | None:
        if (
            row.outcome is not None
            or row.record_kind != LegacyRecordKind.GRADING_RESULT
        ):
            return row.outcome
        return readings.get(outcome_words(row.source_outcome_text))

    return read


def outcome_unread(row: CanonicalLegacyRow) -> bool:
    """A result whose outcome is written in words KukGrade does not know."""
    return (
        row.record_kind == LegacyRecordKind.GRADING_RESULT
        and bool(row.source_outcome_text.strip())
        and row.outcome is None
    )


type Read = list[tuple[ImportRow, CanonicalLegacyRow]]


def legacy_checks(batch: ImportBatch) -> list[LegacyCheck]:
    """Every check of a historical import (none for a roster), open and
    decided, in the order of CheckKind. Read from the rows as last classified
    (services._classify_legacy): those coming in, and those left out from a
    chosen sheet, which a check about rows still shows as left out."""
    if batch.kind != ImportBatch.Kind.LEGACY_GRADINGS:
        return []
    configuration = batch.configuration
    chosen = {sheet["name"] for sheet in configuration.sheets if sheet["included"]}
    read: Read = []
    stored = batch.rows.filter(
        outcome__in=[ImportRow.Outcome.READY, ImportRow.Outcome.EXCLUDED],
    ).order_by("row_number")
    for row in stored:
        canonical = CanonicalLegacyRow(**row.raw)
        if canonical.source_sheet in chosen:
            read.append((row, canonical))
    ready = [(row, canonical) for row, canonical in read if not row.excluded]
    kept = set(configuration.checks_kept)
    checks = [
        *_rank_checks(ready, configuration, kept),
        *_outcome_checks(ready, configuration, kept),
        *_name_checks(read, kept),
        *_missing_checks(read, kept),
    ]
    order = {kind: index for index, kind in enumerate(CheckKind.values)}
    return sorted(checks, key=lambda check: order[check.kind])


def _rank_checks(
    ready: Read,
    configuration: ImportConfiguration,
    kept: set[str],
) -> list[LegacyCheck]:
    ranks = active_rank_lookup()
    active_codes = {rank.code for rank in ranks.values()}
    uses: dict[str, list[ImportRow]] = {}
    written: dict[str, str] = {}
    for row, canonical in ready:
        spellings = (
            canonical.source_current_rank_text,
            canonical.source_testing_for_rank_text,
        )
        # A spelling written in both columns of a row is one use of it.
        for key, text in {
            rank_key(text): text.strip() for text in reversed(spellings) if text.strip()
        }.items():
            uses.setdefault(key, []).append(row)
            written.setdefault(key, text)
    checks: list[LegacyCheck] = []
    for key in sorted(uses):
        text = written[key]
        suggested, doubtful = suggest_rank(text, ranks)
        if suggested is not None and not doubtful:
            continue
        chosen = configuration.rank_mappings.get(text.lower())
        if chosen in active_codes:
            decision: str | None = CheckDecision.RANK
        else:
            chosen = None
            decision = CheckDecision.KEEP if key in kept else None
        checks.append(
            LegacyCheck(
                key=key,
                kind=CheckKind.RANK,
                message=(
                    f"The workbook marks the rank “{text}” as uncertain."
                    if doubtful
                    else f"KukGrade can't read the rank “{text}”."
                ),
                rows=uses[key],
                text=text,
                suggested_rank_code=suggested.code if suggested else None,
                decision=decision,
                rank_code=chosen,
            ),
        )
    return checks


def _outcome_checks(
    ready: Read,
    configuration: ImportConfiguration,
    kept: set[str],
) -> list[LegacyCheck]:
    uses: dict[str, list[ImportRow]] = {}
    written: dict[str, str] = {}
    for row, canonical in ready:
        if outcome_unread(canonical):
            key = outcome_key(canonical.source_outcome_text)
            uses.setdefault(key, []).append(row)
            written.setdefault(key, canonical.source_outcome_text.strip())
    checks: list[LegacyCheck] = []
    for key in sorted(uses):
        text = written[key]
        reading = configuration.outcome_readings.get(outcome_words(text))
        if reading in LegacyOutcome.values:
            decision: str | None = CheckDecision.OUTCOME
        else:
            reading = None
            decision = CheckDecision.KEEP if key in kept else None
        checks.append(
            LegacyCheck(
                key=key,
                kind=CheckKind.OUTCOME,
                message=f"KukGrade can't read the outcome “{text}”.",
                rows=uses[key],
                text=text,
                decision=decision,
                outcome=reading,
            ),
        )
    return checks


def _name_checks(read: Read, kept: set[str]) -> list[LegacyCheck]:
    """Names alike on a sheet, found among the rows left out too, so leaving
    one out sorts the check rather than ending it."""
    by_locator = {canonical.source_locator: (row, canonical) for row, canonical in read}
    checks: list[LegacyCheck] = []
    for group in name_groups(canonical for _, canonical in read):
        members = sorted(
            (
                by_locator[member.source_locator]
                for member in group.graded + group.absent
            ),
            key=lambda member: member[0].row_number,
        )
        twice = len(group.graded) > 1
        kind = CheckKind.WRITTEN_TWICE if twice else CheckKind.MISSING_AND_GRADED
        # Named by every row it is about, so a decision kept for one group of
        # rows never passes to another; hashed, as a sheet may name hundreds.
        rows_named = ",".join(sorted(row.source_locator for row, _ in members))
        key = f"{kind}:{hashlib.sha256(rows_named.encode()).hexdigest()[:24]}"
        still_in = [(row, canonical) for row, canonical in members if not row.excluded]
        if not names_in_conflict(canonical for _, canonical in still_in):
            decision: str | None = CheckDecision.LEAVE_OUT
        else:
            decision = CheckDecision.KEEP if key in kept else None
        checks.append(
            LegacyCheck(
                key=key,
                kind=kind,
                message=(
                    f"These may be one person written twice on sheet "
                    f"'{group.sheet}'. If so, leave one out."
                    if twice
                    else f"Someone listed as missing or not attending on sheet "
                    f"'{group.sheet}' may also be graded there. Check which is "
                    "right."
                ),
                rows=[row for row, _ in members],
                decision=decision,
                rows_to_leave_out=[row.row_number for row, _ in still_in],
            ),
        )
    return checks


_MISSING_KINDS = {
    NO_OUTCOME: CheckKind.NO_OUTCOME,
    NO_CURRENT_RANK: CheckKind.NO_RANK,
    NO_TESTING_FOR_RANK: CheckKind.NO_RANK,
}


def _missing_checks(read: Read, kept: set[str]) -> list[LegacyCheck]:
    found: dict[str, list[LegacyCheck]] = {kind: [] for kind in _MISSING_KINDS.values()}
    for row, canonical in read:
        messages: dict[str, list[str]] = {}
        for message in missing_written(canonical):
            messages.setdefault(_MISSING_KINDS[message], []).append(message)
        for kind, said in messages.items():
            key = f"{kind}:{canonical.source_locator}"
            if row.excluded:
                decision: str | None = CheckDecision.LEAVE_OUT
            else:
                decision = CheckDecision.KEEP if key in kept else None
            found[kind].append(
                LegacyCheck(
                    key=key,
                    kind=kind,
                    message=" ".join(said),
                    rows=[row],
                    decision=decision,
                    rows_to_leave_out=[] if row.excluded else [row.row_number],
                ),
            )
    return [check for checks in found.values() for check in checks]


def check_counts(checks: Iterable[LegacyCheck]) -> dict[str, tuple[int, int]]:
    """Each kind's checks, and how many of them are still open, for every
    kind in order."""
    counts = {kind: (0, 0) for kind in CheckKind.values}
    for check in checks:
        total, still_open = counts[check.kind]
        counts[check.kind] = (total + 1, still_open + int(check.is_open))
    return counts
