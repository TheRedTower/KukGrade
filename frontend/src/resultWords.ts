import type { CandidateAssessmentItem, CandidateAssessmentItemResult } from "./api";

/** An item's mark in running text ("Changed from Met to not assessed"). */
export const RESULT_WORDS: Record<CandidateAssessmentItemResult, string> = {
  MET: "Met",
  NOT_MET: "Not met",
  NOT_ASSESSED: "not assessed",
};

/**
 * A change worth showing with its reason: any change after the first mark, and
 * any change made after the lock (even a first mark, which then needs a reason).
 */
export function isReasonedChange(change: { sequence: number; after_lock: boolean }): boolean {
  return change.sequence > 1 || change.after_lock;
}

/** Whether an item has anything for ItemRemarks to show: a comment or a reasoned change. */
export function hasRemarks(item: Pick<CandidateAssessmentItem, "comments" | "changes">): boolean {
  return item.comments.length > 0 || item.changes.some(isReasonedChange);
}
