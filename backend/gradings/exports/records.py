"""Candidate records: the sealed assessment of the candidates chosen, as PDF.

Everything the sealed record screen shows, one candidate after another, each
starting on a new page and counting its own pages: who they are and what they
were graded for, the outcome, the six core areas, every technique and form
with its result and who marked it, every comment and every changed mark with
its reason, the overall note, what changed after the lock, and a line for the
Master to sign. Never a staged decision, an email address or a date of birth.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from django.conf import settings
from django.db.models import Prefetch, QuerySet
from django.utils import timezone
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Flowable, KeepTogether, Paragraph, Table, TableStyle

from accounts.models import User
from accounts.people import named
from audit.models import AuditAction
from audit.recording import student_label
from gradings.exports import pdf
from gradings.exports.making import (
    Exported,
    audit_export,
    chosen_candidates,
    made_by,
    snapshot,
)
from gradings.models import (
    CandidateAssessment,
    CandidateAssessmentItem,
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
)
from gradings.read_models import assessment_overall, item_remarks
from syllabus.models import CORE_CATEGORIES, age_band_description

NOT_SEALED = "Their assessment is not sealed yet."
KIND = "Grading record"
PROMOTION_PERMISSION = "gradings.view_promotion"


def _assessment(candidate: GradingCandidate) -> CandidateAssessment | None:
    return getattr(candidate, "assessment", None)


def _outcome(candidate: GradingCandidate) -> CandidateOutcome | None:
    return getattr(candidate, "outcome", None)


def record_can_be_downloaded(candidate: GradingCandidate) -> bool:
    """Whether the candidate has a record to download: their assessment is
    sealed. Whatever the session's state, and whether or not they were
    withdrawn afterwards; the file says which."""
    assessment = _assessment(candidate)
    return (
        assessment is not None
        and assessment.status == CandidateAssessment.Status.COMPLETED
    )


def _refusal(candidate: GradingCandidate) -> str | None:
    return None if record_can_be_downloaded(candidate) else NOT_SEALED


def _candidates() -> QuerySet[GradingCandidate]:
    items = CandidateAssessmentItem.objects.select_related("assessor").prefetch_related(
        *item_remarks()
    )
    return GradingCandidate.objects.select_related(
        "student",
        "from_rank",
        "testing_for_rank",
        "assessment__generated_by",
        "outcome__proposed_by",
        "outcome__decided_by",
        "promotion__to_rank",
    ).prefetch_related(
        Prefetch("assessment__items", queryset=items.order_by("position", "pk"))
    )


def export_records(
    session: GradingSession,
    candidate_ids: list[int],
    actor: User,
) -> Exported:
    """The records of the candidates chosen, as one PDF, all or nothing;
    one audit event for the file, naming everyone in it by WKSA ID."""
    with snapshot():
        current = GradingSession.objects.get(pk=session.pk)
        candidates = chosen_candidates(
            current,
            candidate_ids,
            _candidates(),
            _refusal,
        )
        shows_promotion = actor.has_perm(PROMOTION_PERMISSION)
        document = pdf.Document(
            file_name=_file_name(current, candidates),
            kind=KIND,
            made_by=made_by(actor),
            parts=[
                _part(current, candidate, shows_promotion=shows_promotion)
                for candidate in candidates
            ],
            demo=settings.DEMO_MODE,
        )
        content = pdf.build(document, made_at=timezone.now())
        _audit(current, candidates, actor)
    return Exported(document, content)


def _file_name(session: GradingSession, candidates: list[GradingCandidate]) -> str:
    if len(candidates) == 1:
        return pdf.file_name(
            session.grading_date,
            session.title,
            "Record",
            candidates[0].student.full_name,
        )
    return pdf.file_name(
        session.grading_date, session.title, f"Records ({len(candidates)})"
    )


def _audit(
    session: GradingSession,
    candidates: list[GradingCandidate],
    actor: User,
) -> None:
    if len(candidates) == 1:
        held = f"Record of {student_label(candidates[0].student)}"
    else:
        held = f"Records of {len(candidates)} candidates"
    audit_export(
        AuditAction.RECORDS_DOWNLOADED,
        session,
        f"{held} downloaded as a PDF from grading session '{session.title}'.",
        candidates,
        actor,
    )


# The record's state, stamped at its head and named at the foot of each page.
FINAL = ("FINAL RECORD", "Final record")
PROVISIONAL = ("PROVISIONAL", "Provisional")
WITHDRAWN = ("WITHDRAWN", "Withdrawn")


def _state(candidate: GradingCandidate) -> tuple[str, str]:
    if candidate.status == GradingCandidate.Status.WITHDRAWN:
        return WITHDRAWN
    outcome = _outcome(candidate)
    if outcome is not None and outcome.status == CandidateOutcome.Status.FINALISED:
        return FINAL
    return PROVISIONAL


def _part(
    session: GradingSession,
    candidate: GradingCandidate,
    *,
    shows_promotion: bool,
) -> pdf.Part:
    assessment = _assessment(candidate)
    assert assessment is not None  # chosen_candidates refused any without one
    items = list(assessment.items.all())
    stamp, state = _state(candidate)
    student = candidate.student
    story: list[Flowable] = [
        pdf.title_block(
            [
                pdf.paragraph(student.full_name, pdf.TITLE),
                pdf.paragraph(
                    f"{candidate.from_rank.name} → {candidate.testing_for_rank.name}"
                    f" · {session.title}"
                ),
            ],
            stamp,
        ),
        pdf.gap(),
        pdf.facts(_identity(session, candidate, assessment)),
        pdf.paragraph("Outcome", pdf.HEADING),
        pdf.facts(_outcome_rows(candidate, shows_promotion=shows_promotion)),
    ]
    core = [item for item in items if item.category in CORE_CATEGORIES]
    if core:
        story += [
            pdf.paragraph("Core grading areas", pdf.HEADING),
            _core_table(core),
            *_core_remarks(core),
        ]
    story += [pdf.gap(1.5 * mm), pdf.paragraph(_counts(assessment), pdf.NOTE)]
    for heading, group in _ledgers(items):
        story += [pdf.paragraph(heading, pdf.HEADING), _ledger_table(group)]
    story += [
        pdf.paragraph("Overall note", pdf.HEADING),
        pdf.paragraph(assessment.notes or "No overall note was recorded."),
        pdf.paragraph("Changes after the lock", pdf.HEADING),
        *_after_lock(items),
        pdf.gap(8 * mm),
        pdf.signature(_master(candidate)),
    ]
    return pdf.Part(
        heading=f"{student.full_name} · {student.wksa_id}",
        state=state,
        story=story,
    )


def _identity(
    session: GradingSession,
    candidate: GradingCandidate,
    assessment: CandidateAssessment,
) -> list[tuple[str, object]]:
    held = " · ".join(
        part for part in (pdf.day(session.grading_date), session.location) if part
    )
    prepared = pdf.day(assessment.generated_at.date())
    preparer = named(assessment.generated_by, assessment.generated_by_title)
    rows: list[tuple[str, object]] = [
        ("WKSA ID", candidate.student.wksa_id),
        ("Age band", age_band_description(candidate.age_band)),
        ("Rank held", candidate.from_rank.name),
        ("Testing for", candidate.testing_for_rank.name),
        ("Grading", session.title),
        ("Date and place", held),
        ("Form prepared", f"{prepared} by {preparer}" if preparer else prepared),
    ]
    if assessment.completed_at is not None:
        rows.append(("Sealed", pdf.moment(assessment.completed_at)))
    return rows


def _outcome_rows(
    candidate: GradingCandidate,
    *,
    shows_promotion: bool,
) -> list[tuple[str, object]]:
    outcome = _outcome(candidate)
    rows: list[tuple[str, object]] = []
    if candidate.status == GradingCandidate.Status.WITHDRAWN:
        rows.append(("Withdrawn", _withdrawal(candidate)))
        if candidate.withdrawal_note:
            rows.append(("Withdrawal note", candidate.withdrawal_note))
    if outcome is not None and outcome.final_outcome:
        decided = named(outcome.decided_by, outcome.decided_by_title)
        rows.append(
            (
                "Final decision",
                _who_when(
                    outcome.get_final_outcome_display(), outcome.decided_at, decided
                ),
            )
        )
        if outcome.conditional_requirements:
            rows.append(("Still required", outcome.conditional_requirements))
        if outcome.decision_notes:
            rows.append(("Decision note", outcome.decision_notes))
    else:
        rows.append(("Final decision", "No final decision recorded"))
    if outcome is not None and outcome.proposed_outcome:
        proposer = named(outcome.proposed_by, outcome.proposed_by_title)
        rows.append(
            (
                "Proposal",
                _who_when(
                    outcome.get_proposed_outcome_display(),
                    outcome.proposed_at,
                    proposer,
                ),
            )
        )
        if outcome.proposal_notes:
            rows.append(("Proposal note", outcome.proposal_notes))
    else:
        rows.append(("Proposal", "No proposal recorded"))
    if shows_promotion:
        rows.append(("Promotion", _promotion(candidate, outcome)))
    return rows


def _withdrawal(candidate: GradingCandidate) -> str:
    reason = candidate.get_withdrawal_reason_display() or "Withdrawn"
    if candidate.withdrawn_at is None:
        return str(reason)
    return f"{reason} · {pdf.moment(candidate.withdrawn_at)}"


def _who_when(what: object, when: datetime | None, who: str) -> str:
    return " · ".join(
        str(part) for part in (what, when and pdf.moment(when), who) if part
    )


def _promotion(candidate: GradingCandidate, outcome: CandidateOutcome | None) -> str:
    promotion = getattr(candidate, "promotion", None)
    if promotion is not None:
        return f"{promotion.to_rank.name}, from {pdf.day(promotion.effective_date)}"
    if outcome is not None and outcome.final_outcome == CandidateOutcome.Outcome.PASS:
        return "Not promoted yet"
    return "Not promoted"


def _counts(assessment: CandidateAssessment) -> str:
    overall = assessment_overall(assessment)
    counted = [
        f"{overall['met']} of {overall['total']} requirements met",
        f"{overall['not_met']} not met",
    ]
    if overall["not_assessed"]:
        counted.append(f"{overall['not_assessed']} not assessed")
    return " · ".join(counted)


_CORE_COLUMNS = 6


def _core_table(core: list[CandidateAssessmentItem]) -> Table:
    """The six core areas side by side, as on the paper form."""
    cells: list[list[Flowable]] = [
        [
            pdf.bold(item.item_name, pdf.SMALL),
            pdf.paragraph(item.korean_name, pdf.SMALL),
            pdf.paragraph(item.get_result_display(), pdf.SMALL),
        ]
        for item in core
    ]
    rows = [
        cells[start : start + _CORE_COLUMNS]
        for start in range(0, len(cells), _CORE_COLUMNS)
    ]
    rows[-1] += [[]] * (_CORE_COLUMNS - len(rows[-1]))
    table = Table(rows, colWidths=[pdf.WIDTH / _CORE_COLUMNS] * _CORE_COLUMNS)
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), pdf.HAIRLINE, pdf.RULE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ],
        ),
    )
    return table


_REMARK = ParagraphStyle("remark", parent=pdf.SMALL, leftIndent=10)


def _core_remarks(core: list[CandidateAssessmentItem]) -> list[Flowable]:
    """Every comment and changed mark on a core area, under the core table:
    the record screen lists them as it does any other requirement's."""
    story: list[Flowable] = []
    for item in core:
        remarks = _remark_list(item)
        if not remarks:
            continue
        story += [
            pdf.gap(1.5 * mm),
            KeepTogether(
                [
                    _requirement(item),
                    pdf.paragraph(_remark_text(remarks[0]), _REMARK),
                ]
            ),
            *(pdf.paragraph(_remark_text(remark), _REMARK) for remark in remarks[1:]),
        ]
    return story


