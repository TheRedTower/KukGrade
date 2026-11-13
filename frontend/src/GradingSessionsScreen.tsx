import { useState } from "react";
import { keys } from "./queryKeys";
import { PageHeader } from "./PageHeader";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type GradingSession,
  type GradingSessionStatus,
  deleteGradingSession,
  getGradingSessionYears,
  getGradingSessions,
  errorMessage,
} from "./api";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";
import { formatLongDate, formatSessionDate } from "./dates";
import "./GradingSessions.css";
import { ConfirmDialog } from "./ConfirmDialog";
import { confirmDetails } from "./sessionDetail";
import { useChoices } from "./choices";
import { SessionStatusBadge } from "./StatusBadge";
import { Pagination } from "./Pagination";
import { ResponsiveTable } from "./ResponsiveTable";
import { SearchField } from "./SearchField";
import { usePagedQuery } from "./usePagedQuery";
import { useUrlFilters } from "./useUrlFilters";
import { Button } from "./Button";
import { ArrowRightIcon, PlusIcon } from "./Icons";

// ─── Utilities ────────────────────────────────────────────────────────────────

function deleteDetails(session: GradingSession) {
  return confirmDetails("DELETE", session, session.candidate_count ?? 0);
}

const PAGE_SIZE = 10;

// ─── Current Session Spotlight ────────────────────────────────────────────────

interface CurrentSessionCardProps {
  session: GradingSession;
  candidateCount: number;
  assessmentsComplete: number;
  awaitingDecision: number;
  onOpen: () => void;
}

