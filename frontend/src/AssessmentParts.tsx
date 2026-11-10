import { useEffect, useRef } from "react";
import { Alert } from "./Alert";
import { CandidateAssessmentItem, CandidateAssessmentItemResult } from "./api";
import { CategoryGroup } from "./candidateAssessmentData";
import { Dialog } from "./Dialog";
import { formatTime } from "./dates";
import { CheckIcon, CrossIcon } from "./Icons";
import { Button } from "./Button";
import { ItemDraftBox } from "./ItemDraftBox";
import { ItemRemarks } from "./ItemRemarks";
import { hasRemarks, RESULT_WORDS } from "./resultWords";
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
      <h2 className="caw-band-title item-title">
        {group.categoryDisplay}
      </h2>
      <span aria-hidden="true" className="caw-band-rule" />
      <span className="caw-band-progress meta">
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
      <p className="gsd-modal-message subtext">
        Permanently delete {candidateName}&apos;s assessment? Any proposed outcome is
        deleted with it. This cannot be undone.
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
 * Two verdict targets. The first mark on an item is made at once. Changing a
 * mark afterwards, or clearing it with `Clear` (which sits with the row tools
 * rather than in the verdict group), asks for the reason first, and the reason
 * and the change are kept: every change is on the record, whoever made it. A
 * clear also erases who assessed the item and when (the
 * `candidate_item_assessor_matches_result` constraint nulls both when a result
 * returns to `NOT_ASSESSED`), so the prompt says so.
 */
