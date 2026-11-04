/**
 * Instructor outcome proposal, in the Cohort
 * Adjudication Board's language: the instructor reads the same sealed
 * assessment evidence the Master will (`SealedAssessmentEvidence`) and picks
 * from the same Pass / Conditional / Fail segments before proposing. Counts
 * are served, never recounted. Proposing never finalises or
 * promotes; the Master decides on the board.
 */
import { useMutation } from "@tanstack/react-query";
import React, { useState } from "react";

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
import { Dialog } from "./Dialog";
import { ErrorText } from "./ErrorText";
import { RankBelt } from "./Belt";
import { CheckIcon } from "./Icons";
import { OUTCOME_CHOICES } from "./OutcomeControls";
import { useSealedEvidenceLoaded } from "./queries";
import { SealedAssessmentEvidence } from "./SealedAssessmentEvidence";
import "./OutcomeProposalDialog.css";
import { Button } from "./Button";

export function OutcomeProposalDialog({
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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    submitMutation.mutate();
  };

  return (
    <Dialog
      title={candidate.student_display_name}
      eyebrow="Instructor proposal"
      closeLabel="Close proposal"
      onClose={onClose}
      canClose={!isSubmitting}
    >
      <p className="outcome-rank-line">
        <span className="opd-sub">{candidate.student_wksa_id}</span>
        <RankBelt rankId={candidate.from_rank} />
        {candidate.from_rank_name}
        <span aria-hidden="true">→</span>
        <RankBelt rankId={candidate.testing_for_rank} />
        {candidate.testing_for_rank_name}
      </p>

      <form onSubmit={handleSubmit} className="stack">
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
          <label className="field field--sentence"><span>Notes for the Master</span>
            <textarea
              rows={4}
              value={proposalNotes}
              onChange={(event) => setProposalNotes(event.target.value)}
              disabled={isSubmitting}
            />
          </label>
        </div>

        {submitError && (
          <ErrorText field>
            {submitError}
          </ErrorText>
        )}

        <p className="opd-footer-text">
          A proposal does not finalise the grading or promote the candidate. An authorised
          Master records the final decision.
        </p>
        <div className="action-row dialog__actions">
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
        </div>
      </form>
    </Dialog>
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
