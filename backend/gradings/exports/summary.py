"""The session summary: who passed and who did not, for promotion day.

Declarative only, on one page for a normal session: every candidate graded
in the grading's order with their decision and promotion, those not graded
and why, and how many passed to each rank (every rank counted on its own,
stripes too), with what is not counted said in a line. Provisional while the
session is locked, final once it is completed.
"""

from __future__ import annotations

from collections import Counter

from django.conf import settings
from django.core.exceptions import ValidationError
from django.utils import timezone
from reportlab.lib.units import mm
from reportlab.platypus import Flowable, Paragraph, Table, TableStyle

from accounts.models import User
from audit.models import AuditAction
from gradings.exports import pdf
from gradings.exports.making import Exported, audit_export, made_by, snapshot
from gradings.models import (
    CandidateOutcome,
    GradingCandidate,
    GradingSession,
    candidate_order,
)
from ranks.models import Rank

KIND = "Grading summary"
PROMOTION_PERMISSION = "gradings.view_promotion"
SUMMARY_STATUSES = frozenset(
    {GradingSession.Status.LOCKED, GradingSession.Status.COMPLETED},
)
NOT_YET = "A summary is made once the grading is locked."
AWAITING = "Awaiting decision"


def summary_can_be_downloaded(session: GradingSession) -> bool:
    """Locked (provisional) or completed (final), archived or not."""
    return session.status in SUMMARY_STATUSES


def export_summary(session: GradingSession, actor: User) -> Exported:
    """The session's summary as a PDF; one audit event for the file."""
    with snapshot():
        current = GradingSession.objects.get(pk=session.pk)
        if not summary_can_be_downloaded(current):
            raise ValidationError({"session": [NOT_YET]})
        candidates = list(
            GradingCandidate.objects.filter(session=current)
            .select_related(
                "student", "from_rank", "testing_for_rank", "outcome", "promotion"
            )
            .order_by(*candidate_order())
        )
        final = current.status == GradingSession.Status.COMPLETED
        document = pdf.Document(
            file_name=pdf.file_name(current.grading_date, current.title, "Summary"),
            kind=KIND,
            made_by=made_by(actor),
            parts=[
                pdf.Part(
                    heading=current.title,
                    state="Final" if final else "Provisional",
                    story=_story(
                        current,
                        candidates,
                        final=final,
                        shows_promotion=actor.has_perm(PROMOTION_PERMISSION),
                    ),
                ),
            ],
            demo=settings.DEMO_MODE,
        )
        content = pdf.build(document, made_at=timezone.now())
        audit_export(
            AuditAction.SUMMARY_DOWNLOADED,
            current,
            f"Summary of grading session '{current.title}' downloaded as a PDF.",
            candidates,
            actor,
        )
    return Exported(document, content)


def _outcome(candidate: GradingCandidate) -> CandidateOutcome | None:
    return getattr(candidate, "outcome", None)


def _final(candidate: GradingCandidate) -> str | None:
    outcome = _outcome(candidate)
    return outcome.final_outcome if outcome is not None else None


def _story(
    session: GradingSession,
    candidates: list[GradingCandidate],
    *,
    final: bool,
    shows_promotion: bool,
) -> list[Flowable]:
    withdrawn = GradingCandidate.Status.WITHDRAWN
    graded = [c for c in candidates if c.status != withdrawn]
    not_graded = [c for c in candidates if c.status == withdrawn]
    awaiting = sum(1 for c in graded if _final(c) is None)
    if final:
        state = "Completed"
    else:
        state = f"Locked, {awaiting} {_decisions(awaiting)} still to be recorded"
    held = " · ".join(
        part for part in (pdf.day(session.grading_date), session.location) if part
    )
    story: list[Flowable] = [
        pdf.title_block(
            [
                pdf.paragraph(session.title, pdf.TITLE),
                pdf.paragraph(held),
                pdf.paragraph(state, pdf.NOTE),
            ],
            "FINAL" if final else "PROVISIONAL",
        ),
        pdf.gap(),
    ]
    if graded:
        story.append(_table(graded, shows_promotion=shows_promotion))
    else:
        story.append(pdf.paragraph("Nobody was graded."))
    story += [
        pdf.paragraph("Not graded", pdf.HEADING),
        *_not_graded(not_graded),
        pdf.paragraph("Passes by rank achieved", pdf.HEADING),
        *_passes(graded, len(not_graded), awaiting),
        pdf.gap(8 * mm),
        pdf.signature(""),
    ]
    return story


