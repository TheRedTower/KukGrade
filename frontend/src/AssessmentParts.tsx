import { useEffect, useRef, useState } from "react";
import { Alert } from "./Alert";
import { CandidateAssessmentItem, CandidateAssessmentItemResult } from "./api";
import { CategoryGroup } from "./candidateAssessmentData";
import { Dialog } from "./Dialog";
import { formatShortDateTime, formatTime } from "./dates";
import { CheckIcon, CrossIcon } from "./Icons";
import { Button } from "./Button";
import { Meter } from "./Meter";
import { RequirementBadge } from "./StatusBadge";

function AssessorIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c0-3.6 3.1-5.8 7-5.8s7 2.2 7 5.8" />
    </svg>
  );
}

/**
 * Sticky band header. It carries the category's own progress, which is what
 * the removed sub-rail was really for - the instructor wants to know where
 * they are in the section they are standing in, not to jump to another one.
 */
export function CategoryHeader({ group }: { group: CategoryGroup }) {
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
      <Meter className="caw-band-meter" segments={[{ percent: filled, tone: "success" }]} />
    </div>
  );
}

export function DeleteAssessmentDialog({
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
  return (
    <Dialog title="Delete assessment" closeButton={false} onClose={onClose} canClose={!isPending}>
      <p className="gsd-modal-message">
        Permanently delete {candidateName}&apos;s assessment? If it has a finalised outcome
        or promotion, those are deleted too and the student's rank is reverted. This cannot
        be undone.
      </p>
      {error && (
        <Alert>{error}</Alert>
      )}
      <div className="action-row action-row--end">
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={isPending}
          data-dialog-autofocus
        >
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={isPending}>
          {isPending ? "Deleting…" : "Delete assessment"}
        </Button>
      </div>
    </Dialog>
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
export function AssessmentItemRow({
  item,
  isEditable,
  isConfirmingClear,
  isCommentOpen,
  onAskClear,
  onCancelClear,
  onToggleComment,
  onUpdateResult,
  onAddComment,
}: {
  item: CandidateAssessmentItem;
  isEditable: boolean;
  isConfirmingClear: boolean;
  isCommentOpen: boolean;
  onAskClear: () => void;
  onCancelClear: () => void;
  onToggleComment: () => void;
  onUpdateResult: (result: CandidateAssessmentItemResult) => void;
  onAddComment: (body: string) => void;
}) {
  const [draft, setDraft] = useState("");
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

  // A comment is kept as written, so it is added on purpose, never by leaving the box.
  // On a computer that means Enter (Shift+Enter starts a new line). On a phone
  // or tablet the Enter key is how a line break is typed, and a stray tap on it
  // must not save a half-typed comment, so there only the button saves.
  const submitComment = () => {
    const body = draft.trim();
    if (!body) return;
    onAddComment(body);
    setDraft("");
    onToggleComment();
  };
  const closeComment = () => {
    setDraft("");
    onToggleComment();
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
          <RequirementBadge required={item.required} />
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
        {(attribution || item.comments.length > 0) && (
          <div className="caw-row-meta">
            {attribution && (
              <span>
                <AssessorIcon />
                {attribution}
              </span>
            )}
            {item.comments.map((comment) => (
              <span key={comment.id} className="caw-row-note">
                “{comment.body}”
                <span className="caw-row-note-by">
                  {" "}— {comment.author_name}, {formatShortDateTime(comment.created_at)}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="caw-row-actions">
        {isConfirmingClear ? (
          <div
            role="alertdialog"
            aria-label={`Confirm clearing the result for ${item.item_name}`}
            aria-describedby={`caw-clear-confirm-text-${item.id}`}
            className="caw-clear-confirm"
            data-testid={`caw-clear-confirm-${item.id}`}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                onCancelClear();
              }
            }}
          >
            <p id={`caw-clear-confirm-text-${item.id}`}>
              Clearing also removes the record of who assessed it
              {attribution ? (
                <>
                  {" "}(<strong>{attribution}</strong>)
                </>
              ) : null}
              , and that cannot be restored.
            </p>
            <div className="caw-clear-confirm-actions">
              <Button variant="secondary" onClick={onCancelClear} ref={keepButtonRef}>
                Keep
              </Button>
              <Button
                variant="danger"
                onClick={() => onUpdateResult("NOT_ASSESSED")}
                data-testid={`btn-clear-confirm-${item.id}`}
              >
                Clear result
              </Button>
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
            <button type="button" className="caw-row-tool" onClick={onToggleComment} data-testid={`btn-comment-${item.id}`}>
              Add comment
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

        {isCommentOpen && isEditable && (
          <div className="caw-row-note-edit">
            <textarea
              aria-label={`Comment on ${item.item_name}`}
              rows={2}
              className="caw-row-note-input"
              placeholder="Add a comment — what was observed"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              enterKeyHint="enter"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  closeComment();
                } else if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  !window.matchMedia("(pointer: coarse)").matches
                ) {
                  e.preventDefault();
                  submitComment();
                }
              }}
              data-testid={`caw-comment-input-${item.id}`}
              autoFocus
            />
            <div className="caw-row-note-actions">
              <Button variant="secondary" onClick={closeComment}>
                Cancel
              </Button>
              <Button onClick={submitComment} disabled={!draft.trim()} data-testid={`btn-comment-save-${item.id}`}>
                Save comment
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
