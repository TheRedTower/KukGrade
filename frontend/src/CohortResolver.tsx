import { Link } from "react-router-dom";

import type { BulkCandidateRegistrationResponse, GradingSession, Rank, StudentListItem } from "./api";
import { Alert } from "./Alert";
import { Badge } from "./Badge";
import { PageHeader } from "./PageHeader";
import { SessionFacts } from "./SessionParts";
import { Button } from "./Button";
import { CheckIcon, ChevronRightIcon, WarningIcon } from "./Icons";
import { CandidateRanks } from "./RankTransition";
import { buttonClass } from "./buttonClass";
import { ResponsiveTable } from "./ResponsiveTable";
import { StudentStatusBadge } from "./StatusBadge";
import { counted } from "./plural";
import { ExternalLink } from "./ExternalLink";

/** A student the registration refused, with why, as the resolver lists them. */
export interface FlaggedCandidateItem {
  key: string;
  student: StudentListItem;
  destinationRank: Rank | null;
  error: string;
  /** Set when the student is already registered, which no retry changes. */
  registered?: BulkCandidateRegistrationResponse["already_registered"][string];
}

/**
 * After a registration that refused some students: who was registered, who
 * was flagged and why, and a retry for the ones that can be sent again.
 */
export function CohortResolver({
  session,
  registrationResult,
  flaggedItems,
  isSubmitting,
  submitError,
  onDismissError,
  onRemove,
  onRetry,
}: {
  session: GradingSession;
  registrationResult: BulkCandidateRegistrationResponse;
  flaggedItems: FlaggedCandidateItem[];
  isSubmitting: boolean;
  submitError: string | null;
  onDismissError: () => void;
  onRemove: (key: string) => void;
  onRetry: () => void;
}) {
  const createdCount = registrationResult.created.length;
  const flaggedCount = flaggedItems.length;
  const retryableCount = flaggedItems.filter((i) => !i.registered).length;

  return (
    <section aria-labelledby="bgc-resolver-title" className="page" data-testid="bgc-page">
      <PageHeader
        back={{ to: `/gradings/${session.id}`, label: session.title }}
        title="Resolve flagged candidates"
        titleId="bgc-resolver-title"
        subtitle="Successful registrations are already saved."
        tag={
          <>
            <Badge tone="success" icon={<CheckIcon size={14} />}>
              {createdCount} registered
            </Badge>
            <Badge tone="warning" icon={<WarningIcon size={14} />}>
              {flaggedCount} flagged
            </Badge>
          </>
        }
      >
        <p className="page-header__subtitle">
          <SessionFacts session={session} />
        </p>
      </PageHeader>

      {submitError && <Alert onDismiss={onDismissError}>{submitError}</Alert>}

      {/* Flagged items table section */}
      <section className="stack stack--3 bgc-resolver-section">
        <div className="bgc-section-header">
          <div>
            <h2 className="section-title">{counted(flaggedCount, "candidate needs", "candidates need")} attention</h2>
            <p className="bgc-section-subtext">
              These candidates could not be registered. Resolve the issues below, then retry only the flagged
              candidates.
            </p>
          </div>
        </div>

        <ResponsiveTable
          label="Flagged candidates"
          rows={flaggedItems}
          rowKey={(item) => item.key}
          columns={[
            {
              key: "student",
              header: "Student",
              primary: true,
              render: (item) => (
                <>
                  <span className="item-title">
                    {item.student.first_name} {item.student.last_name}
                  </span>
                  <span className="bgc-student-id meta">{item.student.wksa_id}</span>
                </>
              ),
            },
            { key: "issue", header: "Issue", render: (item) => <span className="error-text">{item.error}</span> },
            {
              key: "status",
              header: "Status",
              render: (item) =>
                item.registered ? (
                  <Badge tone="neutral">
                    {/* One grading at a time: held by another grading, not this one. */}
                    {item.registered === "THIS_SESSION" ? "No retry needed" : "Registered for another grading"}
                  </Badge>
                ) : (
                  <StudentStatusBadge status={item.student.status} label={item.student.status_display} />
                ),
            },
            {
              key: "actions",
              header: "Actions",
              actions: true,
              render: (item) => (
                <>
                  <ExternalLink
                    to={`/students/${item.student.id}`}
                    className={buttonClass({ variant: "ghost", small: true })}
                  >
                    View student
                  </ExternalLink>
                  <Button variant="danger-quiet" small disabled={isSubmitting} onClick={() => onRemove(item.key)}>
                    Remove from list
                  </Button>
                </>
              ),
            },
          ]}
        />
      </section>

      {/* Collapsible successful registrations */}
      {createdCount > 0 && (
        <details className="disclosure bgc-successful-section">
          <summary>
            <ChevronRightIcon />
            <span>View {counted(createdCount, "successful registration", "successful registrations")}</span>
            <span className="bgc-accordion-count meta">
              {createdCount} registered · {flaggedCount} flagged
            </span>
          </summary>
          <div className="disclosure__body bgc-accordion-content">
            <ul className="stack stack--2 list-plain">
              {registrationResult.created.map((entry) => (
                <li key={entry.candidate.id} className="row row--wrap bgc-created-item">
                  <span className="item-title">{entry.candidate.student_display_name}</span>
                  <span className="meta">({entry.candidate.student_wksa_id})</span>
                  <CandidateRanks candidate={entry.candidate} />
                  {entry.assessment && <Badge tone="info">Form created (Not started)</Badge>}
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      {/* Footer actions */}
      <footer className="bgc-resolver-footer">
        <Link
          to={`/gradings/${session.id}`}
          className={buttonClass({ variant: "ghost" })}
          data-testid="bgc-finish-view-session-btn"
        >
          Finish and view {session.title}
        </Link>

        <div className="bgc-retry-action-wrap">
          <Button
            variant="primary"
            onClick={onRetry}
            disabled={isSubmitting || retryableCount === 0}
            data-testid="bgc-retry-flagged-btn"
          >
            {isSubmitting ? "Retrying…" : `Save changes and retry ${retryableCount}`}
          </Button>
          <span className="meta">Only resolved candidates will be retried.</span>
        </div>
      </footer>
    </section>
  );
}
