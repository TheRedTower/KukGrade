/**
 * Instructor outcome proposal, in the Cohort
 * Adjudication Board's language: the instructor reads the same sealed
 * assessment evidence the Master will (`SealedAssessmentEvidence`) and picks
 * from the same Pass / Conditional / Fail segments before proposing. Counts
 * are served, never recounted. Proposing never finalises or
 * promotes; the Master decides on the board.
 */
import { useMutation } from "@tanstack/react-query";
import React, { useId, useState } from "react";

import {
  errorMessage,
  type CandidateAssessment,
  type CandidateOutcome,
  type CandidateOutcomeOutcome,
  type GradingCandidate,
  createCandidateOutcome,
  getAllCandidateOutcomes,
  proposeCandidateOutcome,
} from "./api";
import { RankBelt } from "./Belt";
import { CheckIcon, CrossIcon } from "./Icons";
import { OUTCOME_CHOICES } from "./OutcomeControls";
import { useSealedEvidenceLoaded } from "./queries";
import { SealedAssessmentEvidence } from "./SealedAssessmentEvidence";
import { useDialogFocus } from "./useDialogFocus";
import "./OutcomeDrawers.css";
import { Button } from "./Button";

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
  // Kept in state so a retry after a refused proposal reuses the outcome the
  // first attempt created instead of creating a second one.
  const [outcomeId, setOutcomeId] = useState(existingOutcome?.id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submitMutation = useMutation({
    mutationFn: async () => {
      // A candidate has no outcome record until the first proposal creates it.
      let id = outcomeId;
      if (id === undefined) {
        id = await createOrFindOutcome(candidate);
        setOutcomeId(id);
      }
      return proposeCandidateOutcome(id, {
        proposed_outcome: selectedOutcome,
        proposal_notes: proposalNotes.trim() || undefined,
      });
    },
    onSuccess: (updated) => onSuccess(updated),
    onError: (err) => setSubmitError(errorMessage(err, "The proposal could not be submitted.")),
  });
  const isSubmitting = submitMutation.isPending;

  const evidenceLoaded = useSealedEvidenceLoaded(assessment?.id);
  const titleId = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>({
    isOpen: true,
    onClose,
    canClose: !isSubmitting,
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    submitMutation.mutate();
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
                    {selectedOutcome === option.value && <CheckIcon size={14} />}
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
            <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting || !evidenceLoaded}
            >
              {isSubmitting ? "Submitting…" : "Submit proposal"}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}

/**
 * The candidate's outcome, created if it does not exist yet. A
 * creation can succeed on the server while its response is lost, or the
 * outcome can have been created since this drawer loaded; either way the
 * retry resumes with that outcome instead of being refused as a duplicate.
 */
async function createOrFindOutcome(candidate: GradingCandidate): Promise<number> {
  try {
    return (await createCandidateOutcome(candidate.id)).id;
  } catch (err) {
    const existing = await getAllCandidateOutcomes({ candidate: candidate.id }).catch(
      () => null,
    );
    const found = existing?.results.find((outcome) => outcome.candidate === candidate.id);
    if (found) return found.id;
    throw err;
  }
}
