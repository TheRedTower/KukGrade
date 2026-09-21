"""Cumulative, effective-as-of-rank syllabus computation (FDR-041 / SCR-025).

A candidate testing for a rank is examinable on everything introduced at or
before that rank, not just what that rank's own rows list - a later
`SyllabusRequirement` row for the same item extends or restates the earlier
one rather than sitting alongside it. This module is the single place that
turns the flat, per-(rank, age_band, item) rows into that cumulative,
one-row-per-item view, so neither the API layer nor the frontend has to
re-derive it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ranks.models import Rank
from syllabus.models import SyllabusItem, SyllabusRequirement

# Only these two categories carry rank-specific, cumulative content - the six
# universal core grading areas are assessed at every rank with no range to
# accumulate, and are served as-is from SyllabusItemViewSet instead.
CUMULATIVE_CATEGORIES = (
    SyllabusItem.Category.TECHNIQUE_SET,
    SyllabusItem.Category.FORM,
)

_CHART_NOTATION_RE = re.compile(r"^Chart notation: \((.+)\)\.$")
_PART_OF_RE = re.compile(r"^(\d+)/(\d+)$")
_PART_LABEL_RE = re.compile(r"^pt\.(\d+)$", re.IGNORECASE)


def normalize_chart_notation(notes: str) -> str:
    """Turn a seeded `Chart notation: (...).` note into display wording.

    `(1/2)` becomes "Part 1 of 2" and `(pt.1)` becomes "Part 1" - the two
    part-numbering conventions the 2014 WKSA chart actually uses. Any other
    parenthesised content (`(1-3)`, `(1 & 2)`) is returned with the prefix
    and trailing period stripped, since it is already a plain range or list.
    Notes that are not chart notation at all (for example a promotion
    eligibility note) return an empty string - they are not a range and do
    not belong in this field.
    """
    match = _CHART_NOTATION_RE.match(notes.strip())
    if not match:
        return ""
    inner = match.group(1)
    part_of = _PART_OF_RE.match(inner)
    if part_of:
        return f"Part {part_of.group(1)} of {part_of.group(2)}"
    part_label = _PART_LABEL_RE.match(inner)
    if part_label:
        return f"Part {part_label.group(1)}"
    return inner


@dataclass(frozen=True)
class EffectiveSyllabusRequirement:
    """One cumulative row: the latest applicable mapping, plus provenance."""

    requirement: SyllabusRequirement
    introduced_rank: Rank
    effective_since_rank: Rank
    is_new_at_rank: bool


def effective_syllabus_requirements(
    *,
    rank: Rank,
    age_band: str,
) -> list[EffectiveSyllabusRequirement]:
    """One effective row per Technique/Form item examinable through `rank`.

    For an item mapped at more than one rank at or before the selection, the
    highest-order (most recent) mapping supplies the effective range,
    required/sequence state and notes; the lowest-order mapping supplies
    where the item was first introduced. This is the accumulation and
    provenance policy FDR-041 requires the backend, not the frontend, to
    encode.
    """
    rows = (
        SyllabusRequirement.objects.filter(
            age_band=age_band,
            active=True,
            item__active=True,
            item__category__in=CUMULATIVE_CATEGORIES,
            rank__order__lte=rank.order,
        )
        .select_related("rank", "item")
        .order_by("item_id", "rank__order")
    )

    by_item: dict[int, list[SyllabusRequirement]] = {}
    for row in rows:
        by_item.setdefault(row.item_id, []).append(row)

    effective = [
        EffectiveSyllabusRequirement(
            requirement=item_rows[-1],
            introduced_rank=item_rows[0].rank,
            effective_since_rank=item_rows[-1].rank,
            is_new_at_rank=item_rows[-1].rank_id == rank.id,
        )
        for item_rows in by_item.values()
    ]
    effective.sort(
        key=lambda row: (
            row.requirement.item.category,
            row.requirement.sequence,
            row.requirement.item.name,
        ),
    )
    return effective
