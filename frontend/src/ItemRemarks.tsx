/**
 * What was written on one requirement: every change of mark that carries a
 * reason (any change after the first mark, and any made after the lock) and
 * every comment, oldest first, each with who, when, and whether it came after
 * the lock. The one way the scoring rows, the sealed evidence and the
 * assessment record show them, so the permanent record holds everything the
 * marking screen does.
 */
import type { CandidateAssessmentItem } from "./api";
import { formatShortDateTime } from "./dates";
import { isReasonedChange } from "./remarks";

type Remarked = Pick<CandidateAssessmentItem, "id" | "comments" | "changes">;

function ByLine({ name, at, afterLock }: { name: string; at: string; afterLock: boolean }) {
  return (
    <span className="remarks__by">
      {" "}— {name}, {formatShortDateTime(at)}
      {afterLock ? ", after the lock" : ""}
    </span>
  );
}

export function ItemRemarks({ item }: { item: Remarked }) {
  const remarks = [
    ...item.changes.filter(isReasonedChange).map((change) => ({
      at: change.changed_at,
      line: (
        <li
          key={`change-${change.sequence}`}
          className="remarks__item remarks__item--change"
          data-testid={`remark-change-${item.id}-${change.sequence}`}
        >
          Changed from {change.from_result_display} to {change.to_result_display}
          {`: “${change.reason}”`}
          <ByLine name={change.changed_by_name} at={change.changed_at} afterLock={change.after_lock} />
        </li>
      ),
    })),
    ...item.comments.map((comment) => ({
      at: comment.created_at,
      line: (
        <li key={`comment-${comment.id}`} className="remarks__item" data-testid={`remark-comment-${comment.id}`}>
          “{comment.body}”
          <ByLine name={comment.author_name} at={comment.created_at} afterLock={comment.after_lock} />
        </li>
      ),
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  if (remarks.length === 0) return null;
  return <ul className="remarks">{remarks.map((remark) => remark.line)}</ul>;
}
