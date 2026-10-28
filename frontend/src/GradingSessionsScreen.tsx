import { useMemo, useState } from "react";
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
import { formatLongDate, formatSessionDate } from "./dates";
import "./GradingSessions.css";
import { CheckIcon, LockIcon, SearchIcon } from "./Icons";
import { Dialog } from "./Dialog";
import { Pagination } from "./Pagination";
import { ResponsiveTable } from "./ResponsiveTable";
import { useDebouncedValue } from "./useDebouncedValue";

// ─── Icons ────────────────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
      <line x1="12" x2="12" y1="5" y2="19" />
      <line x1="5" x2="19" y1="12" y2="12" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
      <line x1="5" x2="19" y1="12" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24" width="13">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" x2="9" y1="9" y2="15" />
      <line x1="9" x2="15" y1="9" y2="15" />
    </svg>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

const STATUS_ORDER: GradingSessionStatus[] = ["OPEN", "DRAFT", "LOCKED", "COMPLETED", "CANCELLED"];
const STATUS_LABEL: Record<GradingSessionStatus, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  LOCKED: "Locked",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

// ─── Status Badge ─────────────────────────────────────────────────────────────

function SessionStatusBadge({ status }: { status: GradingSessionStatus }) {
  const cls = `gs-status-badge gs-status-${status.toLowerCase()}`;
  if (status === "OPEN") return <span className={cls}><span className="gs-status-dot" />Open</span>;
  if (status === "DRAFT") return <span className={cls}><span className="gs-status-dot" />Draft</span>;
  if (status === "LOCKED") return <span className={cls}><LockIcon size={13} /> Locked</span>;
  if (status === "COMPLETED") return <span className={cls}><CheckIcon size={13} /> Completed</span>;
  if (status === "CANCELLED") return <span className={cls}><XCircleIcon /> Cancelled</span>;
  return <span className={cls}>{STATUS_LABEL[status]}</span>;
}

// ─── Current Session Spotlight ────────────────────────────────────────────────

interface CurrentSessionCardProps {
  session: GradingSession;
  candidateCount: number;
  assessmentsComplete: number;
  awaitingDecision: number;
  onOpen: () => void;
}

