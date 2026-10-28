/**
 * Mat-side scoring - Single Column Run.
 *
 * What sets it apart:
 *
 * - No category sub-rail. One continuous scroll in syllabus order with sticky
 *   category headers carrying their own progress. A grading runs in ceremony
 *   order, so the rail forced mode-switching for a jump nobody makes.
 * - Requirement rows are divider-led, not cards.
 * - Two verdict targets. `NOT_ASSESSED` is an undo, not a peer of Met and Not
 *   met, so it becomes a `Clear` that confirms inline and names the
 *   attribution it erases.
 * - Header chrome collapses to one line, and the live count plus the
 *   completion action move to a persistent mat bar.
 * - Attribution renders on every scored row, not only the failures.
 *
 * Counts are served, never recounted here - see
 * `candidateAssessmentData.ts`.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth";
import {
  ApiError,
  CandidateAssessmentItem,
  CandidateAssessmentItemResult,
  deleteCandidateAssessment,
  generateCandidateAssessment,
  updateCandidateAssessment,
  updateCandidateAssessmentItem,
  errorMessage,
} from "./api";
import { RankBelt } from "./Belt";
import {
  CategoryGroup,
  forgetDeletedAssessment,
  useCandidateAssessmentData,
} from "./candidateAssessmentData";
import { useDialogFocus } from "./useDialogFocus";
import "./CandidateAssessment.css";
import { formatDayMonth, formatTime } from "./dates";
import { CheckIcon, CrossIcon, WarningIcon } from "./Icons";

/*
 * One icon set, drawn inline. The previous screen mixed raw emoji into the
 * chrome, which renders as a different typeface on every platform and carries
 * no consistent weight - an explicit correction already logged in the register.
 */

function AssessorIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c0-3.6 3.1-5.8 7-5.8s7 2.2 7 5.8" />
    </svg>
  );
}

