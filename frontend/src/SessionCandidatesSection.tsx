import { Link } from "react-router-dom";

import type { GradingSession } from "./api";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import { Alert } from "./Alert";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";
import { type EnrichedCandidate, type NextAction, SessionCandidateTable } from "./SessionParts";
import type { useCandidateWork } from "./useCandidateWork";

interface SessionCandidatesSectionProps {
  session: GradingSession;
  /** Every candidate, and the ones the search and filter leave. */
  all: EnrichedCandidate[];
  shown: EnrichedCandidate[];
  search: string;
  onSearch: (search: string) => void;
  /** Whether the server has answered the search: it may be on its way, or have failed. */
  searchStatus: "idle" | "searching" | "failed";
  onRetrySearch: () => void;
  statusFilter: string;
  onStatusFilter: (status: string) => void;
  work: ReturnType<typeof useCandidateWork>;
  /** Who is offered "Confirm attendance", who is offered "Prepare all" and "Start all". */
  attendanceCount: number;
  unpreparedIds: number[];
  preparedIds: number[];
  nextActionFor: (item: EnrichedCandidate) => NextAction;
  onConfirmAttendance: () => void;
}

/** The roster of a session: its toolbar, and a table or the reason there is none. */
export function SessionCandidatesSection({
  session,
  all,
  shown,
  search,
  onSearch,
  searchStatus,
  onRetrySearch,
  statusFilter,
  onStatusFilter,
  work,
  attendanceCount,
  unpreparedIds,
  preparedIds,
  nextActionFor,
  onConfirmAttendance,
}: SessionCandidatesSectionProps) {
  const { bulkPrepare, bulkStart } = work;

  return (
    <section className="gsd-candidates-section" aria-labelledby="candidates-heading">
      <div className="action-row">
        <h2 id="candidates-heading" className="section-title">
          Candidates
        </h2>

        <div className="action-row">
          {attendanceCount > 0 && (
            <Button variant="secondary" onClick={onConfirmAttendance}>
              Confirm attendance
            </Button>
          )}
          {unpreparedIds.length > 0 && (
            <Button variant="secondary" onClick={() => bulkPrepare.mutate(unpreparedIds)} disabled={bulkPrepare.isPending}>
              {bulkPrepare.isPending ? "Preparing…" : `Prepare all (${unpreparedIds.length})`}
            </Button>
          )}
          {preparedIds.length > 0 && (
            <Button variant="primary" onClick={() => bulkStart.mutate(preparedIds)} disabled={bulkStart.isPending}>
              {bulkStart.isPending ? "Starting…" : `Start all prepared (${preparedIds.length})`}
            </Button>
          )}
        </div>
      </div>

      <div className="filter-bar" role="search" aria-label="Candidate filters">
        <label className="field field--search">
          <span>Search</span>
          <input
            type="search"
            placeholder="Name, ID, rank or status"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            data-testid="gsd-candidate-search"
          />
        </label>

        <label className="field">
          <span>Assessment</span>
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilter(e.target.value)}
            data-testid="gsd-status-filter"
          >
            <option value="ALL">Any status</option>
            <option value="NOT_STARTED">Not started</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="WITHDRAWN">Withdrawn</option>
          </select>
        </label>
        <p className="filter-bar__count">
          {shown.length} candidate{shown.length === 1 ? "" : "s"}
        </p>
      </div>

      {all.length === 0 ? (
        <EmptyState
          framed
          data-testid="gsd-empty-roster"
          title="No candidates registered in this grading session yet."
          action={
            session.roster_open ? (
              <Link to={`/gradings/${session.id}/register`} className={buttonClass({ variant: "primary" })}>
                Add candidate <span aria-hidden="true">→</span>
              </Link>
            ) : undefined
          }
        >
          Add students to begin curriculum assessment and outcome tracking.
        </EmptyState>
      ) : searchStatus === "searching" ? (
        <LoadingState>Searching…</LoadingState>
      ) : searchStatus === "failed" ? (
        <Alert
          data-testid="gsd-search-failed"
          action={
            <Button variant="secondary" onClick={onRetrySearch}>
              Try again
            </Button>
          }
        >
          The search could not be completed, so no candidates are shown for it.
        </Alert>
      ) : shown.length === 0 ? (
        <EmptyState
          framed
          data-testid="gsd-empty-search"
          title="No candidates match the search or filter criteria."
          action={
            <Button
              variant="ghost"
              onClick={() => {
                onSearch("");
                onStatusFilter("ALL");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <SessionCandidateTable
          candidates={shown}
          nextActionFor={nextActionFor}
          onMove={(item) => work.registration.begin("move", item)}
          onPropose={work.proposal.begin}
          onRemove={(item) => work.registration.begin("remove", item)}
          onWithdraw={work.withdrawal.begin}
        />
      )}
    </section>
  );
}