function CurrentSessionCard({
  session,
  candidateCount,
  assessmentsComplete,
  awaitingDecision,
  onOpen,
}: CurrentSessionCardProps) {
  return (
    <section className="gs-current-card" aria-label="Current grading session">
      <div className="eyebrow gs-current-tag">Current</div>
      <div className="gs-current-body">
        <div className="gs-current-info">
          <h2 className="gs-current-title">{session.title}</h2>
          <p className="gs-current-date subtext">{formatSessionDate(session.grading_date)}</p>
          {session.location && <p className="gs-current-location subtext">{session.location}</p>}
          <div className="gs-current-status-row">
            <SessionStatusBadge status={session.status} label={session.status_display} />
          </div>
        </div>
        <div className="stats">
          <div className="stat">
            <span className="stat__value">{candidateCount}</span>
            <span className="stat__label">Candidates</span>
          </div>
          <div className="stat">
            <span className="stat__value">
              {assessmentsComplete} / {candidateCount}
            </span>
            <span className="stat__label">Assessments complete</span>
          </div>
          <div className="stat">
            <span className="stat__value">{awaitingDecision}</span>
            <span className="stat__label">Awaiting final decision</span>
          </div>
        </div>
        <div className="gs-current-action">
          <Button variant="primary" id="open-current-grading-btn" onClick={onOpen}>
            Open grading <ArrowRightIcon />
          </Button>
        </div>
      </div>
    </section>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export function GradingSessionsScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const filters = useUrlFilters();
  const searchText = filters.value("search");
  const statusFilter = filters.value("status") as GradingSessionStatus | "";
  const yearFilter = filters.value("year");
  const sessionStatuses = useChoices().session_statuses;
  const archivedOnly = filters.value("archived") === "only";
  const page = filters.page;

  const [deleteConfirmSession, setDeleteConfirmSession] = useState<GradingSession | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteSessionMutation = useMutation({
    mutationFn: (id: number) => deleteGradingSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.gradingSessions.all() });
      setDeleteConfirmSession(null);
      setDeleteError(null);
    },
    onError: (err) => {
      setDeleteError(errorMessage(err, "The grading session could not be deleted."));
    },
  });

  const closeDeleteConfirm = () => {
    setDeleteConfirmSession(null);
    setDeleteError(null);
  };

  const yearsQuery = useQuery({
    queryKey: keys.gradingSessions.years(),
    queryFn: getGradingSessionYears,
  });
  const availableYears = yearsQuery.data ?? [];

  const currentSessionQuery = useQuery({
    queryKey: keys.gradingSessions.current(),
    queryFn: () => getGradingSessions({ status: "OPEN", page_size: 1 }),
  });
  const currentSession = currentSessionQuery.data?.results[0] ?? null;

  // Paginated sessions filtered by status on the server
  const serverStatus = statusFilter || undefined;
  const selectedYear = yearFilter ? Number(yearFilter) : undefined;
  // Waits for a pause in typing; the last page stays while the next loads.
  const serverSearch = searchText.trim() || undefined;

  const sessionsQuery = usePagedQuery({
    queryKey: keys.gradingSessions.page(page, serverStatus, selectedYear, serverSearch, archivedOnly),
    placeholderData: keepPreviousData,
    queryFn: () =>
      getGradingSessions({
        page,
        page_size: PAGE_SIZE,
        status: serverStatus,
        search: serverSearch,
        year: selectedYear,
        archived: archivedOnly ? "only" : undefined,
      }),
    page,
    pageSize: PAGE_SIZE,
    onPage: filters.setPage,
  });
  const sessions: GradingSession[] = sessionsQuery.results;

  function resetFilters() {
    filters.clear("search", "status", "year", "archived");
  }

  const isFiltered = searchText.trim() !== "" || statusFilter !== "" || yearFilter !== "" || archivedOnly;
  const isLoading = currentSessionQuery.isLoading || sessionsQuery.query.isLoading;
  const showCurrentCard = currentSession !== null && !isFiltered;

  return (
    <section aria-labelledby="gradings-heading" className="page">
      <PageHeader
        title="Gradings"
        titleId="gradings-heading"
        subtitle="Plan and manage grading sessions"
        actions={
          <Button variant="primary" id="create-grading-btn" onClick={() => navigate("/gradings/new")}>
            <PlusIcon size={18} /> Create grading
          </Button>
        }
      />

      {/* ── Filters */}
      <div className="filter-bar" role="search">
        <SearchField
          className="filter-bar__full"
          hideLabel
          id="gs-search-input"
          label="Search grading sessions"
          placeholder="Search title, place, date or status…"
          value={searchText}
          onChange={(value) => filters.set({ search: value })}
        />
        <div className="field">
          <label htmlFor="gs-status-filter">Status</label>
          <select id="gs-status-filter" onChange={(e) => filters.set({ status: e.target.value })} value={statusFilter}>
            <option value="">All statuses</option>
            {sessionStatuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="gs-year-filter">Year</label>
          <select id="gs-year-filter" onChange={(e) => filters.set({ year: e.target.value })} value={yearFilter}>
            <option value="">All years</option>
            {availableYears.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="gs-archive-filter">Show</label>
          <select
            id="gs-archive-filter"
            onChange={(e) => filters.set({ archived: e.target.value === "ARCHIVED" ? "only" : null })}
            value={archivedOnly ? "ARCHIVED" : "CURRENT"}
          >
            <option value="CURRENT">Current gradings</option>
            <option value="ARCHIVED">Archived gradings</option>
          </select>
        </div>
      </div>

      {/* ── Current Session Spotlight */}
      {showCurrentCard && (
        <CurrentSessionCard
          assessmentsComplete={currentSession!.completed_assessment_count}
          awaitingDecision={currentSession!.awaiting_decision_count}
          candidateCount={currentSession!.candidate_count}
          onOpen={() => navigate(`/gradings/${currentSession!.id}`)}
          session={currentSession!}
        />
      )}

      {/* ── Loading */}
      {isLoading && <LoadingState>Loading grading sessions…</LoadingState>}

      {/* ── Table + Empty States */}
      {!isLoading && (
        <>
          <div className="stack stack--3">
            <h2 className="gs-table-heading section-title">
              {archivedOnly ? "Archived grading sessions" : "All grading sessions"}
            </h2>
            {sessions.length > 0 ? (
              <ResponsiveTable
                label="Grading sessions"
                rows={sessions}
                rowKey={(session) => session.id}
                columns={[
                  { key: "title", header: "Session", primary: true, render: (session) => session.title },
                  { key: "date", header: "Date", render: (session) => formatLongDate(session.grading_date) },
                  { key: "location", header: "Location", render: (session) => session.location || "—" },
                  {
                    key: "candidates",
                    header: "Candidates",
                    align: "end",
                    render: (session) => session.candidate_count ?? "—",
                  },
                  {
                    key: "progress",
                    header: "Progress",
                    render: (session) =>
                      session.marking_begun
                        ? `${session.completed_assessment_count ?? 0} of ${session.candidate_count} complete`
                        : "—",
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (session) => <SessionStatusBadge status={session.status} label={session.status_display} />,
                  },
                  {
                    key: "action",
                    header: "Action",
                    actions: true,
                    render: (session) => (
                      <>
                        <Button variant="ghost" small onClick={() => navigate(`/gradings/${session.id}`)}>
                          {session.marking_open ? "Open grading" : "View grading"} <ArrowRightIcon />
                        </Button>
                        {session.can_be_deleted && (
                          <Button
                            variant="danger-quiet"
                            small
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteConfirmSession(session);
                            }}
                            aria-label={`Delete session ${session.title}`}
                          >
                            Delete
                          </Button>
                        )}
                      </>
                    ),
                  },
                ]}
              />
            ) : isFiltered ? (
              <EmptyState
                framed
                action={
                  <Button variant="ghost" id="gs-reset-filters-btn" onClick={resetFilters}>
                    Reset filters
                  </Button>
                }
              >
                No grading sessions match the selected filters.
              </EmptyState>
            ) : (
              <EmptyState
                framed
                action={
                  <Button variant="primary" id="gs-create-first-btn" onClick={() => navigate("/gradings/new")}>
                    <PlusIcon size={18} /> Create grading
                  </Button>
                }
              >
                No grading sessions found. Create a new grading session to get started.
              </EmptyState>
            )}
          </div>

          {/* ── Pagination */}
          <Pagination label="Grading sessions pagination" noun={["session", "sessions"]} {...sessionsQuery.pager} />
        </>
      )}

      {deleteConfirmSession && (
        <ConfirmDialog
          title={deleteDetails(deleteConfirmSession).title}
          confirmLabel="Delete session"
          pendingLabel="Deleting…"
          pending={deleteSessionMutation.isPending}
          error={deleteError}
          danger
          onClose={closeDeleteConfirm}
          onConfirm={() => deleteSessionMutation.mutate(deleteConfirmSession.id)}
        >
          {/* The same words as the session's own Delete. */}
          <p className="subtext">{deleteDetails(deleteConfirmSession).message}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
