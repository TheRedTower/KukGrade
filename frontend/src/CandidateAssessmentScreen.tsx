import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth";
import {
  ApiError,
  CandidateAssessmentItem,
  CandidateAssessmentItemResult,
  deleteCandidateAssessment,
  generateCandidateAssessment,
  updateCandidateAssessment,
  updateCandidateAssessmentItem,
} from "./api";
import { RankVisual } from "./RankVisual";
import { formatTimeOnly, useCandidateAssessmentData } from "./candidateAssessmentData";
import { useDialogFocus } from "./useDialogFocus";
import "./CandidateAssessment.css";


export function CandidateAssessmentScreen() {
  const { sessionId, candidateId } = useParams<{ sessionId: string; candidateId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  const numSessionId = sessionId ? Number(sessionId) : undefined;
  const numCandidateId = candidateId ? Number(candidateId) : undefined;

  // User selected category filter
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // Error state for actions
  const [actionError, setActionError] = useState<string | null>(null);
  // Delete-assessment confirmation dialog (administrator cleanup only)
  const [deleteOpen, setDeleteOpen] = useState(false);

  const {
    session,
    candidate,
    studentRankName,
    assessment,
    items,
    categoryGroups,
    stats,
    isLoading,
  } = useCandidateAssessmentData(numSessionId, numCandidateId);

  // Default active category to the first one with remaining items, or the first group
  const activeCategory =
    selectedCategory ??
    (categoryGroups.find((g) => !g.isDone)?.category ?? categoryGroups[0]?.category ?? "");

  // 8. Mutations
  const generateAssessmentMutation = useMutation({
    mutationFn: () => {
      if (!candidate) throw new Error("Candidate not found");
      return generateCandidateAssessment(candidate.id);
    },
    onSuccess: (generated) => {
      setActionError(null);
      queryClient.setQueryData(["candidateAssessment", numCandidateId], generated);
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", numSessionId] });
      queryClient.invalidateQueries({ queryKey: ["gradingCandidates", numSessionId] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setActionError(err.message);
      } else {
        setActionError("Failed to prepare the assessment form.");
      }
    },
  });

  // Start assessment mutation
  const startAssessmentMutation = useMutation({
    mutationFn: () => {
      if (!assessment) throw new Error("Assessment not found");
      return updateCandidateAssessment(assessment.id, { status: "IN_PROGRESS" });
    },
    onSuccess: (updated) => {
      setActionError(null);
      queryClient.setQueryData(["candidateAssessment", numCandidateId], updated);
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", numSessionId] });
      queryClient.invalidateQueries({ queryKey: ["gradingCandidates", numSessionId] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setActionError(err.message);
      } else {
        setActionError("Failed to start assessment.");
      }
    },
  });

  // Update item result mutation
  const updateItemMutation = useMutation({
    mutationFn: ({
      itemId,
      result,
      notes,
    }: {
      itemId: number;
      result?: CandidateAssessmentItemResult;
      notes?: string;
    }) => {
      const payload: { result?: CandidateAssessmentItemResult; assessor_notes?: string } = {};
      if (result !== undefined) payload.result = result;
      if (notes !== undefined) payload.assessor_notes = notes;
      return updateCandidateAssessmentItem(itemId, payload);
    },
    onMutate: async ({ itemId, result, notes }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ["candidateAssessmentItems", assessment?.id] });
      const previous = queryClient.getQueryData<{ results: CandidateAssessmentItem[] }>([
        "candidateAssessmentItems",
        assessment?.id,
      ]);

      if (previous?.results) {
        const nextResults = previous.results.map((i) => {
          if (i.id === itemId) {
            return {
              ...i,
              result: result !== undefined ? result : i.result,
              assessor_notes: notes !== undefined ? notes : i.assessor_notes,
            };
          }
          return i;
        });
        queryClient.setQueryData(["candidateAssessmentItems", assessment?.id], {
          ...previous,
          results: nextResults,
        });
      }
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["candidateAssessmentItems", assessment?.id], context.previous);
      }
      if (err instanceof ApiError) {
        setActionError(err.message);
      } else {
        setActionError("Could not save item evaluation.");
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["candidateAssessmentItems", assessment?.id] });
      queryClient.invalidateQueries({ queryKey: ["candidateAssessment", numCandidateId] });
    },
  });

  // Delete assessment mutation (administrator cleanup only - cascades
  // through any outcome/promotion on the backend)
  const deleteAssessmentMutation = useMutation({
    mutationFn: () => {
      if (!assessment) throw new Error("Assessment not found");
      return deleteCandidateAssessment(assessment.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", numSessionId] });
      queryClient.invalidateQueries({ queryKey: ["gradingCandidates", numSessionId] });
      navigate(`/gradings/${numSessionId}`);
    },
  });
  const deleteAssessmentError =
    deleteAssessmentMutation.error instanceof ApiError
      ? deleteAssessmentMutation.error.message
      : null;

  // Loading state
  if (isLoading) {
    return (
      <section aria-label="Candidate assessment workspace" className="caw-page" data-testid="caw-loading">
        <div className="caw-loading-state" role="status">
          <span className="status-dot status-dot-pulse" aria-hidden="true" />
          <p>Loading candidate assessment workspace...</p>
        </div>
      </section>
    );
  }

  // Not found or error state
  if (!session || !candidate) {
    return (
      <section aria-label="Candidate assessment workspace" className="caw-page" data-testid="caw-not-found">
        <div className="caw-error-banner" role="alert">
          <p>Candidate or grading session not found.</p>
          <Link to={`/gradings/${sessionId}`} className="btn-secondary">
            ← Return to session roster
          </Link>
        </div>
      </section>
    );
  }

  const reviewPath = `/gradings/${sessionId}/assessments/${candidateId}/review`;
  const isAssessmentCompleted = assessment?.status === "COMPLETED";
  const isAssessmentMissing = assessment === null;
  const isAssessmentNotStarted = assessment?.status === "NOT_STARTED";
  const isAssessmentInProgress = assessment?.status === "IN_PROGRESS";

  // Filter items for the active category
  const activeGroup = categoryGroups.find((g) => g.category === activeCategory) ?? categoryGroups[0];
  const itemsToDisplay = activeCategory ? (activeGroup?.items ?? []) : items;

  // Render SCR-019: Mat-side Scoring Workspace
  return (
    <section aria-labelledby="caw-title" className="caw-page" data-testid="caw-workspace">
      {/* Top Breadcrumbs */}
      <nav aria-label="Breadcrumbs" className="caw-breadcrumbs">
        <Link to="/gradings">Gradings</Link>
        <span aria-hidden="true" className="breadcrumb-separator">/</span>
        <Link to={`/gradings/${session.id}`}>{session.title}</Link>
        <span aria-hidden="true" className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">{candidate.student_display_name} (Assessment)</span>
      </nav>

      {/* Header Banner */}
      <header className="caw-header">
        <div className="caw-header-left">
          <h1 className="caw-candidate-name" id="caw-title">{candidate.student_display_name}</h1>
          {candidate.student_wksa_id && (
            <span className="caw-candidate-wksa">
              <span className="caw-wksa-label">WKSA ID</span>
              <span className="caw-wksa-val">{candidate.student_wksa_id}</span>
            </span>
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
            <span
              className={`caw-status-pill caw-status-${assessment?.status?.toLowerCase() || "not-started"}`}
            >
              <span className="caw-status-dot" aria-hidden="true" />
              {assessment?.status_display || "Not started"}
            </span>
          </div>
        </div>

        <div className="caw-header-right">
          {isAssessmentCompleted ? (
            <Link
              className="btn-secondary caw-review-btn"
              to={reviewPath}
              data-testid="caw-view-review-btn"
            >
              View completion record →
            </Link>
          ) : (
            <button
              type="button"
              className={`caw-complete-action-btn ${stats.canComplete ? "caw-complete-ready" : ""}`}
              disabled={!stats.canComplete}
              onClick={() => navigate(reviewPath)}
              title={
                stats.canComplete
                  ? "Proceed to completion review"
                  : `${stats.remainingRequired} required items remain unassessed`
              }
              data-testid="caw-complete-assessment-btn"
            >
              {stats.canComplete
                ? "Complete assessment →"
                : `Complete assessment (${stats.remainingRequired} required remaining)`}
            </button>
          )}
          {currentUser?.role === "administrator" && assessment && (
            <button
              type="button"
              className="caw-danger-btn"
              onClick={() => setDeleteOpen(true)}
              data-testid="caw-delete-assessment-btn"
            >
              Delete assessment
            </button>
          )}
        </div>
      </header>

      {actionError && (
        <div className="caw-action-error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <p>{actionError}</p>
        </div>
      )}

      {/* Required Items Assessed Progress Ledger */}
      <div className="caw-progress-ledger" role="status" aria-live="polite">
        <div className="caw-progress-main">
          <span className="caw-progress-icon" aria-hidden="true">
            {stats.remainingRequired === 0 ? "✓" : "!"}
          </span>
          <span className="caw-progress-text">
            <strong>{stats.requiredAssessed} / {stats.requiredItems}</strong> Required items assessed ({stats.percent}%)
          </span>
        </div>
        <div className="caw-progress-chips">
          <span className="caw-chip caw-chip-met">
            {stats.metCount} Met
          </span>
          <span className="caw-chip caw-chip-not-met">
            {stats.notMetCount} Not Met
          </span>
          <span className="caw-chip caw-chip-not-assessed">
            {stats.notAssessedCount} Not Assessed
          </span>
        </div>
      </div>

      {isAssessmentMissing && (
        <div className="caw-not-started-banner" data-testid="caw-missing-assessment-banner">
          <div className="caw-not-started-content">
            <h3>Prepare Assessment Form</h3>
            <p>
              Generate the candidate&rsquo;s immutable syllabus snapshot before starting
              assessment.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => generateAssessmentMutation.mutate()}
            disabled={generateAssessmentMutation.isPending || session.status !== "DRAFT"}
            data-testid="generate-assessment-btn"
          >
            {generateAssessmentMutation.isPending
              ? "Preparing..."
              : session.status !== "DRAFT"
              ? "Session must be Draft to prepare"
              : "Prepare assessment form"}
          </button>
        </div>
      )}

      {/* A generated snapshot is started separately once the session is open. */}
      {isAssessmentNotStarted && (
        <div className="caw-not-started-banner" data-testid="caw-not-started-banner">
          <div className="caw-not-started-content">
            <h3>Assessment Ready To Begin</h3>
            <p>
              Candidates must have their assessment started before individual syllabus items can be scored.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => startAssessmentMutation.mutate()}
            disabled={startAssessmentMutation.isPending || session.status !== "OPEN"}
            data-testid="start-assessment-btn"
          >
            {startAssessmentMutation.isPending
              ? "Starting..."
              : session.status !== "OPEN"
              ? "Session must be Open to start"
              : "Start assessment"}
          </button>
        </div>
      )}

      {/* Dual-Pane Workspace */}
      <div className="caw-dual-pane">
        {/* Left Category Sub-Rail */}
        <aside aria-label="Syllabus Categories" className="caw-category-rail">
          <ul className="caw-category-list" role="tablist" aria-orientation="vertical">
            {categoryGroups.map((group) => {
              const isActive = activeCategory === group.category;
              return (
                <li key={group.category} role="presentation">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`caw-category-tab ${isActive ? "caw-tab-active" : ""}`}
                    onClick={() => setSelectedCategory(group.category)}
                    data-testid={`caw-cat-tab-${group.category}`}
                  >
                    <span className="caw-tab-title">
                      {group.categoryDisplay}
                      {group.koreanName && (
                        <span className="caw-tab-korean"> ({group.koreanName})</span>
                      )}
                    </span>
                    {group.isDone ? (
                      <span className="caw-tab-done-badge" aria-label="Category completed">
                        <span aria-hidden="true">✓</span> Done
                      </span>
                    ) : (
                      <span className="caw-tab-remaining-badge">
                        {group.remainingRequiredCount} remaining
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Right Assessment Items Panel */}
        <main className="caw-items-panel">
          {activeGroup && (
            <div className="caw-category-heading-wrap">
              <h2 className="caw-category-heading">
                {activeGroup.categoryDisplay}
                {activeGroup.koreanName && ` · ${activeGroup.koreanName}`}
                <span className="caw-category-track"> ({candidate.age_band_display})</span>
              </h2>
            </div>
          )}

          {itemsToDisplay.length === 0 ? (
            <div className="caw-empty-items">
              <p>No assessment items found in this section.</p>
            </div>
          ) : (
            <div className="caw-items-list" role="list">
              {itemsToDisplay.map((item) => (
                <AssessmentItemRow
                  key={item.id}
                  item={item}
                  isEditable={isAssessmentInProgress && !isAssessmentCompleted}
                  onUpdateResult={(result) =>
                    updateItemMutation.mutate({ itemId: item.id, result })
                  }
                  onUpdateNotes={(notes) =>
                    updateItemMutation.mutate({ itemId: item.id, notes })
                  }
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {deleteOpen && assessment && (
        <DeleteAssessmentDialog
          candidateName={candidate.student_display_name}
          isPending={deleteAssessmentMutation.isPending}
          error={deleteAssessmentError}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => deleteAssessmentMutation.mutate()}
        />
      )}
    </section>
  );
}

function DeleteAssessmentDialog({
  candidateName,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  candidateName: string;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>({
    isOpen: true,
    onClose,
    canClose: !isPending,
  });

  return (
    <div
      className="caw-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="gsd-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-assessment-title"
        tabIndex={-1}
      >
        <h3 id="delete-assessment-title" className="gsd-modal-title">Delete assessment</h3>
        <p className="gsd-modal-message">
          Permanently delete {candidateName}&apos;s assessment? If it has a finalised outcome
          or promotion, those are deleted too and the student's rank is reverted. This cannot
          be undone.
        </p>
        {error && (
          <div className="caw-error-banner" role="alert">
            <p>{error}</p>
          </div>
        )}
        <div className="gsd-modal-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={isPending}
            data-dialog-autofocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="caw-danger-btn"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "Deleting…" : "Delete assessment"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Individual Candidate Assessment Item Row Component
 * Implements FDR-033 3-state segmented controls with 48px touch targets,
 * inline notes and assessor attribution.
 */
function AssessmentItemRow({
  item,
  isEditable,
  onUpdateResult,
  onUpdateNotes,
}: {
  item: CandidateAssessmentItem;
  isEditable: boolean;
  onUpdateResult: (result: CandidateAssessmentItemResult) => void;
  onUpdateNotes: (notes: string) => void;
}) {
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(item.assessor_notes || "");

  const handleNotesBlur = () => {
    setIsEditingNotes(false);
    if (notesValue !== (item.assessor_notes || "")) {
      onUpdateNotes(notesValue);
    }
  };

  return (
    <div
      className={`caw-item-card ${item.result === "NOT_MET" ? "caw-item-not-met" : ""}`}
      data-testid={`caw-item-${item.id}`}
    >
      <div className="caw-item-main">
        {/* Left details */}
        <div className="caw-item-info">
          <div className="caw-item-title-row">
            <span className="caw-item-seq">#{item.requirement_sequence}</span>
            <span className="caw-item-name">{item.item_name}</span>
            {item.korean_name && (
              <span className="caw-item-korean"> · {item.korean_name}</span>
            )}
            {item.required ? (
              <span className="caw-required-badge">Required</span>
            ) : (
              <span className="caw-optional-badge">Optional</span>
            )}
          </div>

          {item.requirement_notes && (
            <p className="caw-item-desc">{item.requirement_notes}</p>
          )}

          {/* Assessor attribution & notes summary */}
          <div className="caw-item-meta-row">
            {item.assessor_email && (
              <span className="caw-assessor-tag">
                Assessed by {item.assessor_email}
                {item.assessed_at && ` at ${formatTimeOnly(item.assessed_at)}`}
              </span>
            )}

            {!isEditingNotes && item.assessor_notes && (
              <button
                type="button"
                className="caw-note-preview-btn"
                onClick={() => setIsEditingNotes(true)}
                title="Click to edit assessor note"
              >
                Note: "{item.assessor_notes}"
              </button>
            )}

            {!isEditingNotes && !item.assessor_notes && isEditable && (
              <button
                type="button"
                className="caw-add-note-btn"
                onClick={() => setIsEditingNotes(true)}
              >
                + Add note
              </button>
            )}
          </div>

          {/* Inline notes input */}
          {isEditingNotes && isEditable && (
            <div className="caw-inline-note-wrap">
              <input
                type="text"
                className="caw-inline-note-input"
                placeholder="Add observation note (e.g. Guard dropped on turn)..."
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                onBlur={handleNotesBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNotesBlur();
                  if (e.key === "Escape") {
                    setNotesValue(item.assessor_notes || "");
                    setIsEditingNotes(false);
                  }
                }}
                autoFocus
              />
              <button
                type="button"
                className="btn-secondary caw-save-note-btn"
                onClick={handleNotesBlur}
              >
                Save
              </button>
            </div>
          )}
        </div>

        {/* Right: FDR-033 Segmented 3-state touch controls (min 48px touch targets) */}
        <div
          className="caw-segmented-control"
          role="group"
          aria-label={`Evaluation for ${item.item_name}`}
        >
          <button
            type="button"
            className={`caw-seg-btn caw-seg-not-assessed ${
              item.result === "NOT_ASSESSED" ? "caw-seg-active" : ""
            }`}
            disabled={!isEditable}
            onClick={() => onUpdateResult("NOT_ASSESSED")}
            aria-pressed={item.result === "NOT_ASSESSED"}
            data-testid={`btn-not-assessed-${item.id}`}
          >
            <span aria-hidden="true">—</span>
            <span>Not Assessed</span>
          </button>

          <button
            type="button"
            className={`caw-seg-btn caw-seg-met ${
              item.result === "MET" ? "caw-seg-active" : ""
            }`}
            disabled={!isEditable}
            onClick={() => onUpdateResult("MET")}
            aria-pressed={item.result === "MET"}
            data-testid={`btn-met-${item.id}`}
          >
            <span aria-hidden="true">✓</span>
            <span>Met</span>
          </button>

          <button
            type="button"
            className={`caw-seg-btn caw-seg-not-met ${
              item.result === "NOT_MET" ? "caw-seg-active" : ""
            }`}
            disabled={!isEditable}
            onClick={() => onUpdateResult("NOT_MET")}
            aria-pressed={item.result === "NOT_MET"}
            data-testid={`btn-not-met-${item.id}`}
          >
            <span aria-hidden="true">✕</span>
            <span>Not Met</span>
          </button>
        </div>
      </div>
    </div>
  );
}
