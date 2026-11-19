"""People from the imported history: its records grouped into the people
they are most likely about, each with the students it may be.

The workbook names people as written on the mat - "Theo R" one quarter,
"Theo Rowan" the next, "Teo Rowan" after that - and one spelling can be two
people on one sheet. So records are grouped by names that could be the same
person (legacy_matching.names_compatible) and by the rank history they tell:
passing to Yellow, then holding Yellow on the next sheet, is the strongest
sign two records are one person, and nobody goes down a grade.

Grouping is deterministic: the same records always give the same people. It
runs when records are saved (create_legacy_grading_records), and on a later
import only for the new records, which join a person already there or make
new ones. A person is never broken up or joined to another by it: that is a
person's decision. A new record joins a person already decided only on a
strong rank chain, and waits for that decision to be confirmed for it
(`person_confirmed`).

Grouping itself (group_entries) works on plain Entry values, so the
migration that first gave records their people uses it too.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any

from django.db import models
from django.utils import timezone

from gradings.legacy_matching import (
    Candidate,
    RankLike,
    StudentPool,
    Suggestion,
    best_candidates,
    leaves_at,
    name_tokens,
    names_compatible,
    student_pool,
    suggestion_for,
)
from gradings.models import (
    MISSING_SECTION,
    SHEET_NOTE_NAME,
    LegacyGradingRecord,
    LegacyOutcome,
    LegacyPerson,
    LegacyPersonConfidence,
    LegacyPersonState,
    LegacyRecordKind,
)
from ranks.matching import active_rank_lookup, rank_for_text
from ranks.models import Rank
from students.models import Student

# The most pairs of records compared in one grouping. A real workbook needs a
# few thousand; past this (a file made to be slow) each new record is its own
# person, and says so.
MAX_COMPARED_PAIRS = 200_000
TOO_MANY_TO_COMPARE = (
    "Too many records with similar names to compare, so this record was not "
    "grouped with any other."
)


NOT_ONE_PERSON = (
    "These records no longer read as one person: two results on one sheet, a "
    "rank going down, or names that cannot be the same person."
)


class Chain(IntEnum):
    """What two records' ranks say about their being one person."""

    RULED_OUT = 0  # the ranks go down, or two results on one sheet
    UNKNOWN = 1  # no ranks to compare
    FORWARD = 2  # the ranks only move forward
    STRONG = 3  # passed to a rank and held it next, or held it again


@dataclass(frozen=True)
class Entry:
    """A record as grouping sees it."""

    tokens: tuple[str, ...]
    name: str
    cycle: tuple[int, int]
    result: bool
    absent: bool
    held: RankLike | None
    testing: RankLike | None
    outcome: str | None

    @property
    def leaves_at(self) -> RankLike | None:
        return leaves_at(self.outcome, self.held, self.testing)


def _period(cycle: tuple[int, int]) -> str:
    return f"{cycle[1]:02d}/{cycle[0]}"


def chain(first: Entry, second: Entry) -> Chain:
    """What two records' ranks say, the earlier first."""
    if second.cycle < first.cycle:
        first, second = second, first
    if first.cycle == second.cycle:
        # One sheet: two results are two people; a missing entry and a
        # result may be one, if the rank held agrees.
        if first.result and second.result:
            return Chain.RULED_OUT
        if first.held and second.held and first.held.order != second.held.order:
            return Chain.RULED_OUT
        return Chain.UNKNOWN
    floor = first.leaves_at
    if floor is None or second.held is None:
        return Chain.UNKNOWN
    if second.held.order < floor.order:
        return Chain.RULED_OUT
    if second.held.order == floor.order:
        passed = first.outcome == LegacyOutcome.PASS and first.testing is not None
        stayed = first.absent or first.outcome in (
            LegacyOutcome.FAIL,
            LegacyOutcome.CONDITIONAL,
        )
        if passed or stayed:
            return Chain.STRONG
    return Chain.FORWARD