def _ledgers(
    items: list[CandidateAssessmentItem],
) -> list[tuple[str, list[CandidateAssessmentItem]]]:
    """Everything that is not a core area, one ledger per category under its
    own name, in the order the assessment first reaches each - as the record
    screen groups them, so a Weapons or Other requirement is never missed."""
    groups: dict[str, tuple[str, list[CandidateAssessmentItem]]] = {}
    for item in items:
        if item.category in CORE_CATEGORIES:
            continue
        heading = str(item.get_category_display())
        _heading, group = groups.setdefault(item.category, (heading, []))
        group.append(item)
    return list(groups.values())


_LEDGER_WIDTHS = [pdf.WIDTH - 98 * mm, 30 * mm, 24 * mm, 44 * mm]


def _ledger_table(group: list[CandidateAssessmentItem]) -> Table:
    """One row per requirement - its numbers, result and who marked it - with
    every comment and changed mark under it. The header repeats on each page,
    and a requirement is kept on the page of its first remark."""
    rows: list[list[object]] = [
        [
            pdf.paragraph(label, pdf.LABEL)
            for label in ("Requirement", "Numbers", "Result", "Marked by")
        ],
    ]
    style: list[Any] = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), pdf.HAIRLINE, pdf.INK),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]
    for item in group:
        start = len(rows)
        rows.append(
            [
                _requirement(item),
                pdf.paragraph(item.display_range or item.notation, pdf.SMALL),
                pdf.paragraph(item.get_result_display(), pdf.SMALL),
                pdf.paragraph(named(item.assessor, item.assessor_title), pdf.SMALL),
            ]
        )
        for remark in _remarks(item):
            row = len(rows)
            rows.append([remark, "", "", ""])
            style.append(("SPAN", (0, row), (-1, row)))
            style.append(("LEFTPADDING", (0, row), (-1, row), 10))
        end = len(rows) - 1
        style.append(("NOSPLIT", (0, start), (-1, min(end, start + 1))))
        style.append(("LINEBELOW", (0, end), (-1, end), pdf.HAIRLINE, pdf.RULE))
    table = Table(rows, colWidths=_LEDGER_WIDTHS, repeatRows=1, splitInRow=1)
    table.setStyle(TableStyle(style))
    return table


