"""Suggested students for historical records - suggestions only, never links.

The club's workbook names people the way an instructor writes on the mat:
"Zac W", "Alex P", "Sucheth", "JKN Alex", and the same person as "Mamdoh"
one quarter and "Mamdoh Mohamed" the next. There are no WKSA IDs. So records
are grouped by the name as written, and each group gets the students it most
plausibly means, with the reasons in plain words, for a person to confirm.

A suggestion weighs the first name (the same, or close - the workbook has
"Sabastian" for Sebastian), any surname or initial given (a surname that
contradicts rules a student out), and whether the student's rank now fits
the rank the record gave them then (nobody goes down a grade). When several
students fit equally well, that is said rather than one picked.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from django.db import models

from gradings.models import SHEET_NOTE_NAME, LegacyGradingRecord
from kukgrade.search import apply_search
from ranks.matching import RANK_TITLES, active_rank_lookup, rank_for_text
from ranks.models import Rank
from students.models import Student

_CLOSE = 0.8
_MINIMUM_SCORE = 35
_SHOWN = 5


def name_tokens(name: str) -> list[str]:
    """A name as compared: lower-cased words, punctuation and rank titles off."""
    words = re.sub(r"[^\w\s'-]", " ", name.lower()).split()
    # A rank written before a name ("JKN Alex") is a title, not part of it.
    while words and words[0] in RANK_TITLES:
        words.pop(0)
    return words


def group_key(name: str) -> str:
    return " ".join(name_tokens(name))


def _close(a: str, b: str) -> bool:
    return a[:1] == b[:1] and SequenceMatcher(None, a, b).ratio() >= _CLOSE


def _one_edit_apart(a: str, b: str) -> bool:
    """Whether one letter added, dropped or changed turns `a` into `b`."""
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) > len(b):
        a, b = b, a
    for index, (x, y) in enumerate(zip(a, b, strict=False)):
        if x != y:
            # The rest must agree once the slip is skipped.
            skip = 1 if len(a) == len(b) else 0
            return a[index + skip :] == b[index + 1 :]
    return True


def _spelt_alike(a: str, b: str) -> bool:
    """The same word, or the same word with one slip ("Fin", "Finn"; "Ruby",
    "Rubi"), keeping its first letter. A word under three letters must be
    the same."""
    if a == b:
        return True
    return min(len(a), len(b)) >= 3 and a[0] == b[0] and _one_edit_apart(a, b)


def names_compatible(first: Sequence[str], second: Sequence[str]) -> bool:
    """Whether two names as written, each as its name_tokens, could be the
    same person.

    The first names are the same or spelt alike. The rest is missing on one
    side ("Omar", "Omar Haddad"), the same, spelt alike, or an initial
    that matches ("Finn C", "Fin Cole").
    """
    if not first or not second or not _spelt_alike(first[0], second[0]):
        return False
    rest_a, rest_b = " ".join(first[1:]), " ".join(second[1:])
    if not rest_a or not rest_b:
        return True
    if min(len(rest_a), len(rest_b)) == 1:
        return rest_a[0] == rest_b[0]
    return _spelt_alike(rest_a, rest_b)


class Suggestion(models.TextChoices):
    """How clear the students suggested for a name are."""

    CLEAR = "clear", "One student fits clearly"
    CHOOSE = "choose", "A person has to choose"
    NONE = "none", "No student fits"


def suggestion_for(candidates: Sequence[Candidate]) -> Suggestion:
    """How clear `candidates` (best first) are. One student fits clearly only
    when no other fits as well and their rank now is not below the rank the
    records gave then: nobody goes down a grade."""
    if not candidates:
        return Suggestion.NONE
    best = candidates[0]
    if best.rank_fits is False:
        return Suggestion.CHOOSE
    if len(candidates) > 1 and candidates[1].score == best.score:
        return Suggestion.CHOOSE
    return Suggestion.CLEAR


@dataclass(frozen=True)
class Candidate:
    student: Student
    score: int
    reasons: tuple[str, ...]
    # Whether their rank now is at least the rank the records gave then;
    # None when the records give no rank.
    rank_fits: bool | None = None


@dataclass
class PersonGroup:
    """The records that name one person the same way."""

    key: str
    source_name: str
    records: list[LegacyGradingRecord] = field(default_factory=list)
    candidates: list[Candidate] = field(default_factory=list)

    @property
    def shared(self) -> bool:
        """Several students fit equally well: a person has to choose."""
        if len(self.candidates) < 2:
            return False
        return self.candidates[0].score == self.candidates[1].score

    @property
    def suggestion(self) -> Suggestion:
        """How clear the suggestion is: one student, a choice, or none."""
        return suggestion_for(self.candidates)

    @property
    def needs_rank(self) -> bool:
        """Whether a rank is written on a record but not matched to one yet."""
        return any(record.needs_rank for record in self.records)

    @property
    def first_period(self) -> str:
        """The earliest record's year and month, as "2025-03"."""
        return self._periods()[0]

    @property
    def last_period(self) -> str:
        return self._periods()[-1]

    def _periods(self) -> list[str]:
        return sorted(
            f"{record.cycle_year}-{record.cycle_month:02d}" for record in self.records
        )

    @property
    def ranks_written(self) -> list[str]:
        """Each distinct "held → testing for" the records write, oldest first."""
        written: list[str] = []
        for record in sorted(
            self.records,
            key=lambda r: (r.cycle_year, r.cycle_month, r.pk),
        ):
            held = record.source_current_rank_text
            testing = record.source_testing_for_rank_text
            text = f"{held or '(blank)'} → {testing}" if testing else held
            if text and text not in written:
                written.append(text)
        return written

    @property
    def linked_student(self) -> Student | None:
        """The one student every record here is linked to, if there is one."""
        students = {record.student_id for record in self.records}
        if len(students) == 1 and None not in students:
            return self.records[0].student
        return None


