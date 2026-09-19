import React, { useState, useEffect, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CandidateAssessment,
  CandidateOutcome,
  CandidateOutcomeOutcome,
  GradingCandidate,
  getAllCandidateAssessmentItems,
  createCandidateOutcome,
  proposeCandidateOutcome,
} from "./api";
import { RankVisual } from "./GradingSessionDetailScreen";

export interface OutcomeProposalDrawerProps {
  candidate: GradingCandidate;
  assessment?: CandidateAssessment;
  existingOutcome?: CandidateOutcome | null;
  currentRankName: string;
  targetRankName: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (outcome: CandidateOutcome) => void;
}

export function OutcomeProposalDrawer({
  candidate,
  assessment,
  existingOutcome,
  currentRankName,
  targetRankName,
  isOpen,
  onClose,
  onSuccess,
}: OutcomeProposalDrawerProps): React.ReactElement | null {
  const [selectedOutcome, setSelectedOutcome] = useState<CandidateOutcomeOutcome>(
    (existingOutcome?.proposed_outcome as CandidateOutcomeOutcome) || "PASS",
  );
  const [proposalNotes, setProposalNotes] = useState<string>(
    existingOutcome?.proposal_notes || "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const titleId = useId();
  const notesId = useId();


  // Handle escape key and body overflow lock
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  // Fetch assessment items to calculate completion and met/not-met stats
  const { data: assessmentItemsData, isLoading: isLoadingItems } = useQuery({
    queryKey: ["candidateAssessmentItems", assessment?.id],
    queryFn: () =>
      getAllCandidateAssessmentItems({ assessment: assessment?.id }),
    enabled: isOpen && !!assessment?.id,
    staleTime: 10_000,
  });

  if (!isOpen) {
    return null;
  }

  const items = assessmentItemsData?.results || [];
  const totalRequired = items.filter((i) => i.required).length;
  const requiredMet = items.filter((i) => i.required && i.result === "MET").length;
  const notMet = items.filter((i) => i.result === "NOT_MET").length;
  const percentMet = totalRequired > 0 ? Math.round((requiredMet / totalRequired) * 100) : 100;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOutcome) {
      setSubmitError("Please select a proposed outcome.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      let outcomeId = existingOutcome?.id;

      // If an outcome record has not yet been initialized for this candidate, create it first
      if (!outcomeId) {
        const created = await createCandidateOutcome(candidate.id);
        outcomeId = created.id;
      }

      const updated = await proposeCandidateOutcome(outcomeId, {
        proposed_outcome: selectedOutcome,
        proposal_notes: proposalNotes.trim() || undefined,
      });

      onSuccess(updated);
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError("An unexpected error occurred while submitting the proposal.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="opd-overlay"
      data-testid="opd-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="opd-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="outcome-proposal-drawer"
      >
        {/* ── Drawer Header / Candidate Context Banner ───────────────────────── */}
        <header className="opd-header">
          <div className="opd-header-main">
            <div className="opd-header-titles">
              <span className="opd-header-eyebrow">Instructor Proposal (SCR-021)</span>
              <h2 id={titleId} className="opd-header-title">
                Propose Candidate Outcome
              </h2>
            </div>
            <button
              type="button"
              className="opd-close-btn"
              onClick={onClose}
              aria-label="Close proposal drawer"
              data-testid="opd-close-btn"
            >
              ✕
            </button>
          </div>

          <div className="opd-candidate-banner" data-testid="opd-candidate-banner">
            <div className="opd-candidate-meta">
              <span className="opd-candidate-name">
                {candidate.student_display_name}
              </span>
              {candidate.student_wksa_id && (
                <span className="opd-candidate-wksa">
                  WKSA: {candidate.student_wksa_id}
                </span>
              )}
            </div>

            <div className="opd-rank-progression" aria-label="Rank progression">
              <div className="opd-rank-chip" title={`Current Rank: ${currentRankName}`}>
                <RankVisual rankName={currentRankName} />
                <span>{currentRankName}</span>
              </div>
              <span className="opd-rank-arrow" aria-hidden="true">→</span>
              <div className="opd-rank-chip opd-rank-chip-target" title={`Grading for: ${targetRankName}`}>
                <RankVisual rankName={targetRankName} />
                <span>{targetRankName}</span>
              </div>
            </div>
          </div>
        </header>

        {/* ── Drawer Content ─────────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} className="opd-form">
          <div className="opd-body">
            {submitError && (
              <div className="opd-error-banner" role="alert" data-testid="opd-error-banner">
                <span className="opd-error-icon" aria-hidden="true">⚠</span>
                <span>{submitError}</span>
              </div>
            )}

            {/* ── Assessment Completion Summary Card ───────────────────────── */}
            <section
              className="opd-assessment-card"
              aria-label="Assessment summary"
              data-testid="opd-assessment-summary"
            >
              <div className="opd-assessment-icon-box" aria-hidden="true">
                ✓
              </div>
              <div className="opd-assessment-content">
                <div className="opd-assessment-title">Assessment complete</div>
                <div className="opd-assessment-stats">
                  {isLoadingItems ? (
                    <span className="opd-assessment-loading">Calculating requirement stats...</span>
                  ) : (
                    <>
                      <span className="opd-stat-met">
                        {totalRequired > 0 ? `${requiredMet} of ${totalRequired}` : items.length} Required items met ({percentMet}%)
                      </span>
                      <span className="opd-stat-divider" aria-hidden="true">•</span>
                      <span className={`opd-stat-not-met ${notMet > 0 ? "has-not-met" : ""}`}>
                        {notMet} Not Met
                      </span>
                    </>
                  )}
                </div>
              </div>
            </section>

            {/* ── 3-Option Outcome Selector ─────────────────────────────────── */}
            <fieldset className="opd-fieldset">
              <legend className="opd-legend">
                Proposed outcome <span className="opd-required">*</span>
              </legend>

              <div
                className="opd-outcomes-grid"
                role="radiogroup"
                aria-label="Proposed outcome"
              >
                {/* 1. PASS */}
                <label
                  className={`opd-outcome-card opd-outcome-pass ${
                    selectedOutcome === "PASS" ? "is-selected" : ""
                  }`}
                  data-testid="outcome-option-pass"
                >
                  <input
                    type="radio"
                    name="proposed_outcome"
                    value="PASS"
                    checked={selectedOutcome === "PASS"}
                    onChange={() => setSelectedOutcome("PASS")}
                    className="opd-radio-input"
                  />
                  <div className="opd-outcome-card-header">
                    <span className="opd-outcome-title">
                      <span className="opd-outcome-indicator" aria-hidden="true" />
                      Pass
                    </span>
                    <span className="opd-outcome-badge opd-badge-pass">Recommend</span>
                  </div>
                  <p className="opd-outcome-desc">
                    Demonstrated proficiency across all required techniques and forms. Recommend promotion to {targetRankName}.
                  </p>
                </label>

                {/* 2. CONDITIONAL */}
                <label
                  className={`opd-outcome-card opd-outcome-conditional ${
                    selectedOutcome === "CONDITIONAL" ? "is-selected" : ""
                  }`}
                  data-testid="outcome-option-conditional"
                >
                  <input
                    type="radio"
                    name="proposed_outcome"
                    value="CONDITIONAL"
                    checked={selectedOutcome === "CONDITIONAL"}
                    onChange={() => setSelectedOutcome("CONDITIONAL")}
                    className="opd-radio-input"
                  />
                  <div className="opd-outcome-card-header">
                    <span className="opd-outcome-title">
                      <span className="opd-outcome-indicator" aria-hidden="true" />
                      Conditional
                    </span>
                    <span className="opd-outcome-badge opd-badge-conditional">Re-test</span>
                  </div>
                  <p className="opd-outcome-desc">
                    Pass subject to re-testing specific items within a designated time window. Specify re-test requirements below.
                  </p>
                </label>

                {/* 3. FAIL / DEFER */}
                <label
                  className={`opd-outcome-card opd-outcome-fail ${
                    selectedOutcome === "FAIL" ? "is-selected" : ""
                  }`}
                  data-testid="outcome-option-fail"
                >
                  <input
                    type="radio"
                    name="proposed_outcome"
                    value="FAIL"
                    checked={selectedOutcome === "FAIL"}
                    onChange={() => setSelectedOutcome("FAIL")}
                    className="opd-radio-input"
                  />
                  <div className="opd-outcome-card-header">
                    <span className="opd-outcome-title">
                      <span className="opd-outcome-indicator" aria-hidden="true" />
                      Fail / Defer
                    </span>
                    <span className="opd-outcome-badge opd-badge-fail">Defer</span>
                  </div>
                  <p className="opd-outcome-desc">
                    Did not meet required standard. Recommend remaining at current rank and re-grading at a future session.
                  </p>
                </label>
              </div>
            </fieldset>

            {/* ── Proposal Notes ────────────────────────────────────────────── */}
            <div className="opd-field-group">
              <label htmlFor={notesId} className="opd-label">
                Proposal notes for Authorised Master
              </label>
              <textarea
                id={notesId}
                rows={4}
                className="opd-textarea"
                value={proposalNotes}
                onChange={(e) => setProposalNotes(e.target.value)}
                placeholder="Detail technical observations, strengths, specific items needing re-testing (if conditional), or rationale for deferral..."
                data-testid="opd-notes-textarea"
              />
              <span className="opd-field-hint">
                These notes will be reviewed by the Authorised Master when recording the final outcome decision.
              </span>
            </div>

            {/* ── Master Review Required Callout ────────────────────────────── */}
            <div className="opd-callout-info" data-testid="opd-callout-info">
              <span className="opd-callout-icon" aria-hidden="true">ℹ</span>
              <div className="opd-callout-text">
                <span className="opd-callout-title">Master review required</span>
                <p className="opd-callout-desc">
                  Submitting this proposal does not finalise the grading result or promote the candidate. An Authorised Master will review this proposal, assessment scores, and notes before recording the final outcome.
                </p>
              </div>
            </div>
          </div>

          {/* ── Drawer Sticky Actions Footer ───────────────────────────────── */}
          <footer className="opd-footer">
            <button
              type="button"
              className="btn-ghost opd-cancel-btn"
              onClick={onClose}
              disabled={isSubmitting}
              data-testid="opd-cancel-btn"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary opd-submit-btn"
              disabled={isSubmitting}
              data-testid="opd-submit-btn"
            >
              {isSubmitting ? "Submitting proposal..." : "Submit proposal →"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
