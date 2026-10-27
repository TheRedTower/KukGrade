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
from collections.abc import Iterable
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from gradings.models import LegacyGradingRecord
from ranks.matching import active_rank_lookup, rank_for_text
from ranks.models import Rank
from students.models import Student

# A sheet note is a cell in no table, not a person (data_imports.ksw_adapter).
SHEET_NOTE_NAME = "Sheet note"

# A rank written before a name ("JKN Alex") is a title, not part of it.
_RANK_PREFIXES = frozenset({"jkn", "ksn", "dbn", "psbn", "sbn", "pkjn", "dahn"})
_CLOSE = 0.8
_MINIMUM_SCORE = 35
_SHOWN = 5


def name_tokens(name: str) -> list[str]:
    """A name as compared: lower-cased words, punctuation and rank titles off."""
    words = re.sub(r"[^\w\s'-]", " ", name.lower()).split()
    while words and words[0] in _RANK_PREFIXES:
        words.pop(0)
    return words


def group_key(name: str) -> str:
    return " ".join(name_tokens(name))


def _close(a: str, b: str) -> bool:
    return a[:1] == b[:1] and SequenceMatcher(None, a, b).ratio() >= _CLOSE


@dataclass(frozen=True)
class Candidate:
    student: Student
    score: int
    reasons: tuple[str, ...]


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
    def suggestion(self) -> str:
        """How clear the suggestion is: one student, a choice, or none."""
        if not self.candidates:
            return "none"
        return "choose" if self.shared else "clear"

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

    if rank_then is not None:
        now = student.current_rank
        if now.order >= rank_then.order:
            score += 10
            reasons.append(f"Rank fits: {now.name} now, {rank_then.name} then")
        else:
            score -= 25
            reasons.append(f"Lower rank now ({now.name}) than then ({rank_then.name})")

    if score < _MINIMUM_SCORE:
        return None
    return Candidate(student=student, score=score, reasons=tuple(reasons))


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

    pool = list(
        students
        if students is not None
        else Student.objects.select_related("current_rank").order_by("pk"),
    )
    ranks = active_rank_lookup()
    for group in groups:
        tokens = name_tokens(group.source_name)
        rank_then = _rank_then(group, ranks)
        scored = [
            candidate
            for student in pool
            if (candidate := score_student(tokens, student, rank_then)) is not None
        ]
        scored.sort(key=lambda candidate: (-candidate.score, candidate.student.pk))
        group.candidates = scored[:_SHOWN]