def _rank_then(
    group: PersonGroup,
    ranks: dict[str, Rank],
) -> Rank | None:
    """The highest rank the records gave this person, resolved or as written."""
    found: list[Rank] = []
    for record in group.records:
        for resolved, text in (
            (record.current_rank, record.source_current_rank_text),
            (record.testing_for_rank, record.source_testing_for_rank_text),
        ):
            rank = resolved or rank_for_text(text, ranks)
            if rank is not None:
                found.append(rank)
    return max(found, key=lambda rank: rank.order, default=None)


def score_student(
    tokens: list[str],
    student: Student,
    rank_then: Rank | None,
) -> Candidate | None:
    """How well `student` fits a name as written, or None if they cannot."""
    if not tokens:
        return None
    first = student.first_name.lower()
    last = student.last_name.lower()
    given, rest = tokens[0], " ".join(tokens[1:])
    reasons: list[str] = []

    if rest and given == last and rest == first:
        score = 85
        reasons.append("Same name, written surname first")
        rest = ""
    elif given == first:
        score = 50
        reasons.append("Same first name")
    elif len(given) > 2 and _close(given, first):
        score = 35
        reasons.append(f"First name close to {student.first_name}")
    else:
        return None

    if rest:
        if rest == last or (len(rest) > 1 and last.startswith(rest)):
            score += 40
            reasons.append("Same surname")
        elif len(rest) == 1 and last.startswith(rest):
            score += 20
            reasons.append("Surname initial matches")
        elif len(rest) > 2 and _close(rest, last):
            score += 25
            reasons.append(f"Surname close to {student.last_name}")
        else:
            return None

    rank_fits: bool | None = None
    if rank_then is not None:
        now = student.current_rank
        rank_fits = now.order >= rank_then.order
        if rank_fits:
            score += 10
            reasons.append(f"Rank fits: {now.name} now, {rank_then.name} then")
        else:
            score -= 25
            reasons.append(f"Lower rank now ({now.name}) than then ({rank_then.name})")

    if score < _MINIMUM_SCORE:
        return None
    return Candidate(
        student=student,
        score=score,
        reasons=tuple(reasons),
        rank_fits=rank_fits,
    )


def group_records(records: Iterable[LegacyGradingRecord]) -> list[PersonGroup]:
    """Group in stable name order, without doing suggestion work."""
    groups: dict[str, PersonGroup] = {}
    for record in records:
        if record.is_void or record.source_name == SHEET_NOTE_NAME:
            continue
        key = group_key(record.source_name)
        if not key:
            continue
        group = groups.setdefault(
            key, PersonGroup(key=key, source_name=record.source_name)
        )
        group.records.append(record)

    return sorted(groups.values(), key=lambda group: group.key)


def suggest_for_groups(
    groups: Iterable[PersonGroup],
    students: Iterable[Student] | None = None,
) -> None:
    """Score only the groups the caller will actually show."""

    pool = list(students) if students is not None else student_pool()
    ranks = active_rank_lookup()
    for group in groups:
        group.candidates = best_candidates(
            name_tokens(group.source_name),
            _rank_then(group, ranks),
            pool,
        )


def student_pool() -> list[Student]:
    """Every student a record could be about, read once for many names."""
    return list(
        Student.objects.filter(deleted_at__isnull=True)
        .select_related("current_rank")
        .order_by("pk"),
    )


def best_candidates(
    tokens: list[str],
    rank_then: Rank | None,
    pool: Iterable[Student],
) -> list[Candidate]:
    """The students in `pool` that fit a name best, best first."""
    scored = [
        candidate
        for student in pool
        if (candidate := score_student(tokens, student, rank_then)) is not None
    ]
    scored.sort(key=lambda candidate: (-candidate.score, candidate.student.pk))
    return scored[:_SHOWN]


# How the people list narrows to the names a viewer has put aside for now.
SET_ASIDE_CHOICES = ("exclude", "only")


def people_groups(
    records: models.QuerySet[LegacyGradingRecord],
    *,
    search_term: str = "",
    suggestion: str = "",
    set_aside: str = "",
    aside: Iterable[str] = (),
) -> list[PersonGroup]:
    """The people a set of records is about: grouped by the name as written,
    then narrowed - to the names put aside for now (`aside`) or all but them,
    to the names a search finds, and to how clear their suggested students
    are. A person is kept whole: one record a search finds keeps the group.

    A value no group can match (an unknown suggestion, say) matches none, as
    on every list. Suggestions are scored only when they narrow the list; the
    people list scores the page it shows.
    """
    if set_aside and set_aside not in SET_ASIDE_CHOICES:
        return []
    if suggestion and suggestion not in Suggestion.values:
        return []
    groups = group_records(records.order_by("pk"))
    if set_aside:
        kept = set(aside)
        groups = [g for g in groups if (g.key in kept) == (set_aside == "only")]
    if search_term.strip():
        found = set(
            apply_search(records, search_term, ("source_name",)).values_list(
                "pk",
                flat=True,
            ),
        )
        groups = [g for g in groups if any(r.pk in found for r in g.records)]
    if suggestion:
        suggest_for_groups(groups)
        groups = [group for group in groups if group.suggestion == suggestion]
    return groups
