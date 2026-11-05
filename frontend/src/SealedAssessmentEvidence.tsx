/**
 * The sealed assessment as evidence for an outcome: the served counts,
 * every shortfall, and every other item that has comments,
 * with each comment's author and time - positive observations included, as on the
 * Certificate Proof. Shared by the Master's Cohort Adjudication
 * Board and the instructor's proposal drawer, so both read the same
 * evidence the same way.
 */
import { useId } from "react";
import { Link } from "react-router-dom";

import { Button } from "./Button";
import { formatShortDateTime, formatTime } from "./dates";
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
    (item) => item.result === "NOT_MET" || item.comments.length > 0,
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
                    {item.comments.map((comment) => (
                      <span key={comment.id} className="evd-comment">
                        <q>{comment.body}</q>
                        <span className="evd-note-by">
                          {comment.author_name}, {formatShortDateTime(comment.created_at)}
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