function CurrentSessionCard({ session, candidateCount, assessmentsComplete, awaitingDecision, onOpen }: CurrentSessionCardProps) {
  return (
    <section className="gs-current-card" aria-label="Current grading session">
      <div className="gs-current-tag">Current</div>
      <div className="gs-current-body">
        <div className="gs-current-info">
          <h2 className="gs-current-title">{session.title}</h2>
          <p className="gs-current-date">{formatSessionDate(session.grading_date)}</p>
          {session.location && <p className="gs-current-location">{session.location}</p>}
          <div className="gs-current-status-row">
            <SessionStatusBadge status={session.status as GradingSessionStatus} />
          </div>
        </div>
        <div className="stats">
          <div className="stat">
            <span className="stat__value">{candidateCount}</span>
            <span className="stat__label">Candidates</span>
          </div>
          <div className="stat">
            <span className="stat__value">{assessmentsComplete} / {candidateCount}</span>
            <span className="stat__label">Assessments complete</span>
          </div>
          <div className="stat">
            <span className="stat__value">{awaitingDecision}</span>
            <span className="stat__label">Awaiting final decision</span>
          </div>
        </div>
        <div className="gs-current-action">
          <button className="btn-primary gs-open-btn" id="open-current-grading-btn" onClick={onOpen} type="button">
            Open grading <ArrowRightIcon />
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export function GradingSessionsScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<GradingSessionStatus | "ALL">("ALL");
  const [yearFilter, setYearFilter] = useState<string>("ALL");
  const [page, setPage] = useState(1);

  const [deleteConfirmSession, setDeleteConfirmSession] = useState<GradingSession | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteSessionMutation = useMutation({
    mutationFn: (id: number) => deleteGradingSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gradingSessions"] });
      setDeleteConfirmSession(null);
      setDeleteError(null);
    },
    onError: (err) => {
      setDeleteError(errorMessage(err, "Failed to delete session."));
    },
  });

  const closeDeleteConfirm = () => {
    setDeleteConfirmSession(null);
    setDeleteError(null);
  };

  const yearsQuery = useQuery({
    queryKey: ["gradingSessions", "years"],
    queryFn: getGradingSessionYears,
  });
  const availableYears = yearsQuery.data ?? [];

  const currentSessionQuery = useQuery({
    queryKey: ["gradingSessions", "current"],
    queryFn: () => getGradingSessions({ status: "OPEN", page_size: 1 }),
  });
  const currentSession = currentSessionQuery.data?.results[0] ?? null;

  // Paginated sessions filtered by status on the server
  const serverStatus = statusFilter !== "ALL" ? statusFilter : undefined;
  const selectedYear = yearFilter !== "ALL" ? Number(yearFilter) : undefined;
  const gradingDateFrom = selectedYear ? `${selectedYear}-01-01` : undefined;
  const gradingDateTo = selectedYear ? `${selectedYear}-12-31` : undefined;
  // Waits for a pause in typing; the last page stays while the next loads.
  const serverSearch = useDebouncedValue(searchText.trim()) || undefined;

  const sessionsQuery = useQuery({
    queryKey: ["gradingSessions", "page", page, serverStatus, selectedYear, serverSearch],
    placeholderData: keepPreviousData,
    queryFn: () =>
      getGradingSessions({
        page,
        page_size: PAGE_SIZE,
        status: serverStatus,
        search: serverSearch,
        grading_date_from: gradingDateFrom,
        grading_date_to: gradingDateTo,
      }),
  });

  const sessions: GradingSession[] = useMemo(
    () => sessionsQuery.data?.results ?? [],
    [sessionsQuery.data],
  );
  const totalCount = sessionsQuery.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  function handleStatusFilter(value: GradingSessionStatus | "ALL") { setStatusFilter(value); setPage(1); }
  function handleYearFilter(value: string) { setYearFilter(value); setPage(1); }
  function handleSearch(value: string) { setSearchText(value); setPage(1); }
  function resetFilters() { setSearchText(""); setStatusFilter("ALL"); setYearFilter("ALL"); setPage(1); }

  const isFiltered = searchText.trim() !== "" || statusFilter !== "ALL" || yearFilter !== "ALL";
  const isLoading = currentSessionQuery.isLoading || sessionsQuery.isLoading;
  const showingFrom = sessions.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, totalCount);
  const showCurrentCard = currentSession !== null && statusFilter === "ALL" && !searchText.trim() && yearFilter === "ALL";

  return (
    <section aria-labelledby="gradings-heading" className="page gs-page">

      {/* ── Header */}
      <div className="action-row gs-page-header">
        <div>
          <h1 className="gs-page-title" id="gradings-heading">Gradings</h1>
          <p className="gs-page-subtitle">Plan and manage grading sessions</p>
        </div>
        <div className="gs-page-header-actions">
          <button className="btn-primary gs-create-btn" id="create-grading-btn" onClick={() => navigate("/gradings/new")} type="button">
            <PlusIcon /> Create grading
          </button>
        </div>
      </div>

      {/* ── Filters */}
      <div className="filter-bar" role="search">
        <div className="filter-bar__full gs-filter-search-wrap">
          <SearchIcon size={16} className="gs-search-icon" />
          <input
            aria-label="Search grading sessions"
            className="gs-search-input"
            id="gs-search-input"
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search grading sessions…"
            type="search"
            value={searchText}
          />
        </div>
        <div className="field">
          <label htmlFor="gs-status-filter">Status</label>
          <select className="gs-filter-select" id="gs-status-filter" onChange={(e) => handleStatusFilter(e.target.value as GradingSessionStatus | "ALL")} value={statusFilter}>
            <option value="ALL">All statuses</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="gs-year-filter">Year</label>
          <select className="gs-filter-select" id="gs-year-filter" onChange={(e) => handleYearFilter(e.target.value)} value={yearFilter}>
            <option value="ALL">All years</option>
            {availableYears.map((y) => <option key={y} value={String(y)}>{y}</option>)}
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
      {isLoading && (
        <div className="gs-loading-state" role="status">
          <p>Loading grading sessions…</p>
        </div>
      )}

      {/* ── Table + Empty States */}
      {!isLoading && (
        <>
          <div className="gs-table-section">
            <h2 className="gs-table-heading">All grading sessions</h2>
            {sessions.length > 0 ? (
              <ResponsiveTable
                label="Grading sessions"
                rows={sessions}
                rowKey={(session) => session.id}
                columns={[
                  { key: "title", header: "Session", primary: true, render: (session) => session.title },
                  { key: "date", header: "Date", render: (session) => formatLongDate(session.grading_date) },
                  { key: "location", header: "Location", render: (session) => session.location || "—" },
                  { key: "candidates", header: "Candidates", align: "end", render: (session) => session.candidate_count ?? "—" },
                  {
                    key: "progress",
                    header: "Progress",
                    render: (session) =>
                      session.candidate_count !== null && session.status !== "DRAFT"
                        ? `${session.completed_assessment_count ?? 0} of ${session.candidate_count} complete`
                        : "—",
                  },
                  { key: "status", header: "Status", render: (session) => <SessionStatusBadge status={session.status as GradingSessionStatus} /> },
                  {
                    key: "action",
                    header: "Action",
                    actions: true,
                    render: (session) => (
                      <div className="gs-row-actions">
                        <button className="btn-ghost-sm gs-view-btn" onClick={() => navigate(`/gradings/${session.id}`)} type="button">
                          {session.status === "OPEN" ? "Open grading" : "View grading"} <ArrowRightIcon />
                        </button>
                        {session.can_be_deleted && (
                          <button
                            className="btn-ghost-sm gs-delete-row-btn"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteConfirmSession(session);
                            }}
                            type="button"
                            aria-label={`Delete session ${session.title}`}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            ) : isFiltered ? (
              <div className="gs-empty-state">
                <p className="gs-empty-message">No grading sessions match the selected filters.</p>
                <button className="btn-ghost" id="gs-reset-filters-btn" onClick={resetFilters} type="button">
                  Reset filters
                </button>
              </div>
            ) : (
              <div className="gs-empty-state">
                <p className="gs-empty-message">No grading sessions found. Create a new grading session to get started.</p>
                <button className="btn-primary gs-create-btn" id="gs-create-first-btn" onClick={() => navigate("/gradings/new")} type="button">
                  <PlusIcon /> Create grading
                </button>
              </div>
            )}
          </div>

          {/* ── Pagination */}
          {sessions.length > 0 && (
            <Pagination
              label="Grading sessions pagination"
              page={page}
              totalPages={totalPages}
              onPage={setPage}
              summary={
                totalPages > 1
                  ? `Showing ${showingFrom}–${showingTo} of ${totalCount} sessions`
                  : `Showing ${sessions.length} of ${totalCount} sessions`
              }
            />
          )}
        </>
      )}

      {/* ── Delete Confirmation Modal */}
      {deleteConfirmSession && (
        <Dialog
          title="Delete Grading Session"
          closeButton={false}
          onClose={closeDeleteConfirm}
          canClose={!deleteSessionMutation.isPending}
        >
          <p className="gsd-modal-message">
            Are you sure you want to permanently delete <strong>{deleteConfirmSession.title}</strong>? This action cannot be undone.
          </p>
          {deleteError && (
            <div className="alert-banner alert-banner-error" role="alert">
              <span>{deleteError}</span>
            </div>
          )}
          <div className="action-row dialog__actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={closeDeleteConfirm}
              disabled={deleteSessionMutation.isPending}
              data-dialog-autofocus
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => deleteSessionMutation.mutate(deleteConfirmSession.id)}
              disabled={deleteSessionMutation.isPending}
            >
              {deleteSessionMutation.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
