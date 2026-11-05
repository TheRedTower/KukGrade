/**
 * The sealed assessment as evidence for an outcome: the served counts,
 * every shortfall, every other item that has comments or a corrected mark,
 * with each comment's or correction's author, time and reason, and whether it
 * came after the lock - positive observations included, as on the
 * Certificate Proof. Shared by the Master's Cohort Adjudication
 * Board and the instructor's proposal drawer, so both read the same
 * evidence the same way.
 */
import { useId } from "react";
import { Link } from "react-router-dom";

import { Button } from "./Button";
import { formatShortDateTime, formatTime } from "./dates";
import { RESULT_WORDS } from "./resultWords";
import { ErrorText } from "./ErrorText";
import { WarningIcon } from "./Icons";
import { useAssessmentItemsQuery, useAssessmentSummaryQuery } from "./queries";
import "./SealedAssessmentEvidence.css";

export function SealedAssessmentEvidence({
  assessmentId,
  sessionId,
  candidateId,
  className,
}: {
  assessmentId: number | undefined;
  sessionId: number;
  candidateId: number;
  className: string;
}) {
  const titleId = useId();
  const summaryQuery = useAssessmentSummaryQuery(assessmentId);
  const itemsQuery = useAssessmentItemsQuery(assessmentId);

  const notedItems = (itemsQuery.data?.results ?? []).filter(
    (item) =>
      item.result === "NOT_MET" ||
      item.comments.length > 0 ||
      item.changes.some((change) => change.sequence > 1),
  );
  const shortfalls = notedItems.filter((item) => item.result === "NOT_MET");
  const otherNotes = notedItems.filter((item) => item.result !== "NOT_MET");
  const overall = summaryQuery.data?.overall;
  const failed = summaryQuery.isError || itemsQuery.isError;

  return (
    <section className={`evd ${className}`} aria-labelledby={titleId}>
      <h3 id={titleId}>Sealed assessment</h3>
      {assessmentId === undefined ? (
        <p className="evd-muted">No assessment recorded.</p>
      ) : failed ? (
        <ErrorText>
          The sealed assessment could not be loaded.{" "}
          <Button
            variant="link"
            onClick={() => {
              void summaryQuery.refetch();
              void itemsQuery.refetch();
            }}
          >
            Try again
          </Button>
        </ErrorText>
      ) : overall ? (
        <p className="evd-counts">
          {overall.required_met} / {overall.required} required met
          {" · "}
          {overall.not_met > 0 ? `${overall.not_met} not met` : "none not met"}
        </p>
      ) : (
        <p className="evd-muted" role="status">
          Loading the assessment…
        </p>
      )}
      {[shortfalls, otherNotes].map(
        (group, index) =>
          group.length > 0 && (
            <ul key={index} className="evd-notes">
              {group.map((item) => {
                const shortfall = item.result === "NOT_MET";
                return (
                  <li key={item.id} className={shortfall ? "evd-note evd-note-shortfall" : "evd-note"}>
                    <span className="evd-note-title">
                      {shortfall && <WarningIcon size={14} />} {item.item_name} ·{" "}
                      {item.category_display}
                      {!shortfall && ` · ${item.result_display}`}
                    </span>
                    {item.changes
                      .filter((change) => change.sequence > 1)
                      .map((change) => (
                        <span key={change.sequence} className="evd-comment" data-testid={`evd-change-${item.id}-${change.sequence}`}>
                          <q>{change.reason}</q>
                          <span className="evd-note-by">
                            Changed from {RESULT_WORDS[change.from_result]} to {RESULT_WORDS[change.to_result]} by{" "}
                            {change.changed_by_name}, {formatShortDateTime(change.changed_at)}
                            {change.after_lock ? ", after the lock" : ""}
                          </span>
                        </span>
                      ))}
                    {item.comments.map((comment) => (
                      <span key={comment.id} className="evd-comment">
                        <q>{comment.body}</q>
                        <span className="evd-note-by">
                          {comment.author_name}, {formatShortDateTime(comment.created_at)}
                          {comment.after_lock ? ", after the lock" : ""}
                        </span>
                      </span>
                    ))}
                    <span className="evd-note-by">
                      {item.assessor_email}
                      {item.assessed_at ? `, ${formatTime(item.assessed_at)}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          ),
      )}
      {assessmentId !== undefined && (
        <Link
          to={`/gradings/${sessionId}/assessments/${candidateId}/review`}
          className="evd-link"
        >
          Open the full assessment record
        </Link>
      )}
    </section>
  );
}
