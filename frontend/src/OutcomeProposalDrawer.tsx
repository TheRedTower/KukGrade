/**
 * Instructor outcome proposal (SCR-021), restyled under FDR-047 to the Cohort
 * Adjudication Board's language: the instructor reads the same sealed
 * assessment evidence the Master will (`SealedAssessmentEvidence`) and picks
 * from the same Pass / Conditional / Fail segments before proposing. Counts
 * are served, never recounted (FDR-046). Proposing never finalises or
 * promotes; the Master decides on the board.
 */
import React, { useId, useState } from "react";

import {
  ApiError,
  type CandidateAssessment,
  type CandidateOutcome,
  type CandidateOutcomeOutcome,
  type GradingCandidate,
  createCandidateOutcome,
  proposeCandidateOutcome,
} from "./api";
import { RankBelt } from "./Belt";
import { CrossIcon } from "./Icons";
import { OUTCOME_CHOICES } from "./OutcomeControls";
import { SealedAssessmentEvidence } from "./SealedAssessmentEvidence";
import { useDialogFocus } from "./useDialogFocus";
import "./OutcomeDrawers.css";

export function OutcomeProposalDrawer({
  candidate,
  assessment,
  existingOutcome,
  onClose,
  onSuccess,
}: {
  candidate: GradingCandidate;
  assessment?: CandidateAssessment;
  existingOutcome?: CandidateOutcome | null;
  onClose: () => void;
  onSuccess: (outcome: CandidateOutcome) => void;
}): React.ReactElement {
  const [selectedOutcome, setSelectedOutcome] = useState<CandidateOutcomeOutcome>(
    existingOutcome?.proposed_outcome ?? "PASS",
  );
  const [proposalNotes, setProposalNotes] = useState(existingOutcome?.proposal_notes ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const titleId = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>({
    isOpen: true,
    onClose,
    canClose: !isSubmitting,
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      // A candidate has no outcome record until the first proposal creates it.
      const outcomeId = existingOutcome?.id ?? (await createCandidateOutcome(candidate.id)).id;
      const updated = await proposeCandidateOutcome(outcomeId, {
        proposed_outcome: selectedOutcome,
        proposal_notes: proposalNotes.trim() || undefined,
      });
      onSuccess(updated);
    } catch (err: unknown) {
      setSubmitError(
        err instanceof ApiError ? err.message : "The proposal could not be submitted.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="opd-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="opd-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="outcome-proposal-drawer"
      >
        <header className="opd-header">
          <div>
            <p className="outcome-eyebrow">Instructor proposal</p>
            <h2 id={titleId}>{candidate.student_display_name}</h2>
            <p className="opd-sub">{candidate.student_wksa_id}</p>
            <p className="outcome-rank-line">
              <RankBelt rankId={candidate.from_rank} />
              {candidate.from_rank_name}
              <span aria-hidden="true">→</span>
              <RankBelt rankId={candidate.testing_for_rank} />
              {candidate.testing_for_rank_name}
            </p>
          </div>
          <button
            type="button"
            className="opd-close"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close proposal drawer"
          >
            <CrossIcon size={16} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="opd-form">
          <div className="opd-body">
            <SealedAssessmentEvidence
              className="opd-section"
              assessmentId={assessment?.id}
              sessionId={candidate.session}
              candidateId={candidate.id}
            />

            <fieldset className="opd-section opd-fieldset">
              <legend>Proposed outcome</legend>
              <div className="outcome-segments">
                {OUTCOME_CHOICES.map((option) => (
                  <label
                    key={option.value}
                    className={`outcome-segment outcome-segment-${option.value.toLowerCase()}`}
                  >
                    <input
                      type="radio"
                      name="proposed_outcome"
                      value={option.value}
                      checked={selectedOutcome === option.value}
                      onChange={() => setSelectedOutcome(option.value)}
                      disabled={isSubmitting}
                      data-dialog-autofocus={option.value === "PASS" || undefined}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="opd-section">
              <label className="outcome-field">
                Notes for the Master
                <textarea
                  rows={4}
                  value={proposalNotes}
                  onChange={(event) => setProposalNotes(event.target.value)}
                  disabled={isSubmitting}
                />
              </label>
            </div>

            {submitError && (
              <p className="opd-error" role="alert">
                {submitError}
              </p>
            )}
          </div>

          <footer className="opd-footer">
            <p className="opd-footer-text">
              A proposal does not finalise the grading or promote the candidate. An authorised
              Master records the final decision.
            </p>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Submitting…" : "Submit proposal"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
