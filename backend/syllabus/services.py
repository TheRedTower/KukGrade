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


def _part_number(notes: str) -> tuple[int, int | None] | None:
    """The part a chart note names - (1, 2) for `(1/2)`, (3, None) for `(pt.3)`."""
    match = _CHART_NOTATION_RE.match(notes.strip())
    if not match:
        return None
    inner = match.group(1)
    part_of = _PART_OF_RE.match(inner)
    if part_of:
        return int(part_of.group(1)), int(part_of.group(2))
    part_label = _PART_LABEL_RE.match(inner)
    if part_label:
        return int(part_label.group(1)), None
    return None


def _format_parts(numbers: list[int]) -> str:
    if numbers == list(range(numbers[0], numbers[-1] + 1)):
        return f"{numbers[0]}-{numbers[-1]}"
    return ", ".join(str(number) for number in numbers)


def cumulative_notation(mappings: list[SyllabusRequirement]) -> str:
    """Display wording for an item's mappings up to a rank, oldest first.

    The latest mapping's notation, except for a form taught in parts across
    ranks: every part taught so far is examinable, so 8-and-under Cho Geup
    Hyung (part 1 at Blue, 2 at Red stripe, 3 at Red) reads "Parts 1-3"
    from Red on, not only the latest "Part 3" (2026-10-18, audit F-09). A
    latest mapping without part notation - the whole form, or a range -
    stands as it is.
    """
    latest = _part_number(mappings[-1].notes)
    if latest is None:
        return normalize_chart_notation(mappings[-1].notes)
    _, of_total = latest
    parts = sorted(
        {
            found[0]
            for found in (_part_number(mapping.notes) for mapping in mappings)
            if found is not None and found[1] == of_total
        },
    )
    if len(parts) == 1:
        return normalize_chart_notation(mappings[-1].notes)
    suffix = f" of {of_total}" if of_total is not None else ""
    return f"Parts {_format_parts(parts)}{suffix}"


@dataclass(frozen=True)
class EffectiveSyllabusRequirement:
    """One cumulative row: the latest applicable mapping, plus provenance.

    `notation` is the display wording for the whole cumulative row (see
    cumulative_notation), which the latest mapping's notes alone may not
    give.
    """

    requirement: SyllabusRequirement
    introduced_rank: Rank
    effective_since_rank: Rank
    is_new_at_rank: bool
    notation: str


def effective_syllabus_requirements(
    *,
    rank: Rank,
    age_band: str,
) -> list[EffectiveSyllabusRequirement]:
    """One row per item examinable through `rank`, in syllabus order.

    Every category is included: the six core areas, Techniques, Forms and
    Weapons. For an item mapped at more than one rank at or before the
    selection, the highest-order (most recent) mapping supplies the effective
    range, required state and notes, and the parts of a form taught in parts
    are combined; the lowest-order mapping supplies where the item was
    introduced. Syllabus order is the chart's category order,
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
            notation=cumulative_notation(item_rows),
        )
        for item_rows in sorted(by_item.values(), key=syllabus_order)
    ]
