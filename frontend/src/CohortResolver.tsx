import { useState } from "react";
import { Link } from "react-router-dom";

import type { BulkCandidateRegistrationResponse, GradingSession, Rank, StudentListItem } from "./api";
import { Alert } from "./Alert";
import { Badge } from "./Badge";
import { Breadcrumbs } from "./Breadcrumbs";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import { ResponsiveTable } from "./ResponsiveTable";
import { formatSessionDate } from "./dates";
import { SessionStatusBadge, StudentStatusBadge } from "./StatusBadge";

/** A student the registration refused, with why, as the resolver lists them. */
export interface FlaggedCandidateItem {
  key: string;
  student: StudentListItem;
  destinationRank: Rank | null;
  error: string;
  isAlreadyRegistered: boolean;
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
  const [showSuccessfulList, setShowSuccessfulList] = useState(false);
  const createdCount = registrationResult.created.length;
  const flaggedCount = flaggedItems.length;
  const retryableCount = flaggedItems.filter((i) => !i.isAlreadyRegistered).length;

  return (
    <section aria-labelledby="bgc-resolver-title" className="page page--wide bgc-page" data-testid="bgc-page">
      <Breadcrumbs
        items={[
          { label: "Gradings", to: "/gradings" },
          { label: session.title, to: `/gradings/${session.id}` },
          { label: "Resolve flagged candidates" },
        ]}
      />

      {/* Header */}
      <header className="bgc-header">
        <h1 className="bgc-title" id="bgc-resolver-title">Resolve flagged candidates</h1>
        <div className="bgc-resolver-summary-bar">
          <span className="bgc-summary-pill bgc-summary-success">
            <span className="bgc-summary-icon" aria-hidden="true">✓</span>
            {createdCount} registered
          </span>
          <span className="bgc-summary-pill bgc-summary-flagged">
            <span className="bgc-summary-icon" aria-hidden="true">!</span>
            {flaggedCount} flagged
          </span>
          <span className="bgc-resolver-subtext">Successful registrations are already saved.</span>
        </div>
      </header>

      {/* Session card strip */}
      <div className="bgc-session-card">
        <div className="bgc-session-card-left">
          <span className="bgc-session-title">{session.title}</span>
          <SessionStatusBadge status={session.status} label={session.status_display} />
        </div>
        <div className="bgc-session-card-meta">
          <span>{formatSessionDate(session.grading_date)}</span>
          <span className="bgc-meta-sep" aria-hidden="true">·</span>
          <span>{session.location || "No location specified"}</span>
        </div>
      </div>

      {submitError && (
        <Alert onDismiss={onDismissError}>{submitError}</Alert>
      )}

      {/* Flagged items table section */}
      <section className="bgc-section bgc-resolver-section">
        <div className="bgc-section-header">
          <div>
            <h2 className="bgc-section-title">
              {flaggedCount === 1 ? "1 candidate needs attention" : `${flaggedCount} candidates need attention`}
            </h2>
            <p className="bgc-section-subtext">
              These candidates could not be registered. Resolve the issues below, then retry only the flagged candidates.
            </p>
          </div>
          <span className="bgc-resolver-counter">
            Showing {flaggedCount} of {flaggedCount} flagged candidates
          </span>
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
                  <span className="bgc-student-name">
                    {item.student?.first_name} {item.student?.last_name}
                  </span>
                  <span className="bgc-student-id">{item.student?.wksa_id}</span>
                </>
              ),
            },
            { key: "issue", header: "Issue", render: (item) => <span className="bgc-issue-text">{item.error}</span> },
            {
              key: "status",
              header: "Status",
              render: (item) =>
                item.isAlreadyRegistered ? (
                  <Badge tone="neutral">
                    {/* One grading at a time: held by another grading, not this one. */}
                    {item.error.includes("for this session") ? "No retry needed" : "Registered for another grading"}
                  </Badge>
                ) : (
                  <StudentStatusBadge status={item.student?.status} label={item.student?.status_display} />
                ),
            },
            {
              key: "actions",
              header: "Actions",
              actions: true,
              render: (item) => (
                <div className="bgc-row-actions">
                  <Link
                    to={`/students/${item.student?.id}`}
                    className={buttonClass({ variant: "ghost", small: true })}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View student<span className="visually-hidden"> (opens in a new tab)</span>
                  </Link>
                  <Button
                    variant="danger-quiet" small
                    disabled={isSubmitting}
                    onClick={() => onRemove(item.key)}
                  >
                    Remove from list
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </section>

      {/* Collapsible successful registrations */}
      {createdCount > 0 && (
        <section className="bgc-successful-section">
          <button
            type="button"
            className="bgc-accordion-toggle"
            onClick={() => setShowSuccessfulList((prev) => !prev)}
            aria-expanded={showSuccessfulList}
          >
            <span className="bgc-accordion-chevron" aria-hidden="true">
              {showSuccessfulList ? "▾" : "▸"}
            </span>
            <span>View {createdCount} successful registration{createdCount === 1 ? "" : "s"}</span>
            <span className="bgc-accordion-count">
              {createdCount} registered · {flaggedCount} flagged
            </span>
          </button>

          {showSuccessfulList && (
            <div className="bgc-accordion-content">
              <ul className="bgc-created-list">
                {registrationResult.created.map((entry) => (
                  <li key={entry.candidate.id} className="bgc-created-item">
                    <span className="bgc-created-name">{entry.candidate.student_display_name}</span>
                    <span className="bgc-created-wksa">({entry.candidate.student_wksa_id})</span>
                    <span className="bgc-created-rank">➔ {entry.candidate.testing_for_rank_name}</span>
                    {entry.assessment && (
                      <Badge tone="info">Form created (Not started)</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
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
            {isSubmitting ? "Retrying..." : `Save changes and retry ${retryableCount}`}
          </Button>
          <span className="bgc-retry-helper-text">Only resolved candidates will be retried.</span>
        </div>
      </footer>
    </section>
  );
}