def _requirement(item: CandidateAssessmentItem) -> Paragraph:
    text = f"<b>{pdf.markup(item.item_name)}</b>"
    if item.korean_name:
        text += f" {pdf.markup(item.korean_name)}"
    if not item.required:
        text += " · optional"
    return Paragraph(text, pdf.SMALL)


@dataclass(frozen=True)
class _Remark:
    at: datetime
    text: str
    by: str
    after_lock: bool


def _remark_list(item: CandidateAssessmentItem) -> list[_Remark]:
    """Every comment, and every change of mark that carries a reason (any
    after the first mark, and any made after the lock), oldest first - what
    the record screen lists under a requirement."""
    remarks = [
        _Remark(
            change.changed_at,
            f"Changed from {change.get_from_result_display()} to "
            f"{change.get_to_result_display()}: “{change.reason}”",
            named(change.changed_by, change.changed_by_title),
            change.after_lock,
        )
        for change in item.changes.all()
        if change.sequence > 1 or change.after_lock
    ]
    remarks += [
        _Remark(
            comment.created_at,
            f"“{comment.body}”",
            named(comment.author, comment.author_title),
            comment.after_lock,
        )
        for comment in item.comments.all()
    ]
    return sorted(remarks, key=lambda remark: remark.at)


def _remark_text(remark: _Remark) -> str:
    lock = ", after the lock" if remark.after_lock else ""
    return f"{remark.text} — {remark.by}, {pdf.moment(remark.at)}{lock}"


def _remarks(item: CandidateAssessmentItem) -> list[Paragraph]:
    return [
        pdf.paragraph(_remark_text(remark), pdf.SMALL) for remark in _remark_list(item)
    ]


def _after_lock(items: list[CandidateAssessmentItem]) -> list[Paragraph]:
    """What was written or changed once the session was locked, by the
    authorised Master, requirement by requirement."""
    lines = [
        pdf.paragraph(f"{item.item_name}: {_remark_text(remark)}", pdf.SMALL)
        for item in items
        for remark in _remark_list(item)
        if remark.after_lock
    ]
    return lines or [pdf.paragraph("None.")]


def _master(candidate: GradingCandidate) -> str:
    outcome = _outcome(candidate)
    if outcome is None or outcome.decided_by is None:
        return ""
    return named(outcome.decided_by, outcome.decided_by_title)
