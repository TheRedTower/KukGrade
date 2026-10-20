"""Reading a rank from how a source wrote it - for suggestions only.

Shared by the imports (a rank text in a file) and historical-record matching
(a student's rank in a record). A match here is a suggestion: nothing is ever
set from one until a person chooses it (import Decision 4).
"""

from __future__ import annotations

from ranks.models import Rank


def active_rank_lookup() -> dict[str, Rank]:
    """Every active rank by upper-cased code and name, read once.

    The one rank-text matcher: a rank whose code or name matches, ignoring
    case, the first by catalogue order when several do. One read serves a
    roster of thousands of rows, or every distinct text in a workbook.
    """
    lookup: dict[str, Rank] = {}
    for rank in Rank.objects.filter(active=True):
        lookup.setdefault(rank.code.upper(), rank)
        lookup.setdefault(rank.name.upper(), rank)
    return lookup


# How the club's workbook writes ranks that KukGrade names otherwise
# (2026-10-20, from the real workbook), for suggestions only - a suggestion is
# never applied until chosen (import Decision 4). Fixed spellings, never a
# near miss: "DNB", a slip for DBN, is still left for the importer. Keys are
# upper-cased, with any trailing "BELT" taken off.
_RANK_TEXT_ALIASES = {
    "DBN": "DAHN_BO",
    "DAHN BO NIM": "DAHN_BO",
}


def suggest_rank(text: str, ranks: dict[str, Rank]) -> tuple[Rank | None, bool]:
    """The active rank a source text most likely means, and whether the source
    itself doubted it. "White Belt" suggests White; "DBN" Dahn Bo."""
    cleaned = " ".join(text.split())
    doubtful = cleaned.endswith("?")
    key = cleaned.rstrip("?").strip().upper()
    if key.endswith(" BELT"):
        key = key.removesuffix(" BELT").strip()
    rank = ranks.get(key)
    if rank is None and key in _RANK_TEXT_ALIASES:
        rank = next(
            (
                found
                for found in ranks.values()
                if found.code == _RANK_TEXT_ALIASES[key]
            ),
            None,
        )
    return rank, doubtful


def rank_for_text(text: str, ranks: dict[str, Rank]) -> Rank | None:
    return suggest_rank(text, ranks)[0] if text.strip() else None
