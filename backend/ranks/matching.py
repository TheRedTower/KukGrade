"""Reading a rank from how a source wrote it.

Shared by the imports and historical-record matching. What a match is used
for differs:

- a historical record's rank text is only ever a suggestion - nothing is set
  from it until a person chooses (import Decision 4);
- a roster's rank is the rank a student is created at, so an exact name or
  code, or one of the club's fixed spellings below, is taken as that rank,
  and anything doubtful or misspelt is left for the importer
  (data_imports.services, 2026-10-20);
- record matching reads a record's rank to judge whether a student fits.
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
# (2026-10-20, from the real workbook). Fixed spellings, never a near miss:
# "DNB", a slip for DBN, is still left for the importer. Keys are
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
