"""Suggested students for historical records - suggestions only, never links.

The club's workbook names people the way an instructor writes on the mat:
"Tom W", "Kai P", "Rhia", "JKN Kai", and the same person as "Odin"
one quarter and "Odin Varga" the next. There are no WKSA IDs. So records
are grouped by the name as written, and each group gets the students it most
plausibly means, with the reasons in plain words, for a person to confirm.

A suggestion weighs the first name (the same, or close - the workbook has
"Jonathon" for Jonathan), any surname or initial given (a surname that
contradicts rules a student out), and whether the student's rank now fits
the rank the record gave them then (nobody goes down a grade). When several
students fit equally well, that is said rather than one picked.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Protocol

from django.db import models

from gradings.models import LegacyOutcome
from ranks.matching import RANK_TITLES
from ranks.models import Rank
from students.models import Student

_CLOSE = 0.8
_MINIMUM_SCORE = 35
_SHOWN = 5


def name_tokens(name: str) -> list[str]:
    """A name as compared: lower-cased words, punctuation, rank titles and
    anything in brackets off ("Kit (White Belt)" is Kit)."""
    unbracketed = re.sub(r"\([^)]*\)?", " ", name.lower())
    words = re.sub(r"[^\w\s'-]", " ", unbracketed).split()
    # A rank written before a name ("JKN Kai") is a title, not part of it.
    while words and words[0] in RANK_TITLES:
        words.pop(0)
    return words


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


def _shortened(a: str, b: str) -> bool:
    """One first name the start of the other, of three letters or more
    ("Ben", "Benjamin")."""
    short, long = sorted((a, b), key=len)
    return len(short) >= 3 and long.startswith(short)


def _surnames_alike(a: str, b: str) -> bool:
    """The same surname, spelt alike, or one part of a double-barrelled one
    ("Hart", "Lund-Hart")."""
    if _spelt_alike(a.replace("-", " "), b.replace("-", " ")):
        return True
    # The surname is the last word: only its parts are compared, never a
    # middle name both happen to give.
    last_a, last_b = a.split()[-1], b.split()[-1]
    if "-" not in last_a and "-" not in last_b:
        return False
    return any(
        _spelt_alike(part, other)
        for part in last_a.split("-")
        for other in last_b.split("-")
        if part and other
    )


def names_compatible(first: Sequence[str], second: Sequence[str]) -> bool:
    """Whether two names as written, each as its name_tokens, could be the
    same person.

    The first names are the same or spelt alike - or one is the other
    shortened ("Ben", "Benjamin"), when both give a surname. The rest is
    missing on one side ("Omar", "Omar Haddad"), the same, spelt alike, one
    part of a double-barrelled surname, or an initial that matches ("Finn C",
    "Fin Cole").
    """
    if not first or not second:
        return False
    rest_a, rest_b = " ".join(first[1:]), " ".join(second[1:])
    if not _spelt_alike(first[0], second[0]) and not (
        rest_a and rest_b and _shortened(first[0], second[0])
    ):
        return False
    if not rest_a or not rest_b:
        return True
    if min(len(rest_a), len(rest_b)) == 1:
        return rest_a[0] == rest_b[0]
    return _surnames_alike(rest_a, rest_b)


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


class RankLike(Protocol):
    """A rank as the matching needs it: a Rank, or one in a migration."""

    @property
    def name(self) -> str: ...

    @property
    def order(self) -> int: ...


def leaves_at[R: RankLike](
    outcome: str | None,
    held: R | None,
    testing: R | None,
) -> R | None:
    """The lowest rank a record leaves someone at: the rank passed to, or
    the rank held. A rank tested for and not passed was not reached."""
    if outcome == LegacyOutcome.PASS and testing is not None:
        return testing
    return held


def rank_fit(student: Student, rank_then: Rank | None) -> tuple[bool | None, str]:
    """Whether a student's rank now fits the rank the records gave then, and
    why in plain words: nobody goes down a grade. (None, "") when the records
    give no rank."""
    if rank_then is None:
        return None, ""
    now = student.current_rank
    if now.order >= rank_then.order:
        return True, f"Rank fits: {now.name} now, {rank_then.name} then"
    return False, f"Lower rank now ({now.name}) than then ({rank_then.name})"


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

    rank_fits, rank_reason = rank_fit(student, rank_then)
    if rank_fits is not None:
        score += 10 if rank_fits else -25
        reasons.append(rank_reason)

    if score < _MINIMUM_SCORE:
        return None
    return Candidate(
        student=student,
        score=score,
        reasons=tuple(reasons),
        rank_fits=rank_fits,
    )


def student_pool() -> list[Student]:
    """Every student a record could be about, read once for many names."""
    return list(
        Student.objects.filter(deleted_at__isnull=True)
        .select_related("current_rank")
        .order_by("pk"),
    )


class StudentPool:
    """Students by what score_student first compares - the first name's
    first letter, and the surname, for a name written surname first - so a
    name is scored only against the students it could be."""

    def __init__(self, students: Iterable[Student]) -> None:
        self._by_initial: dict[str, list[Student]] = {}
        self._by_surname: dict[str, list[Student]] = {}
        for student in students:
            self._by_initial.setdefault(student.first_name.lower()[:1], []).append(
                student,
            )
            self._by_surname.setdefault(student.last_name.lower(), []).append(student)

    def could_be(self, tokens: Sequence[str]) -> list[Student]:
        """The students a name, as its name_tokens, could be, by id."""
        if not tokens:
            return []
        found = {
            student.pk: student
            for student in (
                *self._by_initial.get(tokens[0][:1], []),
                *self._by_surname.get(tokens[0], []),
            )
        }
        return [found[pk] for pk in sorted(found)]


def best_candidates(
    tokens: list[str],
    rank_then: Rank | None,
    pool: StudentPool,
) -> list[Candidate]:
    """The students in `pool` that fit a name best, best first."""
    scored = [
        candidate
        for student in pool.could_be(tokens)
        if (candidate := score_student(tokens, student, rank_then)) is not None
    ]
    scored.sort(key=lambda candidate: (-candidate.score, candidate.student.pk))
    return scored[:_SHOWN]
