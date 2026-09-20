import React, { useState, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  type CandidateAssessment,
  type CandidateOutcome,
  type CandidateOutcomeOutcome,
  type GradingCandidate,
  finaliseCandidateOutcome,
  getCandidateAssessmentSummary,
} from "./api";
import { useAuth } from "./auth";
import { useDialogFocus } from "./useDialogFocus";

export interface MasterFinalDecisionDrawerProps {
  candidate: GradingCandidate;
  assessment?: CandidateAssessment;
  outcome?: CandidateOutcome | null;
  currentRankName: string;
  targetRankName: string;
  sessionStatus?: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (outcome: CandidateOutcome) => void;
}

function GoldSealIcon() {
  return (
    <svg
      className="mfd-seal-icon"
      width="44"
      height="44"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="50%" stopColor="#d97706" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
        <linearGradient id="goldRibbon" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#d97706" />
          <stop offset="100%" stopColor="#92400e" />
        </linearGradient>
      </defs>
      {/* Ribbon tails */}
      <path
        d="M18 30L14 44L22 40L24 44L26 30"
        fill="url(#goldRibbon)"
        stroke="#78350f"
        strokeWidth="1"
      />
      <path
        d="M30 30L34 44L26 40L24 44L22 30"
        fill="url(#goldRibbon)"
        stroke="#78350f"
        strokeWidth="1"
      />
      {/* Outer scalloped seal */}
      <circle cx="24" cy="22" r="16" fill="url(#goldGrad)" stroke="#78350f" strokeWidth="1.5" />
      <circle cx="24" cy="22" r="13" stroke="#fef3c7" strokeWidth="1" strokeDasharray="2 2" />
      {/* Inner star / emblem */}
      <polygon
        points="24,14 26.5,19 32,19.5 28,23.5 29,29 24,26 19,29 20,23.5 16,19.5 21.5,19"
        fill="#fef3c7"
      />
    </svg>
  );
}

