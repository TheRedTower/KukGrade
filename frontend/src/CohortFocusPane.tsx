import type { Ref } from "react";

import { Button } from "./Button";
import { type BoardRow, type StagedDecision, missingRequirements } from "./adjudicationBoard";
import { ResultBadge } from "./StatusBadge";
import { formatTime } from "./dates";
import { labelOf, useChoices } from "./choices";
import { SealedAssessmentEvidence } from "./SealedAssessmentEvidence";
import { CandidateRanks } from "./RankTransition";
import { stickyAside } from "./stickyParts";

interface CohortFocusPaneProps {
  row: BoardRow;
  sessionId: number;
  /** What is staged for this row, if anything. */
  decision: StagedDecision | undefined;
  canStage: boolean;
  recording: boolean;
  evidenceLoaded: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onUpdate: (outcomeId: number, patch: Partial<StagedDecision>) => void;
  onRecord: (outcomeIds: number[]) => void;
}

/** The candidate in focus: their evidence, the proposal, the final decision, and what is staged. */
export function CohortFocusPane({
  row,
  sessionId,
  decision,
  canStage,
  recording,
  evidenceLoaded,
  headingRef,
  onUpdate,
  onRecord,
}: CohortFocusPaneProps) {
  const outcomes = useChoices().outcomes;
  return (
    <aside
      className="card stack stack--4 cab-detail split__aside"
      ref={stickyAside}
      aria-labelledby="cab-focus-title"
      data-testid="cab-detail"
    >
      <p className="outcome-eyebrow eyebrow--muted">In focus</p>
      <h2 id="cab-focus-title" ref={headingRef} tabIndex={-1}>
        {row.candidate.student_display_name}
      </h2>
      <p className="row row--wrap outcome-rank-line subtext">
        <CandidateRanks candidate={row.candidate} />
      </p>

      <SealedAssessmentEvidence
        className="stack stack--2 cab-detail-section"
        assessmentId={row.assessment?.id}
        sessionId={sessionId}
        candidateId={row.candidate.id}
      />

      <section className="stack stack--2 cab-detail-section" aria-labelledby="cab-proposal-title">
        <h3 id="cab-proposal-title">Proposal</h3>
        {row.outcome?.proposed_outcome ? (
          <>
            <p>
              <ResultBadge result={row.outcome.proposed_outcome}>{row.outcome.proposed_outcome_display}</ResultBadge>{" "}
              <span className="subtext">
                {row.outcome.proposed_by_name}
                {row.outcome.proposed_at ? ` · ${formatTime(row.outcome.proposed_at)}` : ""}
              </span>
            </p>
            {row.outcome.proposal_notes && <p>{row.outcome.proposal_notes}</p>}
          </>
        ) : (
          <p className="cab-flags meta">No proposal yet.</p>
        )}
      </section>

      {row.outcome?.status === "FINALISED" && (
        <section className="stack stack--2 cab-detail-section" aria-labelledby="cab-decision-title">
          <h3 id="cab-decision-title">Final decision</h3>
          <p>
            <ResultBadge result={row.outcome.final_outcome}>{row.outcome.final_outcome_display}</ResultBadge>{" "}
            <span className="subtext">
              {row.outcome.decided_by_name}
              {row.outcome.decided_at ? ` · ${formatTime(row.outcome.decided_at)}` : ""}
            </span>
          </p>
          {row.outcome.conditional_requirements && <p>Re-test: {row.outcome.conditional_requirements}</p>}
          {row.outcome.decision_notes && <p>{row.outcome.decision_notes}</p>}
        </section>
      )}

      {decision && row.outcome && (
        <section className="stack stack--2 cab-detail-section" aria-labelledby="cab-staged-title">
          <h3 id="cab-staged-title">Staged: {labelOf(outcomes, decision.outcome)}</h3>
          {decision.outcome === "CONDITIONAL" && (
            <label className="field field--sentence">
              <span>Re-test requirements (required)</span>
              <textarea
                value={decision.conditionalRequirements}
                onChange={(e) => onUpdate(row.outcome!.id, { conditionalRequirements: e.target.value })}
                disabled={!canStage}
                rows={3}
              />
            </label>
          )}
          <label className="field field--sentence">
            <span>Decision notes</span>
            <textarea
              value={decision.notes}
              onChange={(e) => onUpdate(row.outcome!.id, { notes: e.target.value })}
              disabled={!canStage}
              rows={3}
            />
          </label>
          <Button
            variant="secondary"
            className="cab-record-one"
            disabled={recording || missingRequirements(decision) || !evidenceLoaded}
            onClick={() => onRecord([row.outcome!.id])}
          >
            Record decision for {row.candidate.student_first_name}
          </Button>
        </section>
      )}
    </aside>
  );
}
