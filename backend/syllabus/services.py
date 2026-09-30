"""The syllabus a grading assesses: cumulative, effective as of a rank.

Every grading assesses a candidate on everything examinable through the rank
they are testing for, not only the material that rank introduces (owner
decision, 2026-09-29). A later `SyllabusRequirement` row for the same item
extends or restates the earlier one rather than sitting alongside it. This
module is the one place that turns the flat per-(rank, age band, item) rows
into that cumulative, one-row-per-item view. The syllabus browser serves it
and assessment generation snapshots it, so the two cannot disagree (KG-A05).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ranks.models import Rank
from syllabus.models import CATEGORY_ORDER, SyllabusRequirement

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
    """One row per item examinable through `rank`, in syllabus order.

    Every category is included: the six core areas, Techniques, Forms and
    Weapons. For an item mapped at more than one rank at or before the
    selection, the highest-order (most recent) mapping supplies the effective
    range, required state and notes; the lowest-order mapping supplies where
    the item was introduced. Syllabus order is the chart's category order,
    then the order items were introduced, then the sequence they were
    introduced with - so a technique set keeps its place however often a
    later rank extends it.

    A rank with no requirement of its own for the age band has no recorded
    syllabus and gets nothing: serving the earlier ranks' content would
    present it as that rank's whole curriculum.
    """
    rows = list(
        SyllabusRequirement.objects.filter(
            age_band=age_band,
            active=True,
            item__active=True,
            rank__order__lte=rank.order,
        )
        .select_related("rank", "item")
        .order_by("item_id", "rank__order"),
    )
    if not any(row.rank_id == rank.id for row in rows):
        return []

    by_item: dict[int, list[SyllabusRequirement]] = {}
    for row in rows:
        by_item.setdefault(row.item_id, []).append(row)

    def syllabus_order(
        item_rows: list[SyllabusRequirement],
    ) -> tuple[int, int, int, str, str]:
        introduced = item_rows[0]
        return (
            CATEGORY_ORDER[introduced.item.category],
            introduced.rank.order,
            introduced.sequence,
            introduced.item.name,
            introduced.item.code,
        )

    return [
        EffectiveSyllabusRequirement(
            requirement=item_rows[-1],
            introduced_rank=item_rows[0].rank,
            effective_since_rank=item_rows[-1].rank,
            is_new_at_rank=item_rows[-1].rank_id == rank.id,
        )
        for item_rows in sorted(by_item.values(), key=syllabus_order)
    ]