def holds_together(entries: Sequence[Entry]) -> bool:
    """Whether records could all be one person: any two names could be the
    same, one result a sheet at most, the rank held on a sheet agreeing, and
    no rank below one already reached."""
    names = {entry.tokens for entry in entries}
    if len(names) > 1:
        listed = sorted(names)
        for index, name in enumerate(listed):
            if not all(names_compatible(name, other) for other in listed[index + 1 :]):
                return False
    by_cycle: dict[tuple[int, int], list[Entry]] = defaultdict(list)
    for entry in entries:
        by_cycle[entry.cycle].append(entry)
    floor: int | None = None
    for cycle in sorted(by_cycle):
        on_sheet = by_cycle[cycle]
        if sum(entry.result for entry in on_sheet) > 1:
            return False
        held = {entry.held.order for entry in on_sheet if entry.held is not None}
        if len(held) > 1:
            return False
        if held and floor is not None and min(held) < floor:
            return False
        reached = [entry.leaves_at.order for entry in on_sheet if entry.leaves_at]
        if reached:
            floor = max([*reached, *([floor] if floor is not None else [])])
    return True


@dataclass
class Rating:
    confidence: str
    reasons: list[str]


_CONFIDENCE_ORDER = [
    LegacyPersonConfidence.LOW,
    LegacyPersonConfidence.MEDIUM,
    LegacyPersonConfidence.HIGH,
]


def _link_reason(first: Entry, second: Entry, link: Chain) -> str:
    then, later = _period(first.cycle), _period(second.cycle)
    if link == Chain.STRONG and first.held is not None and second.held is not None:
        if first.outcome == LegacyOutcome.PASS and first.testing is not None:
            return (
                f"Passed to {first.testing.name} in {then}, then held "
                f"{second.held.name} in {later}."
            )
        was = "Missed the grading" if first.absent else "Did not pass"
        return f"{was} at {first.held.name} in {then}, then held it again in {later}."
    if link == Chain.FORWARD:
        return f"The ranks move forward from {then} to {later}."
    return f"No ranks to compare between {then} and {later}."


def rate(entries: Sequence[Entry]) -> Rating:
    """How sure it is that `entries` are one person, and why, in plain words.

    Each sheet is compared with the next one the person is on: a strong rank
    chain is sure; ranks only moving forward are sure under one spelling;
    no ranks to compare is not. Being both missing and graded on one sheet
    is never sure.
    """
    ordered = sorted(entries, key=lambda entry: entry.cycle)
    spellings = list(dict.fromkeys(entry.name for entry in ordered))
    one_spelling = len({entry.tokens for entry in ordered}) == 1
    confidence = LegacyPersonConfidence.HIGH
    reasons: list[str] = []
    if len(spellings) > 1:
        written = ", ".join(f"“{name}”" for name in spellings)
        reasons.append(f"Written as {written}.")

    def lower_to(level: LegacyPersonConfidence) -> None:
        nonlocal confidence
        if _CONFIDENCE_ORDER.index(level) < _CONFIDENCE_ORDER.index(confidence):
            confidence = level

    by_cycle: dict[tuple[int, int], list[Entry]] = defaultdict(list)
    for entry in ordered:
        by_cycle[entry.cycle].append(entry)
    cycles = sorted(by_cycle)
    for cycle in cycles:
        on_sheet = by_cycle[cycle]
        if any(entry.result for entry in on_sheet) and any(
            entry.absent for entry in on_sheet
        ):
            reasons.append(
                f"Listed as missing or not attending and graded in {_period(cycle)}.",
            )
            lower_to(LegacyPersonConfidence.MEDIUM)
    for earlier, later in zip(cycles, cycles[1:], strict=False):
        pairs = [(a, b) for a in by_cycle[earlier] for b in by_cycle[later]]
        first, second = max(pairs, key=lambda pair: chain(*pair))
        link = chain(first, second)
        reasons.append(_link_reason(first, second, link))
        if link == Chain.FORWARD and not one_spelling:
            lower_to(LegacyPersonConfidence.MEDIUM)
        elif link == Chain.UNKNOWN:
            lower_to(
                LegacyPersonConfidence.MEDIUM
                if one_spelling
                else LegacyPersonConfidence.LOW,
            )
    if not holds_together(ordered):
        # A rank corrected or a record voided since they were grouped.
        reasons.insert(0, NOT_ONE_PERSON)
        confidence = LegacyPersonConfidence.LOW
    return Rating(confidence=confidence, reasons=reasons)