export function AssessmentItemRow({
  item,
  canEdit,
  reasonAlways,
  assessmentCompleted,
  pendingResult,
  isCommentOpen,
  onMark,
  onAskChange,
  onCancelChange,
  onChangeResult,
  onToggleComment,
  onCloseComment,
  onAddComment,
}: {
  item: CandidateAssessmentItem;
  /** Marks and comments may change: the assessment is started, the session is open. */
  canEdit: boolean;
  /** After the lock every correction asks why, the first mark included. */
  reasonAlways: boolean;
  assessmentCompleted: boolean;
  /** The mark this row is asking a reason for, when it is. */
  pendingResult: CandidateAssessmentItemResult | null;
  isCommentOpen: boolean;
  /** The first mark on an unmarked item: no reason needed. */
  onMark: (result: CandidateAssessmentItemResult) => void;
  onAskChange: (result: CandidateAssessmentItemResult) => void;
  onCancelChange: () => void;
  onChangeResult: (result: CandidateAssessmentItemResult, reason: string) => Promise<unknown>;
  onToggleComment: () => void;
  /** Closes this row's comment box only, whatever else has been opened since. */
  onCloseComment: () => void;
  onAddComment: (body: string) => Promise<unknown>;
}) {
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const metButtonRef = useRef<HTMLButtonElement>(null);
  const wasAskingRef = useRef(false);

  /*
    Asking for a reason replaces the verdict buttons, which unmounts whatever
    button was focused; closing it brings them back. Focus is put back on a
    button that is there so a keyboard user is not dropped onto the document.

    This is deliberately not `useDialogFocus`: that hook is for modals, and it
    hides body overflow and traps Tab. This prompt is inline in a scrolling
    list and must not do either.
  */
  const isAsking = pendingResult !== null;
  useEffect(() => {
    if (isAsking) {
      wasAskingRef.current = true;
      return;
    }
    if (wasAskingRef.current) {
      wasAskingRef.current = false;
      (clearButtonRef.current ?? metButtonRef.current)?.focus();
    }
  }, [isAsking]);

  const isScored = item.result === "MET" || item.result === "NOT_MET";
  const attribution = item.assessor_email
    ? `${item.assessor_email}${item.assessed_at ? ` · ${formatTime(item.assessed_at)}` : ""}`
    : "";
  // A completed assessment keeps every required item marked: it can be changed,
  // not emptied.
  const canClear = canEdit && isScored && !(assessmentCompleted && item.required);
  // The first mark on an item is made at once. Anything after it, including
  // marking an item again after it was cleared, asks why; and once the session
  // is locked every correction does.
  const hasHistory = item.changes.length > 0;
  const choose = (result: CandidateAssessmentItemResult) => {
    if (result === item.result) return;
    if (isScored || hasHistory || reasonAlways) onAskChange(result);
    else onMark(result);
  };
  const clearing = pendingResult === "NOT_ASSESSED";

  return (
    <div
      className={`caw-row caw-row-${(item.result ?? "NOT_ASSESSED").toLowerCase().replace("_", "-")}`}
      data-testid={`caw-item-${item.id}`}
    >
      <div className="caw-row-detail">
        <div className="caw-row-title-line">
          <span className="caw-row-seq meta">#{item.position}</span>
          <span className="item-title">{item.item_name}</span>
          {item.korean_name && <span className="meta" lang="ko">{item.korean_name}</span>}
          <RequirementBadge required={item.required} />
          {(item.display_range || item.notation) && (
            <span className="caw-row-range meta">{item.display_range || item.notation}</span>
          )}
        </div>

        {/* Chart notation is served as wording and shown as the range above,
            as the syllabus screen does; only other notes print here. */}
        {!item.notation && item.requirement_notes && (
          <p className="caw-row-desc meta">{item.requirement_notes}</p>
        )}

        {/*
          Attribution renders on every scored row. The previous screen showed
          it only on not-met rows, so "who marked this, and when" was invisible
          across most of the record.
        */}
        {(attribution || hasRemarks(item)) && (
          <div className="caw-row-meta">
            {attribution && (
              <span>
                <AssessorIcon />
                {attribution}
              </span>
            )}
            <ItemRemarks item={item} />
          </div>
        )}
      </div>

      <div className="caw-row-actions">
        {isAsking ? (
          <div
            role="alertdialog"
            aria-label={`Reason for changing the result for ${item.item_name}`}
            className="caw-change-prompt"
            data-testid={`caw-change-prompt-${item.id}`}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                onCancelChange();
              }
            }}
          >
            <p>
              {clearing ? (
                <>
                  Clearing removes the record of who assessed it
                  {attribution ? (
                    <>
                      {" "}(<strong>{attribution}</strong>)
                    </>
                  ) : null}
                  . The change and your reason are kept. Why is the mark being cleared?
                </>
              ) : isScored ? (
                <>
                  Changing {RESULT_WORDS[item.result ?? "NOT_ASSESSED"]} to {RESULT_WORDS[pendingResult]}. Why is the mark
                  changing? The change and your reason are kept.
                </>
              ) : hasHistory ? (
                <>
                  Marking this item {RESULT_WORDS[pendingResult]} again, after it was cleared. Why is the mark
                  changing? The change and your reason are kept.
                </>
              ) : (
                <>
                  Marking this item {RESULT_WORDS[pendingResult]}, after the session was locked. Why is the mark
                  being made? The change and your reason are kept.
                </>
              )}
            </p>
            <ItemDraftBox
              ariaLabel={`Why is the mark changing for ${item.item_name}`}
              placeholder="The reason for the change"
              saveLabel={clearing ? "Clear result" : "Save change"}
              inputTestId={`caw-reason-input-${item.id}`}
              saveTestId={`btn-reason-save-${item.id}`}
              cancelTestId={`btn-reason-cancel-${item.id}`}
              onSubmit={(reason) => onChangeResult(pendingResult, reason)}
              onClose={onCancelChange}
            />
          </div>
        ) : (
          <div role="group" aria-label={`Result for ${item.item_name}`} className="caw-verdicts">
            <button
              type="button"
              className={`caw-verdict caw-verdict-met ${item.result === "MET" ? "caw-verdict-active" : ""}`}
              disabled={!canEdit}
              onClick={() => choose("MET")}
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
              disabled={!canEdit}
              onClick={() => choose("NOT_MET")}
              aria-pressed={item.result === "NOT_MET"}
              data-testid={`btn-not-met-${item.id}`}
            >
              <CrossIcon size={17} />
              Not met
            </button>
          </div>
        )}

        {canEdit && !isAsking && (
          <div className="caw-row-tools">
            <button type="button" className="caw-row-tool meta" onClick={onToggleComment} data-testid={`btn-comment-${item.id}`}>
              Add comment
            </button>
            {/* Clearing is only offered once there is a result to clear. */}
            {canClear && (
              <button
                type="button"
                className="caw-row-tool meta"
                onClick={() => onAskChange("NOT_ASSESSED")}
                data-testid={`btn-clear-${item.id}`}
                ref={clearButtonRef}
              >
                Clear
              </button>
            )}
          </div>
        )}

        {isCommentOpen && canEdit && !isAsking && (
          <ItemDraftBox
            ariaLabel={`Comment on ${item.item_name}`}
            placeholder="Add a comment — what was observed"
            saveLabel="Save comment"
            inputTestId={`caw-comment-input-${item.id}`}
            saveTestId={`btn-comment-save-${item.id}`}
            onSubmit={onAddComment}
            onClose={onCloseComment}
          />
        )}
      </div>
    </div>
  );
}
