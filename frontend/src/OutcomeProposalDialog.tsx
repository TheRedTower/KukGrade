/**
 * Instructor outcome proposal, in the Cohort
 * Adjudication Board's language: the instructor reads the same sealed
 * assessment evidence the Master will (`SealedAssessmentEvidence`) and picks
 * from the same Pass / Conditional / Fail segments before proposing. Counts
 * are served, never recounted. Proposing never finalises or
 * promotes; the Master decides on the board.
 */
import { buttonClass } from "./buttonClass";
import { outcomeTone } from "./badgeClass";
import { useMutation } from "@tanstack/react-query";
import React, { useState } from "react";

import {
  errorMessage,
  type CandidateAssessment,
  type CandidateOutcome,
  type CandidateOutcomeOutcome,
  type GradingCandidate,
  proposeCandidateOutcome,
} from "./api";
import { Dialog } from "./Dialog";
import { ErrorText } from "./ErrorText";
import { CheckIcon } from "./Icons";
import { useChoices } from "./choices";
import "./OutcomeControls.css";
import { useSealedEvidenceLoaded } from "./queries";
import { SealedAssessmentEvidence } from "./SealedAssessmentEvidence";
import "./OutcomeProposalDialog.css";
import { Button } from "./Button";
import { CandidateRanks } from "./RankTransition";

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
  const outcomes = useChoices().outcomes;
  const [proposalNotes, setProposalNotes] = useState(existingOutcome?.proposal_notes ?? "");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submitMutation = useMutation({
    // The first proposal opens the candidate's outcome record; a retry or a
    // revision lands on the same one.
    mutationFn: () =>
      proposeCandidateOutcome(candidate.id, {
        proposed_outcome: selectedOutcome,
        proposal_notes: proposalNotes.trim() || undefined,
      }),
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
      <p className="row row--wrap outcome-rank-line subtext">
        <span className="opd-sub">{candidate.student_wksa_id}</span>
        <CandidateRanks candidate={candidate} />
      </p>

      <form onSubmit={handleSubmit} className="stack">
        <SealedAssessmentEvidence
          className="opd-section"
          assessmentId={assessment?.id}
          sessionId={candidate.session}
          candidateId={candidate.id}
        />

        <fieldset className="opd-section stack stack--2 opd-fieldset">
          <legend>Proposed outcome</legend>
          <div className="outcome-segments">
            {outcomes.map((option) => (
              <label
                key={option.value}
                className={buttonClass({ small: true }, "outcome-segment")}
                data-tone={selectedOutcome === option.value ? outcomeTone(option.value) : undefined}
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
          <label className="field field--sentence">
            <span>Notes for the Master</span>
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

        <p className="opd-footer-text subtext">
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