@dataclass
class Cluster:
    """Records being grouped as one person; `fixed` for a person already
    there, `decided` when a person has decided about them."""

    entries: list[int]
    fixed: bool = False
    decided: bool = False


@dataclass
class Grouping:
    """What grouping found: each existing person (by its index in `fixed`)
    with the new entries that join it, and the new people as entry lists."""

    joined: dict[int, list[int]] = field(default_factory=dict)
    new_people: list[list[int]] = field(default_factory=list)
    compared_all: bool = True


def _first_name_variants(token: str) -> set[str]:
    """The first name, and each way of dropping one letter: two names one
    slip apart share one (legacy_matching._spelt_alike)."""
    variants = {token}
    if len(token) >= 3:
        variants |= {token[:at] + token[at + 1 :] for at in range(len(token))}
    return variants


def _candidate_pairs(
    entries: Sequence[Entry],
    new: set[int],
) -> list[tuple[int, int]] | None:
    """Every pair of entries, one of them new, whose names could be one
    person; None when there are more than MAX_COMPARED_PAIRS.

    Only combinations with a new entry are ever looked at - names first,
    then their records - so a long history costs nothing until a new record
    shares a name with it.
    """
    by_name: dict[tuple[str, ...], tuple[list[int], list[int]]] = {}
    for index, entry in enumerate(entries):
        fresh, held = by_name.setdefault(entry.tokens, ([], []))
        (fresh if index in new else held).append(index)
    by_variant: dict[str, list[tuple[str, ...]]] = defaultdict(list)
    for name in by_name:
        for variant in _first_name_variants(name[0]):
            by_variant[variant].append(name)
    looked_at = 0
    name_pairs: set[tuple[tuple[str, ...], tuple[str, ...]]] = set()
    for names in by_variant.values():
        with_new = [name for name in names if by_name[name][0]]
        looked_at += len(with_new) * len(names)
        if looked_at > MAX_COMPARED_PAIRS:
            return None
        for name in with_new:
            for other in names:
                pair = (name, other) if name <= other else (other, name)
                if pair not in name_pairs and names_compatible(name, other):
                    name_pairs.add(pair)
    pairs: set[tuple[int, int]] = set()
    for name, other in sorted(name_pairs):
        fresh, held = by_name[name]
        other_fresh, other_held = by_name[other]
        looked_at += len(fresh) * (len(other_fresh) + len(other_held)) + len(
            held,
        ) * len(other_fresh)
        if looked_at > 2 * MAX_COMPARED_PAIRS:
            return None
        if name == other:
            combinations = [
                (first, second)
                for at, first in enumerate(fresh)
                for second in (*fresh[at + 1 :], *held)
            ]
        else:
            combinations = [
                (first, second)
                for first in fresh
                for second in (*other_fresh, *other_held)
            ] + [(first, second) for first in held for second in other_fresh]
        pairs.update((min(pair), max(pair)) for pair in combinations)
        if len(pairs) > MAX_COMPARED_PAIRS:
            return None
    return sorted(pairs)


