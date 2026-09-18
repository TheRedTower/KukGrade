import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type GradingSession,
  type GradingSessionStatus,
  ApiError,
  deleteGradingSession,
  getGradingSessions,
  getGradingCandidates,
  getCandidateAssessments,
} from "./api";
import { useAuth } from "./auth";

// ─── Icons ────────────────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
      <line x1="12" x2="12" y1="5" y2="19" />
      <line x1="5" x2="19" y1="12" y2="12" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" className="gs-search-icon" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" x2="16.65" y1="21" y2="16.65" />
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

function LockIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="13">
      <rect height="11" rx="2" ry="2" width="18" x="3" y="11" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24" width="13">
      <polyline points="20 6 9 17 4 12" />
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

function formatDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function formatDateShort(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function yearFromIso(iso: string): number {
  return parseInt(iso.slice(0, 4), 10);
}

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
  if (status === "LOCKED") return <span className={cls}><LockIcon /> Locked</span>;
  if (status === "COMPLETED") return <span className={cls}><CheckIcon /> Completed</span>;
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
          <p className="gs-current-date">{formatDate(session.grading_date)}</p>
          {session.location && <p className="gs-current-location">{session.location}</p>}
          <div className="gs-current-status-row">
            <SessionStatusBadge status={session.status as GradingSessionStatus} />
          </div>
        </div>
        <div className="gs-current-metrics">
          <div className="gs-metric-block">
            <span className="gs-metric-value">{candidateCount}</span>
            <span className="gs-metric-label">Candidates</span>
          </div>
          <div className="gs-metric-divider" />
          <div className="gs-metric-block">
            <span className="gs-metric-value">{assessmentsComplete} / {candidateCount}</span>
            <span className="gs-metric-label">Assessments complete</span>
          </div>
          <div className="gs-metric-divider" />
          <div className="gs-metric-block">
            <span className="gs-metric-value">{awaitingDecision}</span>
            <span className="gs-metric-label">Awaiting final decision</span>
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

// ─── Session Table Row ─────────────────────────────────────────────────────────

interface SessionRowProps {
  session: GradingSession;
  candidateCount: number | null;
  assessmentsComplete: number | null;
  onView: () => void;
  canDelete?: boolean;
  onDelete?: () => void;
}

function SessionRow({
  session,
  candidateCount,
  assessmentsComplete,
  onView,
  canDelete = false,
  onDelete,
}: SessionRowProps) {
  const statusTyped = session.status as GradingSessionStatus;
  const isOpen = statusTyped === "OPEN";
  const isDraft = statusTyped === "DRAFT";

  let progressText = "—";
  if (candidateCount !== null && !isDraft) {
    progressText = `${assessmentsComplete ?? 0} of ${candidateCount} complete`;
  }

  return (
    <tr className="gs-table-row">
      <td className="gs-table-cell gs-cell-title">{session.title}</td>
      <td className="gs-table-cell gs-cell-date">{formatDateShort(session.grading_date)}</td>
      <td className="gs-table-cell gs-cell-location">{session.location || "—"}</td>
      <td className="gs-table-cell gs-cell-candidates">{candidateCount ?? "—"}</td>
      <td className="gs-table-cell gs-cell-progress">{progressText}</td>
      <td className="gs-table-cell gs-cell-status">
        <SessionStatusBadge status={statusTyped} />
      </td>
      <td className="gs-table-cell gs-cell-action">
        <div className="gs-row-actions">
          <button className="btn-ghost-sm gs-view-btn" onClick={onView} type="button">
            {isOpen ? "Open grading" : "View grading"} <ArrowRightIcon />
          </button>
          {canDelete && onDelete && (
            <button
              className="btn-ghost-sm gs-delete-row-btn"
              onClick={onDelete}
              type="button"
              aria-label={`Delete session ${session.title}`}
            >
              Delete
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export function GradingSessionsScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [yearFilter, setYearFilter] = useState<string>("ALL");
  const [page, setPage] = useState(1);

  const [deleteConfirmSession, setDeleteConfirmSession] = useState<GradingSession | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteSessionMutation = useMutation({
    mutationFn: (id: number) => deleteGradingSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gradingSessionsAll"] });
      queryClient.invalidateQueries({ queryKey: ["gradingSessions"] });
      setDeleteConfirmSession(null);
      setDeleteError(null);
    },
    onError: (err) => {
      setDeleteError(err instanceof ApiError ? err.message : "Failed to delete session.");
    },
  });

  useEffect(() => {
    if (!deleteConfirmSession) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDeleteConfirmSession(null);
        setDeleteError(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteConfirmSession]);

  const userCanDelete = user?.role === "administrator" || user?.role === "instructor" || user?.is_superuser === true;

  // All sessions (large page to populate year dropdown & find current session)
  const allSessionsQuery = useQuery({
    queryKey: ["gradingSessionsAll"],
    queryFn: () => getGradingSessions({ page_size: 200 }),
  });

  const allSessions: GradingSession[] = useMemo(
    () => allSessionsQuery.data?.results ?? [],
    [allSessionsQuery.data],
  );

  const availableYears = useMemo(() => {
    const years = new Set(allSessions.map((s) => yearFromIso(s.grading_date)));
    return Array.from(years).sort((a, b) => b - a);
  }, [allSessions]);

  const currentSession = useMemo(
    () => allSessions.find((s) => s.status === "OPEN") ?? null,
    [allSessions],
  );

  // Candidate & assessment counts for the current (open) session spotlight
  const currentCandidatesQuery = useQuery({
    queryKey: ["gradingCandidatesCurrent", currentSession?.id],
    queryFn: () =>
      currentSession
        ? getGradingCandidates({ session: currentSession.id } as Parameters<typeof getGradingCandidates>[0])
        : Promise.resolve({ count: 0, next: null, previous: null, results: [] }),
    enabled: currentSession !== null,
  });

  const currentAssessmentsQuery = useQuery({
    queryKey: ["gradingAssessmentsCurrent", currentSession?.id],
    queryFn: () =>
      currentSession
        ? getCandidateAssessments({ session: currentSession.id } as Parameters<typeof getCandidateAssessments>[0])
        : Promise.resolve({ count: 0, next: null, previous: null, results: [] }),
    enabled: currentSession !== null,
  });

  const currentCandidateCount = currentCandidatesQuery.data?.count ?? 0;

  const currentAssessmentsComplete = useMemo(() => {
    const items = currentAssessmentsQuery.data?.results ?? [];
    return items.filter((a) => a.status === "COMPLETED" || a.status === "IN_PROGRESS").length;
  }, [currentAssessmentsQuery.data]);

  const currentAwaitingDecision = useMemo(() => {
    const items = currentAssessmentsQuery.data?.results ?? [];
    return items.filter((a) => a.status === "COMPLETED").length;
  }, [currentAssessmentsQuery.data]);

  // Paginated sessions filtered by status on the server
  const serverStatus = statusFilter !== "ALL" ? statusFilter : undefined;

  const sessionsQuery = useQuery({
    queryKey: ["gradingSessions", page, serverStatus],
    queryFn: () => getGradingSessions({ page, page_size: PAGE_SIZE, status: serverStatus }),
  });

  const sessions: GradingSession[] = useMemo(
    () => sessionsQuery.data?.results ?? [],
    [sessionsQuery.data],
  );
  const totalCount = sessionsQuery.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Client-side year filter + text search
  const filteredSessions = useMemo(() => {
    let list = sessions;
    if (yearFilter !== "ALL") {
      list = list.filter((s) => yearFromIso(s.grading_date) === parseInt(yearFilter, 10));
    }
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter(
        (s) => s.title.toLowerCase().includes(q) || (s.location ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [sessions, yearFilter, searchText]);

  const sessionIdsOnPage = filteredSessions.map((s) => s.id);

  const candidatesForPageQuery = useQuery({
    queryKey: ["gradingCandidatesPage", sessionIdsOnPage.join(",")],
    queryFn: async () => {
      if (sessionIdsOnPage.length === 0) return {};
      const results: Record<number, number> = {};
      await Promise.all(
        sessionIdsOnPage.map(async (id) => {
          const data = await getGradingCandidates({ session: id } as Parameters<typeof getGradingCandidates>[0]);
          results[id] = data.count;
        }),
      );
      return results;
    },
    enabled: sessionIdsOnPage.length > 0,
  });

  const assessmentsForPageQuery = useQuery({
    queryKey: ["gradingAssessmentsPage", sessionIdsOnPage.join(",")],
    queryFn: async () => {
      if (sessionIdsOnPage.length === 0) return {};
      const results: Record<number, number> = {};
      await Promise.all(
        sessionIdsOnPage.map(async (id) => {
          const data = await getCandidateAssessments({ session: id, status: "COMPLETED" } as Parameters<typeof getCandidateAssessments>[0]);
          results[id] = data.count;
        }),
      );
      return results;
    },
    enabled: sessionIdsOnPage.length > 0,
  });

  const candidateCounts = candidatesForPageQuery.data ?? {};
  const assessmentCounts = assessmentsForPageQuery.data ?? {};

  function handleStatusFilter(value: string) { setStatusFilter(value); setPage(1); }
  function handleYearFilter(value: string) { setYearFilter(value); setPage(1); }
  function handleSearch(value: string) { setSearchText(value); setPage(1); }
  function resetFilters() { setSearchText(""); setStatusFilter("ALL"); setYearFilter("ALL"); setPage(1); }

  const isFiltered = searchText.trim() !== "" || statusFilter !== "ALL" || yearFilter !== "ALL";
  const isLoading = allSessionsQuery.isLoading || sessionsQuery.isLoading;
  const canCreateGrading = user?.role === "administrator" || user?.is_superuser === true;
  const showingFrom = filteredSessions.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, totalCount);
  const showCurrentCard = currentSession !== null && statusFilter === "ALL" && !searchText.trim() && yearFilter === "ALL";

  return (
    <section aria-labelledby="gradings-heading" className="gs-page">

      {/* ── Header */}
      <div className="gs-page-header">
        <div>
          <h1 className="gs-page-title" id="gradings-heading">Gradings</h1>
          <p className="gs-page-subtitle">Plan and manage grading sessions</p>
        </div>
        {canCreateGrading && (
          <button className="btn-primary gs-create-btn" id="create-grading-btn" onClick={() => navigate("/gradings/new")} type="button">
            <PlusIcon /> Create grading
          </button>
        )}
      </div>

      {/* ── Filters */}
      <div className="gs-filter-bar" role="search">
        <div className="gs-filter-search-wrap">
          <SearchIcon />
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
        <div className="gs-filter-group">
          <label className="gs-filter-label" htmlFor="gs-status-filter">Status</label>
          <select className="gs-filter-select" id="gs-status-filter" onChange={(e) => handleStatusFilter(e.target.value)} value={statusFilter}>
            <option value="ALL">All statuses</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="gs-filter-group">
          <label className="gs-filter-label" htmlFor="gs-year-filter">Year</label>
          <select className="gs-filter-select" id="gs-year-filter" onChange={(e) => handleYearFilter(e.target.value)} value={yearFilter}>
            <option value="ALL">All years</option>
            {availableYears.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* ── Current Session Spotlight */}
      {showCurrentCard && (
        <CurrentSessionCard
          assessmentsComplete={currentAssessmentsComplete}
          awaitingDecision={currentAwaitingDecision}
          candidateCount={currentCandidateCount}
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
            {filteredSessions.length > 0 ? (
              <div className="gs-table-wrapper">
                <table aria-label="Grading sessions" className="gs-table">
                  <thead>
                    <tr>
                      <th className="gs-table-th" scope="col">Session</th>
                      <th className="gs-table-th" scope="col">Date</th>
                      <th className="gs-table-th" scope="col">Location</th>
                      <th className="gs-table-th gs-th-number" scope="col">Candidates</th>
                      <th className="gs-table-th" scope="col">Progress</th>
                      <th className="gs-table-th" scope="col">Status</th>
                      <th className="gs-table-th gs-th-action" scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSessions.map((session) => {
                      const completeCount = assessmentCounts[session.id] ?? 0;
                      const isEligibleStatus = session.status === "CANCELLED" || session.status === "DRAFT";
                      const canDelete = Boolean(userCanDelete && isEligibleStatus && completeCount === 0);
                      return (
                        <SessionRow
                          assessmentsComplete={assessmentCounts[session.id] ?? null}
                          candidateCount={candidateCounts[session.id] ?? null}
                          key={session.id}
                          onView={() => navigate(`/gradings/${session.id}`)}
                          canDelete={canDelete}
                          onDelete={() => {
                            setDeleteError(null);
                            setDeleteConfirmSession(session);
                          }}
                          session={session}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
                {canCreateGrading && (
                  <button className="btn-primary gs-create-btn" id="gs-create-first-btn" onClick={() => navigate("/gradings/new")} type="button">
                    <PlusIcon /> Create grading
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Pagination */}
          {filteredSessions.length > 0 && (
            <div className="gs-pagination-bar">
              <p className="gs-pagination-info">
                {totalPages > 1
                  ? `Showing ${showingFrom}–${showingTo} of ${totalCount} sessions`
                  : `Showing ${filteredSessions.length} of ${totalCount} sessions`}
              </p>
              {totalPages > 1 && (
                <div aria-label="Grading sessions pagination" className="gs-pagination-controls" role="navigation">
                  <button aria-label="Previous page" className="gs-page-btn" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} type="button">‹</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <button
                      aria-current={p === page ? "page" : undefined}
                      aria-label={`Page ${p}`}
                      className={`gs-page-btn${p === page ? " gs-page-active" : ""}`}
                      key={p}
                      onClick={() => setPage(p)}
                      type="button"
                    >
                      {p}
                    </button>
                  ))}
                  <button aria-label="Next page" className="gs-page-btn" disabled={page === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} type="button">›</button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Delete Confirmation Modal */}
      {deleteConfirmSession && (
        <div
          className="gsd-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-session-modal-title"
          onClick={() => {
            if (!deleteSessionMutation.isPending) {
              setDeleteConfirmSession(null);
              setDeleteError(null);
            }
          }}
        >
          <div className="gsd-modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 id="delete-session-modal-title" className="gsd-modal-title">Delete Grading Session</h3>
            <p className="gsd-modal-message">
              Are you sure you want to permanently delete <strong>{deleteConfirmSession.title}</strong>? This action cannot be undone.
            </p>
            {deleteError && (
              <div className="alert-banner alert-banner-error" role="alert" style={{ marginBottom: "1rem" }}>
                <span>{deleteError}</span>
              </div>
            )}
            <div className="gsd-modal-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setDeleteConfirmSession(null);
                  setDeleteError(null);
                }}
                disabled={deleteSessionMutation.isPending}
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
          </div>
        </div>
      )}
    </section>
  );
}

export default GradingSessionsScreen;
