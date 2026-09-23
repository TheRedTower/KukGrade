/**
 * Assessment completion review (SCR-020, superseded by SCR-027).
 *
 * Extracted from `CandidateAssessmentScreen`'s `isReviewMode` branch into its
 * own route so that the selected 2B Certificate Proof direction can be built
 * as a route rather than an in-page mode. This file is a faithful move of the
 * existing design - the 2B rebuild is a later slice.
 */
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, updateCandidateAssessment } from "./api";
import { RankVisual } from "./RankVisual";
import {
  formatTimeOnly,
  useAssessmentNotesDraft,
  useCandidateAssessmentData,
} from "./candidateAssessmentData";
import "./CandidateAssessment.css";

export function AssessmentCompletionScreen() {
  const { sessionId, candidateId } = useParams<{ sessionId: string; candidateId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const numSessionId = sessionId ? Number(sessionId) : undefined;
  const numCandidateId = candidateId ? Number(candidateId) : undefined;

  // General assessment notes. The draft outlives a trip back to scoring - see
  // useAssessmentNotesDraft.
  const { draft: userNotes, setDraft: setUserNotes, clearDraft: clearNotesDraft } =
    useAssessmentNotesDraft(numCandidateId);
  const [actionError, setActionError] = useState<string | null>(null);

  const { session, candidate, studentRankName, assessment, items, categoryGroups, stats, isLoading } =
    useCandidateAssessmentData(numSessionId, numCandidateId);

  const generalNotes = userNotes !== null ? userNotes : (assessment?.notes ?? "");
  const scoringPath = `/gradings/${sessionId}/assessments/${candidateId}`;

  const completeAssessmentMutation = useMutation({
    mutationFn: () => {
      if (!assessment) throw new Error("Assessment not found");
      return updateCandidateAssessment(assessment.id, {
        status: "COMPLETED",
        notes: generalNotes,
      });
    },
    onSuccess: () => {
      setActionError(null);
      clearNotesDraft();
      queryClient.invalidateQueries({ queryKey: ["candidateAssessment", numCandidateId] });
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", numSessionId] });
      queryClient.invalidateQueries({ queryKey: ["gradingCandidates", numSessionId] });
      navigate(`/gradings/${numSessionId}`);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setActionError(err.message);
      } else {
        setActionError("Failed to complete assessment.");
      }
    },
  });

  if (isLoading) {
    return (
      <section aria-label="Assessment completion review" className="caw-page" data-testid="caw-review-loading">
        <div className="caw-loading-state" role="status">
          <span className="status-dot status-dot-pulse" aria-hidden="true" />
          <p>Loading completion review...</p>
        </div>
      </section>
    );
  }

  if (!session || !candidate) {
    return (
      <section aria-label="Assessment completion review" className="caw-page" data-testid="caw-review-not-found">
        <div className="caw-error-banner" role="alert">
          <p>Candidate or grading session not found.</p>
          <Link to={`/gradings/${sessionId}`} className="btn-secondary">
            ← Return to session roster
          </Link>
        </div>
      </section>
    );
  }

  const isAssessmentCompleted = assessment?.status === "COMPLETED";

  // Reachable by typed URL before the assessment is ready for review. The
  // scoring screen only links here once every required item is assessed, so
  // this state explains itself rather than showing an empty review.
  if (!assessment || (!isAssessmentCompleted && !stats.canComplete)) {
    return (
      <section aria-label="Assessment completion review" className="caw-page" data-testid="caw-review-unavailable">
        <div className="caw-error-banner" role="alert">
          <p>
            {!assessment
              ? "This candidate has no assessment form yet, so there is nothing to review."
              : `${stats.remainingRequired} required ${
                  stats.remainingRequired === 1 ? "item remains" : "items remain"
                } unassessed. Finish scoring before completing the assessment.`}
          </p>
          <Link to={scoringPath} className="btn-secondary">
            ← Return to scoring
          </Link>
        </div>
      </section>
    );
  }

  const notMetItems = items.filter((item) => item.result === "NOT_MET");

  return (
    <section aria-labelledby="caw-review-title" className="caw-page" data-testid="caw-review-workspace">
      {/* Top Breadcrumb Header */}
      <nav aria-label="Breadcrumbs" className="caw-breadcrumbs">
        <Link to="/gradings">Gradings</Link>
        <span aria-hidden="true" className="breadcrumb-separator">/</span>
        <Link to={`/gradings/${session.id}`}>{session.title}</Link>
        <span aria-hidden="true" className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">{candidate.student_display_name} (Completion Review)</span>
      </nav>

      <header className="caw-review-header">
        <div>
          <h1 className="caw-candidate-title" id="caw-review-title">Review &amp; Complete Assessment</h1>
          <div className="caw-candidate-sub">
            <span className="caw-candidate-name">{candidate.student_display_name}</span>
            {candidate.student_wksa_id && (
              <span className="caw-candidate-wksa">WKSA ID: {candidate.student_wksa_id}</span>
            )}
            <div className="caw-rank-pills">
              <span className="caw-rank-tag">
                {studentRankName && <RankVisual rankName={studentRankName} />}
                <span>{studentRankName || "Current Rank"}</span>
              </span>
              <span aria-hidden="true" className="caw-rank-arrow">→</span>
              <span className="caw-rank-tag caw-rank-tag-dest">
                <RankVisual rankName={candidate.testing_for_rank_name} />
                <span>{candidate.testing_for_rank_name}</span>
              </span>
              <span className="caw-age-pill">{candidate.age_band_display}</span>
            </div>
          </div>
        </div>
      </header>

      {actionError && (
        <div className="caw-action-error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <p>{actionError}</p>
        </div>
      )}

      {/* Dual-Card Review Layout */}
      <div className="caw-review-grid">
        {/* Left Column: Evaluation Rollup & Category Breakdown */}
        <div className="caw-review-left-card">
          <div className="caw-card-header">
            <h2 className="caw-card-title">Evaluation Rollup</h2>
            <div className="caw-rollup-chips">
              <span className="caw-chip caw-chip-total">
                {stats.requiredAssessed}/{stats.requiredItems} Required Assessed ({stats.percent}%)
              </span>
              <span className="caw-chip caw-chip-met">
                ✓ {stats.metCount} Met
              </span>
              {stats.notMetCount > 0 && (
                <span className="caw-chip caw-chip-not-met">
                  ✕ {stats.notMetCount} Not Met
                </span>
              )}
            </div>
          </div>

          <div className="caw-category-table-wrap">
            <h3 className="caw-table-heading">Category Breakdown</h3>
            <table className="caw-category-table">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Met status</th>
                  <th scope="col">Percentage</th>
                </tr>
              </thead>
              <tbody>
                {categoryGroups.map((group) => {
                  const metInGroup = group.items.filter((i) => i.result === "MET").length;
                  const notMetInGroup = group.items.filter((i) => i.result === "NOT_MET").length;
                  const pct = group.totalCount > 0 ? Math.round((metInGroup / group.totalCount) * 100) : 100;

                  return (
                    <tr key={group.category} data-testid={`review-cat-row-${group.category}`}>
                      <td className="caw-cat-td-name">
                        <strong>{group.categoryDisplay}</strong>
                        {group.koreanName && (
                          <span className="caw-korean-sub"> ({group.koreanName})</span>
                        )}
                      </td>
                      <td className="caw-cat-td-status">
                        {metInGroup}/{group.totalCount} Met
                      </td>
                      <td className="caw-cat-td-pct">
                        {notMetInGroup > 0 ? (
                          <span className="caw-pct-flag">({notMetInGroup} Not Met)</span>
                        ) : (
                          <span className="caw-pct-clean">({pct}%) <span className="caw-check-icon">✓</span></span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Flagged Not Met Items & Confirmation */}
        <div className="caw-review-right-card">
          {/* Flagged Not Met Items */}
          <div className="caw-not-met-section">
            <h2 className="caw-card-title caw-title-warning">
              Attention: {notMetItems.length} {notMetItems.length === 1 ? "Item" : "Items"} Not Met
            </h2>
            {notMetItems.length === 0 ? (
              <p className="caw-clean-text">All requirements were successfully met with no recorded deficiencies.</p>
            ) : (
              <ul className="caw-not-met-list">
                {notMetItems.map((item) => (
                  <li key={item.id} className="caw-not-met-item" data-testid={`flagged-item-${item.id}`}>
                    <div className="caw-not-met-header">
                      <span className="caw-not-met-title">
                        #{item.requirement_sequence} {item.item_name}
                        {item.korean_name && ` · ${item.korean_name}`}
                      </span>
                      <span className="caw-not-met-cat">Category: {item.category_display}</span>
                    </div>
                    {item.assessor_notes && (
                      <p className="caw-not-met-notes">"{item.assessor_notes}"</p>
                    )}
                    {item.assessor_email && (
                      <span className="caw-not-met-assessor">
                        Assessed by {item.assessor_email}
                        {item.assessed_at && ` at ${formatTimeOnly(item.assessed_at)}`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* General Assessment Notes */}
          <div className="caw-notes-section">
            <label htmlFor="general-assessment-notes" className="caw-card-title">
              General Assessment Notes
            </label>
            <textarea
              id="general-assessment-notes"
              className="caw-notes-textarea"
              rows={4}
              placeholder="Overall candidate notes (optional)"
              value={generalNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              disabled={isAssessmentCompleted}
            />
          </div>

          {/* Confirm Completion Box */}
          <div className="caw-confirm-box">
            <div className="caw-confirm-warning">
              <span className="caw-warning-icon" aria-hidden="true">⚠️</span>
              <span>Completed assessments cannot be edited once confirmed.</span>
            </div>
            <div className="caw-confirm-actions">
              <Link to={scoringPath} className="btn-secondary">
                Return to scoring
              </Link>
              <button
                type="button"
                className="btn-primary caw-complete-btn"
                onClick={() => completeAssessmentMutation.mutate()}
                disabled={completeAssessmentMutation.isPending || isAssessmentCompleted}
                data-testid="confirm-complete-assessment-btn"
              >
                {completeAssessmentMutation.isPending ? "Confirming..." : "Confirm & complete assessment"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