def group_entries(entries: Sequence[Entry], fixed: Sequence[Cluster]) -> Grouping:
    """Group `entries` into people. Each of `fixed` is a person already
    there, by the entries that are theirs; every other entry is new.

    Pairs are joined strongest first - by rank chain, then the same
    spelling, then the nearest sheets, then their order - and only when all
    the records joined could still be one person (holds_together). Two
    people already there are never joined, and a new record joins a person
    already decided only on a strong chain.
    """
    owner: dict[int, int] = {}
    clusters: list[Cluster] = []
    for cluster in fixed:
        for index in cluster.entries:
            owner[index] = len(clusters)
        clusters.append(Cluster(list(cluster.entries), True, cluster.decided))
    new = [index for index in range(len(entries)) if index not in owner]
    for index in new:
        owner[index] = len(clusters)
        clusters.append(Cluster([index]))

    pairs = _candidate_pairs(entries, set(new))
    if pairs is None:
        return Grouping(new_people=[[index] for index in new], compared_all=False)

    def strength(pair: tuple[int, int]) -> tuple[int, int, int, int, int]:
        first, second = entries[pair[0]], entries[pair[1]]
        apart = abs(
            (first.cycle[0] - second.cycle[0]) * 12 + first.cycle[1] - second.cycle[1],
        )
        return (
            -chain(first, second),
            -(first.tokens == second.tokens),
            apart,
            pair[0],
            pair[1],
        )

    for pair in sorted(pairs, key=strength):
        link = chain(entries[pair[0]], entries[pair[1]])
        if link == Chain.RULED_OUT:
            continue
        one, other = owner[pair[0]], owner[pair[1]]
        if one == other:
            continue
        first, second = clusters[one], clusters[other]
        if first.fixed and second.fixed:
            continue
        if (first.decided or second.decided) and link != Chain.STRONG:
            continue
        merged = first.entries + second.entries
        if not holds_together([entries[index] for index in merged]):
            continue
        keep, gone = (one, other) if first.fixed or not second.fixed else (other, one)
        clusters[keep].entries = merged
        for index in clusters[gone].entries:
            owner[index] = keep
        clusters[gone].entries = []

    grouping = Grouping()
    for at, cluster in enumerate(clusters):
        if at < len(fixed):
            joined = sorted(set(cluster.entries) - set(fixed[at].entries))
            if joined:
                grouping.joined[at] = joined
        elif cluster.entries:
            grouping.new_people.append(sorted(cluster.entries))
    grouping.new_people.sort()
    return grouping


def _ranks_of(
    record_: LegacyGradingRecord,
    ranks: dict[str, Rank],
) -> tuple[Rank | None, Rank | None]:
    """The ranks a record gives, held and tested for, as matched or as
    written."""
    return (
        record_.current_rank or rank_for_text(record_.source_current_rank_text, ranks),
        record_.testing_for_rank
        or rank_for_text(record_.source_testing_for_rank_text, ranks),
    )


def entry_for(
    record_: LegacyGradingRecord,
    ranks: dict[str, Rank],
) -> Entry:
    """A record as grouping sees it, its ranks as matched or as written."""
    held, testing = _ranks_of(record_, ranks)
    return Entry(
        tokens=tuple(name_tokens(record_.source_name))
        or (record_.source_name.lower(),),
        name=record_.source_name,
        cycle=(record_.cycle_year, record_.cycle_month),
        result=record_.record_kind == LegacyRecordKind.GRADING_RESULT,
        absent=record_.record_kind == LegacyRecordKind.DID_NOT_ATTEND
        or record_.source_section == MISSING_SECTION,
        held=held,
        testing=testing,
        outcome=record_.outcome,
    )


def _live_records(person_ids: Iterable[int]) -> models.QuerySet[LegacyGradingRecord]:
    return (
        LegacyGradingRecord.objects.filter(person_id__in=person_ids, is_void=False)
        .select_related("current_rank", "testing_for_rank")
        .order_by("person_id", "pk")
    )


# What re-rating a person changes. The version goes up with it, so a decision
# made on how the person looked before is refused (legacy_person_services).
_RATED_FIELDS = ["confidence", "reasons", "updated_at", "version"]