export function MasterFinalDecisionDrawer({
  candidate,
  outcome,
  currentRankName,
  targetRankName,
  sessionStatus,
  isOpen,
  onClose,
  onSuccess,
}: MasterFinalDecisionDrawerProps): React.ReactElement | null {
  const { user: currentUser } = useAuth();

  const isAlreadyFinalised = outcome?.status === "FINALISED";
  const initialOutcome: CandidateOutcomeOutcome =
    (outcome?.final_outcome as CandidateOutcomeOutcome) ||
    (outcome?.proposed_outcome as CandidateOutcomeOutcome) ||
    "PASS";

  const [selectedOutcome, setSelectedOutcome] =
    useState<CandidateOutcomeOutcome>(initialOutcome);
  const [decisionNotes, setDecisionNotes] = useState<string>(
    outcome?.decision_notes || "",
  );
  const [conditionalRequirements, setConditionalRequirements] = useState<string>(
    outcome?.conditional_requirements || "",
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const titleId = useId();
  const notesId = useId();
  const condId = useId();
  const dialogRef = useDialogFocus<HTMLElement>({
    isOpen,
    onClose,
    canClose: !isSubmitting,
  });

  const [prevOutcomeId, setPrevOutcomeId] = useState<number | null>(outcome?.id ?? null);

  // Sync state if outcome prop changes while drawer remains mounted
  if (outcome && outcome.id !== prevOutcomeId) {
    setPrevOutcomeId(outcome.id);
    setSelectedOutcome(
      (outcome.final_outcome as CandidateOutcomeOutcome) ||
        (outcome.proposed_outcome as CandidateOutcomeOutcome) ||
        "PASS",
    );
    setDecisionNotes(outcome.decision_notes || "");
    setConditionalRequirements(outcome.conditional_requirements || "");
    setSubmitError(null);
  }

  // Fetch assessment summary
  const { data: summary, isLoading: isLoadingSummary } = useQuery({
    queryKey: ["candidateOutcomeSummary", outcome?.id],
    queryFn: () => (outcome ? getCandidateAssessmentSummary(outcome.id) : null),
    enabled: isOpen && !!outcome?.id,
  });

  if (!isOpen) return null;

  const isSessionLocked = sessionStatus === "LOCKED";
  const canMakeDecision =
    Boolean(currentUser?.can_make_final_grading_decision) && !isAlreadyFinalised;

  async function handleFinalise(e: React.FormEvent) {
    e.preventDefault();
    if (!outcome?.id) {
      setSubmitError("No active outcome record found for this candidate.");
      return;
    }

    if (!isSessionLocked) {
      setSubmitError("Final decisions can only be made in locked sessions.");
      return;
    }

    if (selectedOutcome === "CONDITIONAL" && !conditionalRequirements.trim()) {
      setSubmitError(
        "Conditional requirements are required when choosing a Conditional outcome.",
      );
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitError(null);

      const payload: {
        final_outcome: CandidateOutcomeOutcome;
        decision_notes?: string;
        conditional_requirements?: string;
      } = {
        final_outcome: selectedOutcome,
        decision_notes: decisionNotes.trim(),
      };

      if (selectedOutcome === "CONDITIONAL") {
        payload.conditional_requirements = conditionalRequirements.trim();
      }

      const updated = await finaliseCandidateOutcome(outcome.id, payload);
      onSuccess(updated);
      onClose();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to finalise decision.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // Instructor recommendation display info
  const proposedOutcome = outcome?.proposed_outcome;
  const proposedByName = outcome?.proposed_by_name || "Instructor";
  const proposalNotes = outcome?.proposal_notes;

  return (
    <div
      className="mfd-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
      role="presentation"
    >
      <section
        ref={dialogRef}
        className="mfd-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {/* Drawer Header */}
        <header className="mfd-header">
          <div className="mfd-header-text">
            <h2 id={titleId} className="mfd-title">
              Master Final Adjudication
            </h2>
            <p className="mfd-subtitle">
              <span className="mfd-candidate-name">{candidate.student_display_name}</span>
              {candidate.student_wksa_id && (
                <span className="mfd-wksa-id"> (WKSA ID: {candidate.student_wksa_id})</span>
              )}
              <span className="mfd-divider">·</span>
              <span>Current: {currentRankName}</span>
              <span className="mfd-rank-arrow" aria-hidden="true">→</span>
              <span>Targeting: <strong>{targetRankName}</strong></span>
            </p>
          </div>
          <button
            type="button"
            className="mfd-close-btn"
            onClick={onClose}
            aria-label="Close adjudication drawer"
            disabled={isSubmitting}
          >
            ✕
          </button>
        </header>

        {/* Informational banners */}
        {isAlreadyFinalised && (
          <div className="mfd-banner mfd-banner-finalised" role="status">
            <span className="mfd-banner-icon" aria-hidden="true">✓</span>
            <div>
              <strong>Outcome Finalised &amp; Sealed</strong>
              <p>
                This grading outcome has been ratified and sealed by {outcome?.decided_by_name || "Authorised Master"}.
                Historical records are sealed and immutable.
              </p>
            </div>
          </div>
        )}

        {!canMakeDecision && !isAlreadyFinalised && (
          <div className="mfd-banner mfd-banner-warning" role="alert">
            <span className="mfd-banner-icon" aria-hidden="true">🔒</span>
            <div>
              <strong>Master Authority Required</strong>
              <p>
                You do not hold the can_make_final_grading_decision authority.
                Only authorised Masters may seal final grading outcomes.
              </p>
            </div>
          </div>
        )}

        {!isSessionLocked && !isAlreadyFinalised && (
          <div className="mfd-banner mfd-banner-warning" role="alert">
            <span className="mfd-banner-icon" aria-hidden="true">⚠️</span>
            <div>
              <strong>Session Must Be Locked Before Finalising</strong>
              <p>
                Final outcomes can only be sealed after the grading session is locked.
                Review the candidate ledger below; lock the session to enable sealing.
              </p>
            </div>
          </div>
        )}

        {submitError && (
          <div className="mfd-banner mfd-banner-error" role="alert">
            <span className="mfd-banner-icon" aria-hidden="true">✕</span>
            <span>{submitError}</span>
          </div>
        )}

        {/* Main Dual-Column Content */}
        <form onSubmit={handleFinalise} className="mfd-form-layout" noValidate>
          <div className="mfd-body-grid">
            {/* Left Column: Assessment Ledger & Proposal */}
            <div className="mfd-column mfd-column-left">
              <div className="mfd-card mfd-ledger-card">
                <h3 className="mfd-card-heading">Assessment Ledger &amp; Proposal</h3>

                {/* Categories Table */}
                <div className="mfd-table-wrap">
                  {isLoadingSummary ? (
                    <div className="mfd-loading-state">Loading assessment ledger…</div>
                  ) : summary?.categories && summary.categories.length > 0 ? (
                    <table className="mfd-table" aria-label="Candidate Assessment Scores">
                      <thead>
                        <tr>
                          <th scope="col">Category</th>
                          <th scope="col" style={{ textAlign: "right" }}>
                            Scores
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.categories.map((cat) => {
                          const scoreDisplay =
                            cat.required > 0
                              ? `${cat.required_met}/${cat.required}`
                              : cat.all_required_met
                              ? "Met"
                              : `${cat.met}/${cat.total}`;

                          return (
                            <tr key={cat.category}>
                              <td className="mfd-cell-category">{cat.category}</td>
                              <td className="mfd-cell-score" style={{ textAlign: "right" }}>
                                <span className="mfd-score-pill">{scoreDisplay}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="mfd-empty-ledger">
                      <p>Assessment criteria completed across all required areas.</p>
                    </div>
                  )}
                </div>

                {/* Overall Score Summary */}
                {summary?.overall && (
                  <div className="mfd-overall-summary">
                    <span className="mfd-overall-label">Total Required Items</span>
                    <span className="mfd-overall-metric">
                      {summary.overall.required_met} of {summary.overall.required} Met (
                      {summary.overall.required > 0
                        ? Math.round(
                            (summary.overall.required_met / summary.overall.required) * 100,
                          )
                        : 100}
                      %)
                    </span>
                  </div>
                )}

                {/* Instructor Recommendation Note Box */}
                <div className="mfd-recommendation-box">
                  <div className="mfd-recommendation-header">
                    <span className="mfd-rec-title">
                      Instructor recommendation note by {proposedByName}
                    </span>
                    {proposedOutcome && (
                      <span
                        className={`mfd-rec-badge mfd-rec-badge-${proposedOutcome.toLowerCase()}`}
                      >
                        Proposed: {proposedOutcome}
                      </span>
                    )}
                  </div>
                  <p className="mfd-rec-notes">
                    {proposalNotes
                      ? proposalNotes
                      : "Instructor submitted recommendation without additional notes."}
                  </p>
                  <div className="mfd-rec-author">
                    <span className="mfd-author-avatar" aria-hidden="true">
                      {proposedByName.charAt(0)}
                    </span>
                    <span className="mfd-author-name">{proposedByName}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Master Ratification */}
            <div className="mfd-column mfd-column-right">
              <div className="mfd-card mfd-ratification-card">
                <h3 className="mfd-card-heading">Master Ratification</h3>

                {/* 3 Outcome Selection Cards */}
                <div
                  className="mfd-ratification-options"
                  role="radiogroup"
                  aria-label="Master Ratification Outcome"
                >
                  {/* PASS */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selectedOutcome === "PASS"}
                    className={`mfd-ratification-btn mfd-btn-pass ${
                      selectedOutcome === "PASS" ? "is-selected" : ""
                    }`}
                    onClick={() => canMakeDecision && setSelectedOutcome("PASS")}
                    disabled={!canMakeDecision}
                    data-dialog-autofocus
                  >
                    <span className="mfd-opt-icon" aria-hidden="true">✓</span>
                    <span className="mfd-opt-label">Pass</span>
                  </button>

                  {/* CONDITIONAL */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selectedOutcome === "CONDITIONAL"}
                    className={`mfd-ratification-btn mfd-btn-conditional ${
                      selectedOutcome === "CONDITIONAL" ? "is-selected" : ""
                    }`}
                    onClick={() => canMakeDecision && setSelectedOutcome("CONDITIONAL")}
                    disabled={!canMakeDecision}
                  >
                    <span className="mfd-opt-icon" aria-hidden="true">!</span>
                    <span className="mfd-opt-label">Conditional</span>
                  </button>

                  {/* FAIL */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selectedOutcome === "FAIL"}
                    className={`mfd-ratification-btn mfd-btn-fail ${
                      selectedOutcome === "FAIL" ? "is-selected" : ""
                    }`}
                    onClick={() => canMakeDecision && setSelectedOutcome("FAIL")}
                    disabled={!canMakeDecision}
                  >
                    <span className="mfd-opt-icon" aria-hidden="true">✕</span>
                    <span className="mfd-opt-label">Fail</span>
                  </button>
                </div>

                {/* Conditional Re-test Requirements (if Conditional is selected) */}
                {selectedOutcome === "CONDITIONAL" && (
                  <div className="mfd-field-wrap">
                    <label htmlFor={condId} className="mfd-field-label">
                      Conditional re-test requirements <span className="mfd-required-star">*</span>
                    </label>
                    <textarea
                      id={condId}
                      className="mfd-textarea"
                      rows={3}
                      value={conditionalRequirements}
                      onChange={(e) => setConditionalRequirements(e.target.value)}
                      placeholder="Specify required techniques, forms, or skills to be re-assessed..."
                      disabled={!canMakeDecision || isSubmitting}
                      required
                    />
                  </div>
                )}

                {/* Master Determination Notes */}
                <div className="mfd-field-wrap">
                  <label htmlFor={notesId} className="mfd-field-label">
                    Master determination notes
                  </label>
                  <textarea
                    id={notesId}
                    className="mfd-textarea"
                    rows={4}
                    value={decisionNotes}
                    onChange={(e) => setDecisionNotes(e.target.value)}
                    placeholder="Master determination notes..."
                    disabled={!canMakeDecision || isSubmitting}
                  />
                </div>

                {/* Master Authority Credential Card */}
                <div className="mfd-authority-card">
                  <div className="mfd-authority-info">
                    <span className="mfd-auth-eyebrow">Master Authority</span>
                    <span className="mfd-auth-name">
                      {isAlreadyFinalised
                        ? outcome?.decided_by_name || "Authorised Master"
                        : currentUser?.full_name || "Authorised Master"}
                    </span>
                    <div className="mfd-auth-badges">
                      <span className="badge badge-accent">Authorised Master</span>
                      <span className="mfd-auth-seal-label">Gold Seal Authority</span>
                    </div>
                  </div>
                  <GoldSealIcon />
                </div>
              </div>
            </div>
          </div>

          {/* Sticky Drawer Footer */}
          <footer className="mfd-footer">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={isSubmitting}
            >
              {isAlreadyFinalised ? "Close Drawer" : "Cancel"}
            </button>

            {!isAlreadyFinalised && (
              <button
                type="submit"
                className="btn btn-primary mfd-submit-btn"
                disabled={!canMakeDecision || !isSessionLocked || isSubmitting}
                title={
                  !isSessionLocked
                    ? "Session must be locked before final decisions can be sealed"
                    : !currentUser?.can_make_final_grading_decision
                    ? "Only Authorised Masters can seal final decisions"
                    : "Finalise & Seal Decision"
                }
              >
                {isSubmitting ? (
                  <>
                    <span className="mfd-spinner" aria-hidden="true" />
                    <span>Sealing decision…</span>
                  </>
                ) : (
                  "Finalise & Seal Decision"
                )}
              </button>
            )}
          </footer>
        </form>
      </section>
    </div>
  );
}
