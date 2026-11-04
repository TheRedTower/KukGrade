import { Link } from "react-router-dom";

import type { GradingSession } from "./api";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";
import { EmptyState } from "./EmptyState";
import { type EnrichedCandidate, SessionCandidateTable } from "./SessionParts";
import type { useCandidateWork } from "./useCandidateWork";

interface SessionCandidatesSectionProps {
  session: GradingSession;
  /** Every candidate, and the ones the search and filter leave. */
  all: EnrichedCandidate[];
  shown: EnrichedCandidate[];
  search: string;
  onSearch: (search: string) => void;
  statusFilter: string;
  onStatusFilter: (status: string) => void;
  work: ReturnType<typeof useCandidateWork>;
  /** Who is offered "Confirm attendance", who is offered "Prepare all" and "Start all". */
  attendanceCount: number;
  unpreparedIds: number[];
  preparedIds: number[];
  canOverrideLocked: boolean;
  nextActionFor: (item: EnrichedCandidate) => { label: string; url: string; opensProposalDrawer: boolean };
  onConfirmAttendance: () => void;
}

/** The roster of a session: its toolbar, and a table or the reason there is none. */
export function SessionCandidatesSection({
  session,
  all,
  shown,
  search,
  onSearch,
  statusFilter,
  onStatusFilter,
  work,
  attendanceCount,
  unpreparedIds,
  preparedIds,
  canOverrideLocked,
  nextActionFor,
  onConfirmAttendance,
}: SessionCandidatesSectionProps) {
  const editable = session.status === "DRAFT" || session.status === "OPEN";
  const { bulkPrepare, bulkStart } = work;

  return (
    <section className="gsd-candidates-section" aria-labelledby="candidates-heading">
      <div className="action-row gsd-section-header">
        <h2 id="candidates-heading" className="gsd-section-title">
          Candidates
        </h2>

        <div className="action-row gsd-controls-row">
          {editable && attendanceCount > 0 && (
            <Button variant="secondary" onClick={onConfirmAttendance}>
              Confirm attendance
            </Button>
          )}
          {editable && unpreparedIds.length > 0 && (
            <Button variant="secondary" onClick={() => bulkPrepare.mutate(unpreparedIds)} disabled={bulkPrepare.isPending}>
              {bulkPrepare.isPending ? "Preparing…" : `Prepare all (${unpreparedIds.length})`}
            </Button>
          )}
          {session.status === "OPEN" && preparedIds.length > 0 && (
            <Button variant="primary" onClick={() => bulkStart.mutate(preparedIds)} disabled={bulkStart.isPending}>
              {bulkStart.isPending ? "Starting…" : `Start all prepared (${preparedIds.length})`}
            </Button>
          )}

          <div className="gsd-search-wrap">
            <span className="gsd-search-icon" aria-hidden="true">🔍</span>
            <input
              type="search"
              className="gsd-search-input"
              placeholder="Search candidate..."
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              aria-label="Search candidates by name or WKSA ID"
              data-testid="gsd-candidate-search"
            />
          </div>

          <div className="gsd-filter-wrap">
            <select
              className="gsd-filter-select"
              value={statusFilter}
              onChange={(e) => onStatusFilter(e.target.value)}
              aria-label="Filter by assessment status"
              data-testid="gsd-status-filter"
            >
              <option value="ALL">Assessment status</option>
              <option value="NOT_STARTED">Not started</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="WITHDRAWN">Withdrawn</option>
            </select>
          </div>

          <div className="gsd-count-chip">
            {shown.length} candidate{shown.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {all.length === 0 ? (
        <EmptyState
          framed
          data-testid="gsd-empty-roster"
          title="No candidates registered in this grading session yet."
          action={
            <Link to={`/gradings/${session.id}/register`} className={buttonClass({ variant: "primary" })}>
              Add candidate <span aria-hidden="true">→</span>
            </Link>
          }
        >
          Add students to begin curriculum assessment and outcome tracking.
        </EmptyState>
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
          canOverrideLocked={canOverrideLocked}
          nextActionFor={nextActionFor}
          sessionStatus={session.status}
          onMove={(item) => work.registration.begin("move", item)}
          onPropose={work.proposal.begin}
          onRemove={(item) => work.registration.begin("remove", item)}
          onWithdraw={work.withdrawal.begin}
        />
      )}
    </section>
  );
}