def assign_people(records: Sequence[LegacyGradingRecord]) -> None:
    """Give each of `records` - new, not yet saved - its person: one already
    there, or a new one. Every record but a sheet note gets one.

    The people already there are locked first (in id order, as every
    decision about one locks it), so a decision cannot change one while
    records join it. Called inside the import's commit.
    """
    new = [record_ for record_ in records if record_.source_name != SHEET_NOTE_NAME]
    if not new:
        return
    held_by = list(
        LegacyGradingRecord.objects.filter(is_void=False, person__isnull=False)
        .order_by()
        .values_list("person_id", flat=True)
        .distinct(),
    )
    people = {
        person.pk: person
        for person in LegacyPerson.objects.select_for_update()
        .filter(pk__in=held_by)
        .order_by("pk")
    }
    theirs: dict[int, list[LegacyGradingRecord]] = defaultdict(list)
    for record_ in _live_records(people):
        theirs[record_.person_id or 0].append(record_)

    ranks = active_rank_lookup()
    entries: list[Entry] = []
    owners: list[LegacyGradingRecord] = []
    fixed: list[Cluster] = []
    order = sorted(people)
    for pk in order:
        start = len(entries)
        for record_ in theirs[pk]:
            entries.append(entry_for(record_, ranks))
            owners.append(record_)
        fixed.append(
            Cluster(
                list(range(start, len(entries))),
                fixed=True,
                decided=people[pk].state != LegacyPersonState.PROPOSED,
            ),
        )
    for record_ in new:
        entries.append(entry_for(record_, ranks))
        owners.append(record_)

    grouping = group_entries(entries, fixed)

    created = LegacyPerson.objects.bulk_create(
        [
            LegacyPerson(
                **person_fields(
                    [entries[index] for index in indices],
                    compared_all=grouping.compared_all,
                ),
            )
            for indices in grouping.new_people
        ],
    )
    for person, indices in zip(created, grouping.new_people, strict=True):
        for index in indices:
            owners[index].person = person
    changed: list[LegacyPerson] = []
    now = timezone.now()
    for at, indices in grouping.joined.items():
        person = people[order[at]]
        for index in indices:
            owners[index].person = person
        rating = rate([entries[index] for index in fixed[at].entries + indices])
        person.confidence, person.reasons = rating.confidence, rating.reasons
        person.updated_at = now
        person.version += 1
        changed.append(person)
    LegacyPerson.objects.bulk_update(changed, _RATED_FIELDS)


def refresh_people(person_ids: Iterable[int | None]) -> None:
    """Rate `person_ids` again from their live records, after a record of
    theirs changed (a rank corrected, a record voided), so how sure each is
    never rests on what the records said before. A person whose records no
    longer read as one is the least sure, and says so (rate). The caller
    holds the lock on each already, or this takes it."""
    ids = sorted({pk for pk in person_ids if pk is not None})
    if not ids:
        return
    people = list(
        LegacyPerson.objects.select_for_update().filter(pk__in=ids).order_by("pk"),
    )
    theirs: dict[int, list[LegacyGradingRecord]] = defaultdict(list)
    for record_ in _live_records(ids):
        theirs[record_.person_id or 0].append(record_)
    ranks = active_rank_lookup()
    now = timezone.now()
    changed: list[LegacyPerson] = []
    for person in people:
        if theirs[person.pk]:
            rating = rate([entry_for(r, ranks) for r in theirs[person.pk]])
            person.confidence, person.reasons = rating.confidence, rating.reasons
        # Their records changed, whatever the rating says now.
        person.updated_at = now
        person.version += 1
        changed.append(person)
    LegacyPerson.objects.bulk_update(changed, _RATED_FIELDS)


def person_fields(entries: Sequence[Entry], *, compared_all: bool) -> dict[str, Any]:
    """A new person's confidence and reasons, from the entries that are
    theirs."""
    rating = rate(entries)
    reasons = rating.reasons if compared_all else [TOO_MANY_TO_COMPARE]
    return {"confidence": rating.confidence, "reasons": reasons}


# --- reading people ----------------------------------------------------------


class PersonQueue(models.TextChoices):
    """Where a person waits for a decision."""

    READY = "READY", "Ready to confirm"
    NEEDS_A_LOOK = "NEEDS_A_LOOK", "Needs a look"
    NO_STUDENT = "NO_STUDENT", "No student found"