def _decisions(count: int) -> str:
    return "decision" if count == 1 else "decisions"


def _decision(candidate: GradingCandidate) -> Paragraph:
    outcome = _outcome(candidate)
    if outcome is None or outcome.final_outcome is None:
        return pdf.paragraph(AWAITING, pdf.SMALL)
    shown = outcome.get_final_outcome_display()
    if outcome.final_outcome == CandidateOutcome.Outcome.PASS:
        return pdf.bold(shown, pdf.SMALL)
    return pdf.paragraph(shown, pdf.SMALL)


def _promoted(candidate: GradingCandidate) -> str:
    promotion = getattr(candidate, "promotion", None)
    if promotion is not None:
        return f"{candidate.testing_for_rank.name}, {pdf.day(promotion.effective_date)}"
    final = _final(candidate)
    if final is None:
        return "—"
    if final == CandidateOutcome.Outcome.PASS:
        return "Not promoted yet"
    return "Not promoted"


def _table(graded: list[GradingCandidate], *, shows_promotion: bool) -> Table:
    labels = ["#", "Candidate", "WKSA ID", "Rank held", "Testing for", "Decision"]
    widths = [8 * mm, 42 * mm, 22 * mm, 24 * mm, 24 * mm, 24 * mm]
    if shows_promotion:
        labels.append("Promoted")
        widths.append(pdf.WIDTH - sum(widths))
    else:
        widths[1] += pdf.WIDTH - sum(widths)
    rows: list[list[object]] = [[pdf.paragraph(label, pdf.LABEL) for label in labels]]
    for number, candidate in enumerate(graded, 1):
        row: list[object] = [
            pdf.paragraph(number, pdf.SMALL),
            pdf.paragraph(candidate.student.full_name, pdf.SMALL),
            pdf.paragraph(candidate.student.wksa_id, pdf.SMALL),
            pdf.paragraph(candidate.from_rank.name, pdf.SMALL),
            pdf.paragraph(candidate.testing_for_rank.name, pdf.SMALL),
            _decision(candidate),
        ]
        if shows_promotion:
            row.append(pdf.paragraph(_promoted(candidate), pdf.SMALL))
        rows.append(row)
    table = Table(rows, colWidths=widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, 0), pdf.HAIRLINE, pdf.INK),
                ("LINEBELOW", (0, 1), (-1, -1), pdf.HAIRLINE, pdf.RULE),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ],
        ),
    )
    return table


def _not_graded(withdrawn: list[GradingCandidate]) -> list[Paragraph]:
    """Each withdrawn candidate and no-show, with why."""
    if not withdrawn:
        return [pdf.paragraph("None.")]
    lines = []
    for candidate in withdrawn:
        why = candidate.get_withdrawal_reason_display() or "Withdrawn"
        if candidate.withdrawal_note:
            why = f"{why}: {candidate.withdrawal_note}"
        lines.append(
            pdf.paragraph(
                f"{candidate.student.full_name} · {candidate.student.wksa_id} · "
                f"{candidate.from_rank.name} → {candidate.testing_for_rank.name} · "
                f"{why}",
                pdf.SMALL,
            )
        )
    return lines


def _passes(
    graded: list[GradingCandidate], withdrawn: int, awaiting: int
) -> list[Flowable]:
    """How many passed to each rank, lowest first, every rank on its own;
    then the decisions that are not passes, so the counts add up."""
    passed: Counter[Rank] = Counter(
        candidate.testing_for_rank
        for candidate in graded
        if _final(candidate) == CandidateOutcome.Outcome.PASS
    )
    lines: list[Flowable] = [
        pdf.paragraph(f"{rank.name}: {count}", pdf.SMALL)
        for rank, count in sorted(passed.items(), key=lambda pair: pair[0].order)
    ]
    lines.append(pdf.bold(f"Total: {sum(passed.values())}", pdf.SMALL))
    finals = Counter(_final(candidate) for candidate in graded)
    others = [
        f"{label} {finals[value]}"
        for value, label in CandidateOutcome.Outcome.choices
        if value != CandidateOutcome.Outcome.PASS
    ]
    others += [f"Withdrawn {withdrawn}", f"{AWAITING} {awaiting}"]
    lines.append(pdf.paragraph(f"Not counted above: {' · '.join(others)}", pdf.NOTE))
    return lines