export function CandidateAssessmentScreen() {
  const { sessionId, candidateId } = useParams<{ sessionId: string; candidateId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  const numSessionId = sessionId ? Number(sessionId) : undefined;
  const numCandidateId = candidateId ? Number(candidateId) : undefined;

  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // At most one row may be confirming a clear or editing a note at a time -
  // both are held here rather than in the row so opening one closes the other.
  const [confirmingClearId, setConfirmingClearId] = useState<number | null>(null);
  const [openNoteId, setOpenNoteId] = useState<number | null>(null);

  const {
    session,
    candidate,
    assessment,
    categoryGroups,
    stats,
    isLoading,
    hasLoadError,
  } = useCandidateAssessmentData(numSessionId, numCandidateId);

  const generateAssessmentMutation = useMutation({
    mutationFn: () => {
      if (!candidate) throw new Error("Candidate not found");
      return generateCandidateAssessment(candidate.id);
    },
    onSuccess: (generated) => {
      setActionError(null);
      queryClient.setQueryData(["candidateAssessments", "byCandidate", numCandidateId], generated);
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", numSessionId] });
      queryClient.invalidateQueries({ queryKey: ["gradingCandidates"] });
    },
    onError: (err) => {
      setActionError(errorMessage(err, "Failed to prepare the assessment form."));
    },
  });

  const startAssessmentMutation = useMutation({
    mutationFn: () => {
      if (!assessment) throw new Error("Assessment not found");
      return updateCandidateAssessment(assessment.id, { status: "IN_PROGRESS" });
    },
    onSuccess: (updated) => {
      setActionError(null);
      queryClient.setQueryData(["candidateAssessments", "byCandidate", numCandidateId], updated);
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", numSessionId] });
      queryClient.invalidateQueries({ queryKey: ["gradingCandidates"] });
    },
    onError: (err) => {
      setActionError(errorMessage(err, "Failed to start assessment."));
    },
  });

  // Item writes. Several can be in flight at once - scoring is fast -
  // so each keeps to its own item: writes to one item go out in the order
  // they were made, so the server keeps the last; each confirms or rolls back
  // only that item, and only if nothing newer was written to it since; and
  // the item list and rollup are refetched once, when every write has landed,
  // because a refetch between writes would overwrite those still in flight.
  const itemsKey = ["candidateAssessmentItems", assessment?.id];
  const itemWriteKey = ["assessmentItemWrite", assessment?.id];
  const pendingItemWrites = useIsMutating({ mutationKey: itemWriteKey });
  const itemWriteChains = useRef(new Map<number, Promise<unknown>>());
  const itemWriteSeq = useRef(new Map<number, number>());

  const patchItem = (
    itemId: number,
    change: (item: CandidateAssessmentItem) => CandidateAssessmentItem,
  ) => {
    queryClient.setQueryData<{ results: CandidateAssessmentItem[] }>(itemsKey, (data) =>
      data
        ? { ...data, results: data.results.map((item) => (item.id === itemId ? change(item) : item)) }
        : data,
    );
  };
  const isLatestWrite = (itemId: number, seq: number) =>
    itemWriteSeq.current.get(itemId) === seq;

  const updateItemMutation = useMutation({
    mutationKey: itemWriteKey,
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
      const previous = itemWriteChains.current.get(itemId) ?? Promise.resolve();
      const write = previous
        .catch(() => undefined)
        .then(() => updateCandidateAssessmentItem(itemId, payload));
      itemWriteChains.current.set(itemId, write);
      return write;
    },
    onMutate: async ({ itemId, result, notes }) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      const seq = (itemWriteSeq.current.get(itemId) ?? 0) + 1;
      itemWriteSeq.current.set(itemId, seq);
      const before = queryClient
        .getQueryData<{ results: CandidateAssessmentItem[] }>(itemsKey)
        ?.results.find((item) => item.id === itemId);
      patchItem(itemId, (item) => ({
        ...item,
        result: result !== undefined ? result : item.result,
        assessor_notes: notes !== undefined ? notes : item.assessor_notes,
      }));
      return { itemId, seq, before };
    },
    onSuccess: (saved, _vars, context) => {
      if (context && isLatestWrite(context.itemId, context.seq)) {
        patchItem(context.itemId, () => saved);
      }
    },
    onError: (err, _vars, context) => {
      if (context?.before && isLatestWrite(context.itemId, context.seq)) {
        const before = context.before;
        patchItem(context.itemId, () => before);
      }
      setActionError(errorMessage(err, "Could not save this result."));
    },
    onSettled: () => {
      // This write still counts as pending here, so 1 means it is the last.
      if (queryClient.isMutating({ mutationKey: itemWriteKey }) > 1) return;
      queryClient.invalidateQueries({ queryKey: itemsKey });
      // The rollup is served, so a scored item has to refetch it or the mat
      // bar and category headers go stale.
      queryClient.invalidateQueries({ queryKey: ["candidateAssessmentSummary", assessment?.id] });
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", "byCandidate", numCandidateId] });
    },
  });
  const isSavingItems = pendingItemWrites > 0;

  const deleteAssessmentMutation = useMutation({
    mutationFn: () => {
      if (!assessment) throw new Error("Assessment not found");
      return deleteCandidateAssessment(assessment.id);
    },
    onSuccess: () => {
      if (assessment && candidate) {
        forgetDeletedAssessment(queryClient, {
          assessmentId: assessment.id,
          candidateId: candidate.id,
        });
      }
      navigate(`/gradings/${numSessionId}`);
    },
  });
  const deleteAssessmentError =
    deleteAssessmentMutation.error instanceof ApiError ? deleteAssessmentMutation.error.message : null;

  if (isLoading) {
    return (
      <section aria-label="Candidate assessment" className="page page--wide caw-page" data-testid="caw-loading">
        <div className="caw-loading-state" role="status">
          <span className="status-dot status-dot-pulse" aria-hidden="true" />
          <p>Loading the assessment…</p>
        </div>
      </section>
    );
  }

  if (hasLoadError) {
    return (
      <section aria-label="Candidate assessment" className="page page--wide caw-page" data-testid="caw-load-error">
        <div className="caw-error-banner" role="alert">
          <p>
            The assessment summary could not be loaded, so scoring is paused rather than shown with counts that may be wrong. Reload to try again.
          </p>
          <Link to={`/gradings/${sessionId}`} className="btn-secondary">
            ← Return to session roster
          </Link>
        </div>
      </section>
    );
  }

  if (!session || !candidate) {
    return (
      <section aria-label="Candidate assessment" className="page page--wide caw-page" data-testid="caw-not-found">
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
  // The rollup is served and only refetched once a score settles, so while an
  // item PATCH is in flight `stats` still describes the pre-edit assessment.
  // Clearing a required result would otherwise leave completion enabled, and a
  // completion request that won the race could seal the assessment before the
  // clear landed.
  const canComplete = stats.canComplete && !isSavingItems;
  const isAssessmentCompleted = assessment?.status === "COMPLETED";
  const isAssessmentMissing = assessment === null;
  // The statuses assessment generation accepts (ASSESSMENT_GENERATION_SESSION_
  // STATUSES); a candidate registered after opening is prepared here too.
  const canPrepare = session.status === "DRAFT" || session.status === "OPEN";
  const isAssessmentNotStarted = assessment?.status === "NOT_STARTED";
  const isAssessmentInProgress = assessment?.status === "IN_PROGRESS";
  const isEditable = !!isAssessmentInProgress && !isAssessmentCompleted;

  const metWidth = stats.totalItems > 0 ? (stats.metCount / stats.totalItems) * 100 : 0;
  const notMetWidth = stats.totalItems > 0 ? (stats.notMetCount / stats.totalItems) * 100 : 0;

  return (
    <section aria-labelledby="caw-title" className="page page--wide caw-run" data-testid="caw-workspace">
      {/* One line of chrome, not four. */}
      <nav aria-label="Breadcrumbs" className="caw-breadcrumbs">
        <Link to="/gradings">Gradings</Link>
        <span aria-hidden="true" className="breadcrumb-separator">/</span>
        <Link to={`/gradings/${session.id}`}>{session.title}</Link>
        <span aria-hidden="true" className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">{candidate.student_display_name}</span>
      </nav>

      <header className="caw-identity">
        <h1 className="caw-candidate-name" id="caw-title">{candidate.student_display_name}</h1>
        {candidate.student_wksa_id && (
          <span className="caw-candidate-wksa">{candidate.student_wksa_id}</span>
        )}
        <span aria-hidden="true" className="caw-identity-divider" />
        <span className="caw-rank-tag">
          {candidate && <RankBelt rankId={candidate.from_rank} />}
          <span>{candidate?.from_rank_name ?? ""}</span>
        </span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="caw-rank-arrow">
          <path d="M4 12h15M14 7l5 5-5 5" />
        </svg>
        <span className="caw-rank-tag caw-rank-tag-dest">
          <RankBelt rankId={candidate.testing_for_rank} />
          <span>{candidate.testing_for_rank_name}</span>
        </span>
        <span className="caw-age-pill">{candidate.age_band_display}</span>
        <span
          className={`caw-status-pill caw-status-${(assessment?.status ?? "NOT_STARTED").toLowerCase()}`}
          data-testid="caw-status-pill"
        >
          <span className="caw-status-dot" aria-hidden="true" />
          {assessment?.status_display || "Not started"}
          {assessment?.started_at && ` · started ${formatTime(assessment.started_at)}`}
        </span>

        <div className="caw-identity-spacer" />

        {/* Provenance: who prepared the snapshot, and when it was frozen. */}
        {assessment?.generated_by_email && (
          <span className="caw-provenance">
            Form prepared by {assessment.generated_by_email}
            {assessment.generated_at && ` · ${formatDayMonth(assessment.generated_at)}`}
          </span>
        )}
        {currentUser?.can_delete_assessments && assessment && (
          <button
            type="button"
            className="caw-danger-btn"
            onClick={() => setDeleteOpen(true)}
            data-testid="caw-delete-assessment-btn"
          >
            Delete assessment
          </button>
        )}
      </header>

      {actionError && (
        <div className="caw-action-error" role="alert">
          <WarningIcon size={16} />
          <p>{actionError}</p>
        </div>
      )}

      {isAssessmentMissing && (
        <div className="caw-not-started-banner" data-testid="caw-missing-assessment-banner">
          <div className="caw-not-started-content">
            <h2>Prepare assessment form</h2>
            <p>
              Prepare the candidate&rsquo;s assessment form from the syllabus before starting. It keeps the syllabus as it is today, so later changes to the syllabus never alter it.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => generateAssessmentMutation.mutate()}
            disabled={generateAssessmentMutation.isPending || !canPrepare}
            data-testid="generate-assessment-btn"
          >
            {generateAssessmentMutation.isPending
              ? "Preparing..."
              : !canPrepare
              ? "Session must be draft or open to prepare"
              : "Prepare assessment form"}
          </button>
        </div>
      )}

      {/* A generated snapshot is started separately once the session is open. */}
      {isAssessmentNotStarted && (
        <div className="caw-not-started-banner" data-testid="caw-not-started-banner">
          <div className="caw-not-started-content">
            <h2>Assessment ready to begin</h2>
            <p>
              Candidates must have their assessment started before individual syllabus items
              can be scored.
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

      {/* The run itself: every requirement, in syllabus order, in one scroll. */}
      <div className="caw-run-scroll">
        {categoryGroups.length === 0 ? (
          <div className="caw-empty-items">
            <p>This assessment form has no items.</p>
          </div>
        ) : (
          categoryGroups.map((group) => (
            <div key={group.category} className="caw-band">
              <CategoryHeader group={group} />
              {group.items.map((item) => (
                <AssessmentItemRow
                  key={item.id}
                  item={item}
                  isEditable={isEditable}
                  isConfirmingClear={confirmingClearId === item.id}
                  isNoteOpen={openNoteId === item.id}
                  onAskClear={() => {
                    setOpenNoteId(null);
                    setConfirmingClearId(item.id);
                  }}
                  onCancelClear={() => setConfirmingClearId(null)}
                  onToggleNote={() => {
                    setConfirmingClearId(null);
                    setOpenNoteId((current) => (current === item.id ? null : item.id));
                  }}
                  onUpdateResult={(result) => {
                    setConfirmingClearId(null);
                    updateItemMutation.mutate({ itemId: item.id, result });
                  }}
                  onUpdateNotes={(notes) => updateItemMutation.mutate({ itemId: item.id, notes })}
                />
              ))}
            </div>
          ))
        )}

        {categoryGroups.length > 0 && (
          <p className="caw-run-end">
            End of assessment form · {categoryGroups.length}{" "}
            {categoryGroups.length === 1 ? "category" : "categories"}
            {assessment?.generated_at && ` · prepared ${formatDayMonth(assessment.generated_at)}`} from{" "}
            {candidate.age_band_display}
          </p>
        )}
      </div>

      {/* Persistent mat bar: the live count and the only completion action. */}
      <div className="caw-mat-bar" data-testid="caw-mat-bar">
        <div className="caw-mat-count" role="status" aria-live="polite">
          <span className="caw-mat-figure">{`${stats.requiredAssessed} / ${stats.requiredItems}`}</span>
          <span className="caw-mat-figure-label">required assessed</span>
        </div>

        <span aria-hidden="true" className="caw-mat-track">
          <span className="caw-mat-track-met" style={{ width: `${metWidth}%` }} />
          <span className="caw-mat-track-not-met" style={{ width: `${notMetWidth}%` }} />
        </span>

        <span className="caw-mat-tally caw-mat-tally-met">
          <CheckIcon size={13} />
          {`${stats.metCount} met`}
        </span>
        <span className="caw-mat-tally caw-mat-tally-not-met">
          <CrossIcon size={13} />
          {`${stats.notMetCount} not met`}
        </span>
        <span className="caw-mat-tally caw-mat-tally-remaining">
          {`${stats.remainingRequired} remaining`}
        </span>

        <div className="caw-identity-spacer" />

        {isAssessmentCompleted ? (
          <Link className="btn-secondary caw-review-btn" to={reviewPath} data-testid="caw-view-review-btn">
            View completion record →
          </Link>
        ) : (
          <button
            type="button"
            className={`caw-complete-action-btn ${canComplete ? "caw-complete-ready" : ""}`}
            disabled={!canComplete}
            onClick={() => navigate(reviewPath)}
            title={
              isSavingItems
                ? "Saving the last result"
                : stats.canComplete
                ? "Proceed to completion review"
                : `${stats.remainingRequired} required items remain unassessed`
            }
            data-testid="caw-complete-assessment-btn"
          >
            {isSavingItems
              ? "Saving..."
              : stats.canComplete
              ? "Complete assessment →"
              : `Complete assessment (${stats.remainingRequired} required remaining)`}
          </button>
        )}
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

/**
 * Sticky band header. It carries the category's own progress, which is what
 * the removed sub-rail was really for - the instructor wants to know where
 * they are in the section they are standing in, not to jump to another one.
 */
function CategoryHeader({ group }: { group: CategoryGroup }) {
  const filled = group.requiredCount > 0 ? (group.requiredAssessedCount / group.requiredCount) * 100 : 100;

  return (
    <div className="caw-band-header" data-testid={`caw-cat-header-${group.category}`}>
      <h2 className="caw-band-title">
        {group.categoryDisplay}
      </h2>
      <span aria-hidden="true" className="caw-band-rule" />
      <span className="caw-band-progress">
        {group.isDone
          ? `${group.requiredCount} of ${group.requiredCount} required`
          : `${group.requiredAssessedCount} of ${group.requiredCount} required`}
      </span>
      <span aria-hidden="true" className="caw-band-track">
        <span className="caw-band-track-fill" style={{ width: `${filled}%` }} />
      </span>
    </div>
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
          <button type="button" className="caw-danger-btn" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Deleting…" : "Delete assessment"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One requirement, as a divider-led row.
 *
 * Two verdict targets. `Clear` sits with the row tools rather than in the
 * verdict group, and confirms inline naming the assessor and time it erases:
 * the `candidate_item_assessor_matches_result` constraint nulls both when a
 * result returns to `NOT_ASSESSED`, and that attribution cannot be restored.
 */
function AssessmentItemRow({
  item,
  isEditable,
  isConfirmingClear,
  isNoteOpen,
  onAskClear,
  onCancelClear,
  onToggleNote,
  onUpdateResult,
  onUpdateNotes,
}: {
  item: CandidateAssessmentItem;
  isEditable: boolean;
  isConfirmingClear: boolean;
  isNoteOpen: boolean;
  onAskClear: () => void;
  onCancelClear: () => void;
  onToggleNote: () => void;
  onUpdateResult: (result: CandidateAssessmentItemResult) => void;
  onUpdateNotes: (notes: string) => void;
}) {
  const [notesValue, setNotesValue] = useState(item.assessor_notes || "");
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const metButtonRef = useRef<HTMLButtonElement>(null);
  const wasConfirmingRef = useRef(false);

  /*
    Opening the confirmation unmounts the `Clear` button that was focused, so
    without this a keyboard user is dropped back to the document instead of
    into the destructive prompt. Focus lands on the safe action.

    This is deliberately not `useDialogFocus`: that hook is for modals, and it
    hides body overflow and traps Tab. This confirmation is inline in a
    scrolling list and must not do either.
  */
  useEffect(() => {
    if (isConfirmingClear) {
      keepButtonRef.current?.focus();
      wasConfirmingRef.current = true;
      return;
    }
    if (wasConfirmingRef.current) {
      wasConfirmingRef.current = false;
      // After a cancel the `Clear` button is back. After a confirmed clear the
      // row has no result, so it is gone and the verdicts take focus instead.
      (clearButtonRef.current ?? metButtonRef.current)?.focus();
    }
  }, [isConfirmingClear]);

  const commitNotes = () => {
    if (notesValue !== (item.assessor_notes || "")) {
      onUpdateNotes(notesValue);
    }
    onToggleNote();
  };

  const isScored = item.result === "MET" || item.result === "NOT_MET";
  const attribution = item.assessor_email
    ? `${item.assessor_email}${item.assessed_at ? ` · ${formatTime(item.assessed_at)}` : ""}`
    : "";

  return (
    <div
      className={`caw-row caw-row-${(item.result ?? "NOT_ASSESSED").toLowerCase().replace("_", "-")}`}
      data-testid={`caw-item-${item.id}`}
    >
      <div className="caw-row-detail">
        <div className="caw-row-title-line">
          <span className="caw-row-seq">#{item.position}</span>
          <span className="caw-row-name">{item.item_name}</span>
          {item.korean_name && <span className="caw-row-korean">{item.korean_name}</span>}
          {item.required ? (
            <span className="caw-required-badge">Required</span>
          ) : (
            <span className="caw-optional-badge">Optional</span>
          )}
          {(item.display_range || item.notation) && (
            <span className="caw-row-range">{item.display_range || item.notation}</span>
          )}
        </div>

        {/* Chart notation is served as wording and shown as the range above,
            as the syllabus screen does; only other notes print here. */}
        {!item.notation && item.requirement_notes && (
          <p className="caw-row-desc">{item.requirement_notes}</p>
        )}

        {/*
          Attribution renders on every scored row. The previous screen showed
          it only on not-met rows, so "who marked this, and when" was invisible
          across most of the record.
        */}
        {(attribution || item.assessor_notes) && (
          <div className="caw-row-meta">
            {attribution && (
              <span className="caw-assessor-tag">
                <AssessorIcon />
                {attribution}
              </span>
            )}
            {item.assessor_notes && !isNoteOpen && (
              <span className="caw-row-note">“{item.assessor_notes}”</span>
            )}
          </div>
        )}
      </div>

      <div className="caw-row-actions">
        {isConfirmingClear ? (
          <div
            role="alertdialog"
            aria-label={`Confirm clearing the result for ${item.item_name}`}
            className="caw-clear-confirm"
            data-testid={`caw-clear-confirm-${item.id}`}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                onCancelClear();
              }
            }}
          >
            <p>
              Clearing also removes the record of who assessed it
              {attribution ? (
                <>
                  {" "}(<strong>{attribution}</strong>)
                </>
              ) : null}
              , and that cannot be restored.
            </p>
            <div className="caw-clear-confirm-actions">
              <button type="button" className="btn-secondary" onClick={onCancelClear} ref={keepButtonRef}>
                Keep
              </button>
              <button
                type="button"
                className="caw-danger-btn"
                onClick={() => onUpdateResult("NOT_ASSESSED")}
                data-testid={`btn-clear-confirm-${item.id}`}
              >
                Clear result
              </button>
            </div>
          </div>
        ) : (
          <div role="group" aria-label={`Result for ${item.item_name}`} className="caw-verdicts">
            <button
              type="button"
              className={`caw-verdict caw-verdict-met ${item.result === "MET" ? "caw-verdict-active" : ""}`}
              disabled={!isEditable}
              onClick={() => onUpdateResult("MET")}
              aria-pressed={item.result === "MET"}
              data-testid={`btn-met-${item.id}`}
              ref={metButtonRef}
            >
              <CheckIcon size={17} />
              Met
            </button>
            <button
              type="button"
              className={`caw-verdict caw-verdict-not-met ${item.result === "NOT_MET" ? "caw-verdict-active" : ""}`}
              disabled={!isEditable}
              onClick={() => onUpdateResult("NOT_MET")}
              aria-pressed={item.result === "NOT_MET"}
              data-testid={`btn-not-met-${item.id}`}
            >
              <CrossIcon size={17} />
              Not met
            </button>
          </div>
        )}

        {isEditable && !isConfirmingClear && (
          <div className="caw-row-tools">
            <button type="button" className="caw-row-tool" onClick={onToggleNote} data-testid={`btn-note-${item.id}`}>
              {item.assessor_notes ? "Edit note" : "Add note"}
            </button>
            {/* Clearing is only offered once there is a result to clear. */}
            {isScored && (
              <button
                type="button"
                className="caw-row-tool"
                onClick={onAskClear}
                data-testid={`btn-clear-${item.id}`}
                ref={clearButtonRef}
              >
                Clear
              </button>
            )}
          </div>
        )}

        {isNoteOpen && isEditable && (
          <div className="caw-row-note-edit">
            <textarea
              aria-label={`Assessor note for ${item.item_name}`}
              rows={2}
              className="caw-row-note-input"
              placeholder="Assessor note — what was observed"
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              onBlur={commitNotes}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setNotesValue(item.assessor_notes || "");
                  onToggleNote();
                }
              }}
              data-testid={`caw-note-input-${item.id}`}
              autoFocus
            />
          </div>
        )}
      </div>
    </div>
  );
}