@dataclass
class PersonView:
    """A person with their live records, oldest first, and - once
    suggest_students has run - the students they may be."""

    person: LegacyPerson
    records: list[LegacyGradingRecord]
    candidates: list[Candidate] = field(default_factory=list)
    suggested: bool = False

    @property
    def spellings(self) -> list[str]:
        """Each name as written, in the order the records give them."""
        return list(dict.fromkeys(record_.source_name for record_ in self.records))

    @property
    def name(self) -> str:
        """The fullest spelling: the most words, then the most records, then
        the words the other records share most (so "Theo Rowan" over a slip,
        "Teo Rowan"), then the latest written."""
        counts: dict[str, int] = defaultdict(int)
        latest: dict[str, int] = {}
        words: dict[str, int] = defaultdict(int)
        for at, record_ in enumerate(self.records):
            counts[record_.source_name] += 1
            latest[record_.source_name] = at
            for word in set(name_tokens(record_.source_name)):
                words[word] += 1

        def fullness(name: str) -> tuple[int, int, int, int]:
            tokens = name_tokens(name)
            shared = sum(words[word] for word in set(tokens))
            return (-len(tokens), -counts[name], -shared, -latest[name])

        return min(counts, key=fullness)

    @property
    def awaiting_confirmation(self) -> int:
        """Records that joined after the person was decided."""
        if self.person.state == LegacyPersonState.PROPOSED:
            return 0
        return sum(1 for record_ in self.records if not record_.person_confirmed)

    @property
    def suggestion(self) -> Suggestion:
        return suggestion_for(self.candidates)

    @property
    def queue(self) -> PersonQueue | None:
        """Where the person waits, or None when nothing waits on them.

        Ready to confirm needs one student to fit clearly, their rank now
        not below the rank then (suggestion_for), and the records to be
        surely one person.
        """
        if self.person.state != LegacyPersonState.PROPOSED:
            return PersonQueue.NEEDS_A_LOOK if self.awaiting_confirmation else None
        assert self.suggested, "suggest_students has not run"
        if not self.candidates:
            return PersonQueue.NO_STUDENT
        if (
            self.suggestion == Suggestion.CLEAR
            and self.person.confidence == LegacyPersonConfidence.HIGH
        ):
            return PersonQueue.READY
        return PersonQueue.NEEDS_A_LOOK

    @property
    def sorted(self) -> bool:
        """Decided, and the decision covers every record."""
        return (
            self.person.state != LegacyPersonState.PROPOSED
            and not self.awaiting_confirmation
        )

    def rank_then(self, ranks: dict[str, Rank]) -> Rank | None:
        """The highest rank the latest grading with a rank leaves them at,
        as matched or as written - every record of that grading, whatever
        its place on the sheet."""
        by_cycle: dict[tuple[int, int], list[Rank]] = defaultdict(list)
        for record_ in self.records:
            reached = leaves_at(record_.outcome, *_ranks_of(record_, ranks))
            if reached is not None:
                by_cycle[(record_.cycle_year, record_.cycle_month)].append(reached)
        if not by_cycle:
            return None
        return max(by_cycle[max(by_cycle)], key=lambda rank: rank.order)


def person_views(
    people: models.QuerySet[LegacyPerson],
) -> list[PersonView]:
    """Each person with live records, by name: one read for the people, one
    for their records."""
    found = list(
        people.select_related("student", "student__current_rank", "decided_by"),
    )
    theirs: dict[int, list[LegacyGradingRecord]] = defaultdict(list)
    for record_ in (
        LegacyGradingRecord.objects.filter(
            person_id__in=[person.pk for person in found],
            is_void=False,
        )
        .select_related("student", "current_rank", "testing_for_rank")
        .order_by("cycle_year", "cycle_month", "source_sheet", "source_locator")
    ):
        theirs[record_.person_id or 0].append(record_)
    views = [
        PersonView(person, theirs[person.pk]) for person in found if theirs[person.pk]
    ]
    views.sort(key=lambda view: (view.name.lower(), view.person.pk))
    return views


def suggest_students(
    views: Iterable[PersonView],
    students: Iterable[Student] | None = None,
) -> None:
    """Score the students each undecided person may be: their fullest
    spelling, and the rank their latest record leaves them at."""
    pool = StudentPool(students if students is not None else student_pool())
    ranks = active_rank_lookup()
    for view in views:
        view.suggested = True
        if view.person.state != LegacyPersonState.PROPOSED:
            continue
        view.candidates = best_candidates(
            name_tokens(view.name),
            view.rank_then(ranks),
            pool,
        )


def people_in(
    people: models.QuerySet[LegacyPerson],
    *,
    queue: str = "",
) -> list[PersonView]:
    """`people` with their records, narrowed to those waiting in `queue`. A
    queue no person can be in matches none, as on every list. Students are
    scored only when the queue narrows the list; the list scores the page it
    shows."""
    if queue and queue not in PersonQueue.values:
        return []
    views = person_views(people)
    if queue:
        suggest_students(views)
        views = [view for view in views if view.queue == queue]
    return views
