import React, { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AgeBandEnum,
  BulkCandidateRegistrationPayload,
  BulkCandidateRegistrationResponse,
  GradingSession,
  Rank,
  StudentListItem,
  bulkRegisterCandidates,
  getAllStudents,
  getGradingSession,
} from "./api";
import { failureMessage } from "./forms";
import { useAgeBandsQuery, useRanksQuery } from "./queries";
import { useDebouncedValue } from "./useDebouncedValue";
import { Dialog } from "./Dialog";
import { ResponsiveTable } from "./ResponsiveTable";
import { BeltSwatch, type BeltRank } from "./Belt";
import { formatSessionDate } from "./dates";
import "./BuildGradingCohort.css";


interface CohortItem {
  student: StudentListItem;
  currentRank: Rank | null;
  destinationRank: Rank | null;
}

interface FlaggedCandidateItem {
  key: string;
  student: StudentListItem;
  destinationRank: Rank | null;
  error: string;
  isAlreadyRegistered: boolean;
}


/** A belt and its name. */
function RankCell({ rank, fallback }: { rank: BeltRank | null | undefined; fallback: string }) {
  return (
    <div className="bgc-rank-cell">
      <BeltSwatch rank={rank} />
      <span className="bgc-rank-label">{rank?.name || fallback}</span>
    </div>
  );
}

/** From one rank to the next, on one line that wraps when it must. */
function RankFlow({ from, to, fromFallback = "Unknown" }: {
  from: BeltRank | null | undefined;
  to: BeltRank | null | undefined;
  fromFallback?: string;
}) {
  return (
    <div className="bgc-rank-flow">
      <RankCell rank={from} fallback={fromFallback} />
      <span className="bgc-rank-arrow" aria-hidden="true">→</span>
      <span className="visually-hidden">, next rank: </span>
      {to ? <RankCell rank={to} fallback="—" /> : <span className="bgc-highest-rank">Highest rank</span>}
    </div>
  );
}

export function BuildGradingCohortScreen() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Search and Filter controls
  const [search, setSearch] = useState("");
  const [rankFilter, setRankFilter] = useState("ALL");
  const [ageFilter, setAgeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"ACTIVE_INACTIVE" | "ACTIVE" | "INACTIVE">("ACTIVE_INACTIVE");

  // Selected cohort of candidates to register
  const [cohort, setCohort] = useState<CohortItem[]>([]);

  // Toggle for pre-generating assessment forms
  const [generateAssessments, setGenerateAssessments] = useState(true);

  // Exceptions modal state
  const [exceptionsModalOpen, setExceptionsModalOpen] = useState(false);

  // Submitting and registration results state
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Exception Resolver state
  const [registrationResult, setRegistrationResult] = useState<BulkCandidateRegistrationResponse | null>(null);
  const [flaggedItems, setFlaggedItems] = useState<FlaggedCandidateItem[]>([]);
  const [showSuccessfulList, setShowSuccessfulList] = useState(false);

  // Queries
  const sessionQuery = useQuery({
    queryKey: ["gradingSessions", "detail", sessionId],
    queryFn: () => getGradingSession(sessionId),
    enabled: !isNaN(sessionId),
  });

  const ranksQuery = useRanksQuery();

  const ageBandsQuery = useAgeBandsQuery();
  const ageBands = useMemo(() => ageBandsQuery.data?.results ?? [], [ageBandsQuery.data]);

  // The server narrows the roster to who could still be registered and to the
  // toolbar's filters, so the screen never downloads students it would hide.
  const debouncedSearch = useDebouncedValue(search.trim());
  const studentFilters = {
    eligible_for_session: sessionId,
    search: debouncedSearch || undefined,
    current_rank: rankFilter === "ALL" ? undefined : Number(rankFilter),
    age_band: ageFilter === "ALL" ? undefined : (ageFilter as AgeBandEnum),
    status: statusFilter === "ACTIVE_INACTIVE" ? undefined : statusFilter,
  };
  const studentsQuery = useQuery({
    queryKey: ["students", "eligible", studentFilters],
    queryFn: () => getAllStudents(studentFilters),
    enabled: !isNaN(sessionId),
    placeholderData: keepPreviousData,
  });

  const session: GradingSession | undefined = sessionQuery.data;
  const ranks: Rank[] = useMemo(() => {
    const list = ranksQuery.data?.results ?? [];
    return [...list].sort((a, b) => a.order - b.order);
  }, [ranksQuery.data]);

  // Rank lookup and destination rank progression mapping
  const { rankMap, nextRankMap } = useMemo(() => {
    const map = new Map<number, Rank>();
    const nextMap = new Map<number, Rank>();

    ranks.forEach((r) => map.set(r.id, r));
    // Each rank's next rank as the server defines it (Rank.next_rank).
    ranks.forEach((r) => {
      const next = r.next_rank === null ? undefined : map.get(r.next_rank);
      if (next) nextMap.set(r.id, next);
    });

    return { rankMap: map, nextRankMap: nextMap };
  }, [ranks]);

  // While a new filter is typed or loading, the list on screen is not yet the
  // list "Add all" would mean.
  const isRosterUpdating = studentsQuery.isPlaceholderData || search.trim() !== debouncedSearch;

  const filteredEligibleStudents = useMemo(
    () => studentsQuery.data?.results ?? [],
    [studentsQuery.data],
  );

  // Group filtered eligible students by their current rank
  const rankGroups = useMemo(() => {
    const groups: {
      rank: Rank;
      destinationRank: Rank | null;
      students: StudentListItem[];
      activeCount: number;
      inactiveCount: number;
      programmeCounts: { label: string; count: number }[];
    }[] = [];

    // One count per programme, in the order the server lists the age bands
    const programmes = ageBands.filter(
      (band, index) => ageBands.findIndex((other) => other.programme === band.programme) === index,
    );

    // Group filtered eligible students by current_rank
    const studentsByRank = new Map<number, StudentListItem[]>();
    for (const s of filteredEligibleStudents) {
      const list = studentsByRank.get(s.current_rank) || [];
      list.push(s);
      studentsByRank.set(s.current_rank, list);
    }

    // Iterate through active ranks in progression order
    for (const r of ranks) {
      const students = studentsByRank.get(r.id);
      if (students && students.length > 0) {
        const dest = nextRankMap.get(r.id) || null;
        const activeCount = students.filter((s) => s.status === "ACTIVE").length;
        const inactiveCount = students.filter((s) => s.status === "INACTIVE").length;
        const programmeCounts = programmes.map((band) => ({
          label: band.programme_display,
          count: students.filter((s) =>
            ageBands.some((b) => b.code === s.age_band && b.programme === band.programme),
          ).length,
        }));
        groups.push({
          rank: r,
          destinationRank: dest,
          students,
          activeCount,
          inactiveCount,
          programmeCounts,
        });
      }
    }

    return groups;
  }, [ranks, filteredEligibleStudents, nextRankMap, ageBands]);

  // Cohort breakdown by rank group for the right-hand panel
  const cohortBreakdown = useMemo(() => {
    const breakdownMap = new Map<
      number,
      {
        currentRank: Rank | null;
        destinationRank: Rank | null;
        count: number;
        items: CohortItem[];
      }
    >();

    for (const item of cohort) {
      const rankId = item.student.current_rank;
      const entry = breakdownMap.get(rankId) || {
        currentRank: item.currentRank,
        destinationRank: item.destinationRank,
        count: 0,
        items: [],
      };
      entry.count += 1;
      entry.items.push(item);
      breakdownMap.set(rankId, entry);
    }

    return Array.from(breakdownMap.entries()).map(([rankId, data]) => ({
      rankId,
      ...data,
    }));
  }, [cohort]);

  // Set of student IDs currently in cohort
  const cohortStudentIdSet = useMemo(() => {
    return new Set(cohort.map((c) => c.student.id));
  }, [cohort]);

  // Add whole rank group to cohort
  const handleAddRankGroup = (rankGroup: (typeof rankGroups)[0]) => {
    setCohort((prev) => {
      const existingIds = new Set(prev.map((c) => c.student.id));
      const toAdd: CohortItem[] = rankGroup.students
        .filter((s) => !existingIds.has(s.id))
        .map((s) => ({
          student: s,
          currentRank: rankGroup.rank,
          destinationRank: rankGroup.destinationRank,
        }));
      return [...prev, ...toAdd];
    });
  };

  // Remove whole rank group from cohort
  const handleRemoveRankGroup = (rankId: number) => {
    setCohort((prev) => prev.filter((item) => item.student.current_rank !== rankId));
  };

  // Add individual student to cohort
  const handleAddStudentToCohort = (student: StudentListItem) => {
    setCohort((prev) => {
      if (prev.some((c) => c.student.id === student.id)) return prev;
      return [
        ...prev,
        {
          student,
          currentRank: rankMap.get(student.current_rank) || null,
          destinationRank: nextRankMap.get(student.current_rank) || null,
        },
      ];
    });
  };

  // Add all currently filtered eligible students to cohort
  const handleAddAllFiltered = () => {
    setCohort((prev) => {
      const existingIds = new Set(prev.map((c) => c.student.id));
      const toAdd: CohortItem[] = filteredEligibleStudents
        .filter((s) => !existingIds.has(s.id))
        .map((s) => ({
          student: s,
          currentRank: rankMap.get(s.current_rank) || null,
          destinationRank: nextRankMap.get(s.current_rank) || null,
        }));
      return [...prev, ...toAdd];
    });
  };

  // Remove individual student from cohort
  const handleRemoveStudentFromCohort = (studentId: number) => {
    setCohort((prev) => prev.filter((item) => item.student.id !== studentId));
  };

  // One registration request: the first for the whole cohort, or a retry of the
  // flagged ones. `rows` are the people sent, in order: the server names a
  // failure by its position in them.
  const registerMutation = useMutation({
    mutationFn: (request: {
      payload: BulkCandidateRegistrationPayload;
      rows: { student: StudentListItem; destinationRank: Rank | null }[];
      retry: boolean;
    }) => bulkRegisterCandidates(request.payload),
    onSuccess: (response, request) => {
      // Invalidate relevant queries so cache reflects newly registered candidates
      queryClient.invalidateQueries({ queryKey: ["gradingCandidates", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["students", "eligible"] });
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["gradingSessions", "detail", sessionId] });

      const errorKeys = Object.keys(response.errors);
      if (errorKeys.length === 0) {
        // Everything registered: on to the grading session.
        navigate(`/gradings/${sessionId}`);
        return;
      }
      // Partial success or errors: the Exception Resolver lists what is left.
      if (!request.retry) setRegistrationResult(response);
      setFlaggedItems(
        errorKeys.map((idxStr) => {
          const row = request.rows[Number(idxStr)];
          const errorMsg = (response.errors[idxStr] || []).join(", ");
          return {
            key: idxStr,
            student: row?.student,
            destinationRank: row?.destinationRank ?? null,
            error: errorMsg || (request.retry ? "" : "Registration failed"),
            isAlreadyRegistered: errorMsg.toLowerCase().includes("already registered"),
          };
        }),
      );
    },
    onError: (err) => setSubmitError(failureMessage(err, "Failed to register grading candidates.")),
  });
  const isSubmitting = registerMutation.isPending;

  // Submit bulk candidate registration
  const handleSubmitCohort = () => {
    if (cohort.length === 0 || !session) return;
    setSubmitError(null);
    registerMutation.mutate({
      payload: {
        session: session.id,
        candidates: cohort.map((item) => ({
          student: item.student.id,
          testing_for_rank: item.destinationRank?.id,
        })),
        generate_assessments: generateAssessments,
      },
      rows: cohort.map((item) => ({ student: item.student, destinationRank: item.destinationRank })),
      retry: false,
    });
  };

  // Exception Resolver: Remove flagged item from retry list
  const handleRemoveFlaggedCandidate = (key: string) => {
    setFlaggedItems((prev) => prev.filter((item) => item.key !== key));
  };

  // Exception Resolver: Retry remaining flagged candidates
  const handleRetryFlagged = () => {
    const retryableItems = flaggedItems.filter((item) => !item.isAlreadyRegistered);
    if (retryableItems.length === 0 || !session) return;
    setSubmitError(null);
    registerMutation.mutate({
      payload: {
        session: session.id,
        candidates: retryableItems.map((item) => ({
          student: item.student.id,
          testing_for_rank: item.destinationRank?.id,
        })),
        generate_assessments: generateAssessments,
      },
      rows: retryableItems.map((item) => ({ student: item.student, destinationRank: item.destinationRank })),
      retry: true,
    });
  };

  // Loading and error states for session
  if (isNaN(sessionId)) {
    return (
      <section aria-labelledby="bgc-invalid-id-heading" className="page page--wide bgc-page" data-testid="bgc-page">
        <div className="gsd-error-state">
          <h2 id="bgc-invalid-id-heading">Grading session not found</h2>
          <p>Please return to the grading sessions list.</p>
          <Link to="/gradings" className="btn-primary">Back to Gradings</Link>
        </div>
      </section>
    );
  }

  if (sessionQuery.isLoading) {
    return (
      <section aria-label="Build grading cohort" className="page page--wide bgc-page" data-testid="bgc-page">
        <div className="gsd-loading-state" role="status">
          <div className="gsd-spinner" aria-hidden="true" />
          <p>Loading the grading session…</p>
        </div>
      </section>
    );
  }

  if (sessionQuery.isError || !session) {
    return (
      <section aria-labelledby="bgc-error-heading" className="page page--wide bgc-page" data-testid="bgc-page">
        <div className="gsd-error-state">
          <h2 id="bgc-error-heading">Failed to load grading session</h2>
          <p>{sessionQuery.error instanceof Error ? sessionQuery.error.message : "Session not found."}</p>
          <Link to="/gradings" className="btn-primary">Back to Gradings</Link>
        </div>
      </section>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW: Exception Resolver
  // ══════════════════════════════════════════════════════════════════════════
  if (registrationResult && flaggedItems.length > 0) {
    const createdCount = registrationResult.created.length;
    const flaggedCount = flaggedItems.length;
    const retryableCount = flaggedItems.filter((i) => !i.isAlreadyRegistered).length;

    return (
      <section aria-labelledby="bgc-resolver-title" className="page page--wide bgc-page" data-testid="bgc-page">
        {/* Breadcrumbs */}
        <nav className="crumbs" aria-label="Breadcrumbs">
          <Link to="/gradings" className="bgc-breadcrumb-link">Gradings</Link>
          <span className="bgc-breadcrumb-sep" aria-hidden="true">/</span>
          <Link to={`/gradings/${session.id}`} className="bgc-breadcrumb-link">{session.title}</Link>
          <span className="bgc-breadcrumb-sep" aria-hidden="true">/</span>
          <span className="bgc-breadcrumb-current">Resolve flagged candidates</span>
        </nav>

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
            <span className={`gsd-status-pill gsd-status-${session.status?.toLowerCase()}`}>
              <span className="gsd-status-indicator" aria-hidden="true" />
              {session.status_display || session.status}
            </span>
          </div>
          <div className="bgc-session-card-meta">
            <span>{formatSessionDate(session.grading_date)}</span>
            <span className="bgc-meta-sep" aria-hidden="true">·</span>
            <span>{session.location || "No location specified"}</span>
          </div>
        </div>

        {submitError && (
          <div className="gsd-error-banner" role="alert">
            <span>⚠️ {submitError}</span>
            <button
              type="button"
              className="gsd-error-dismiss-btn"
              onClick={() => setSubmitError(null)}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
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
                    <span className="bgc-status-badge bgc-badge-muted">
                      {/* One grading at a time: held by another grading, not this one. */}
                      {item.error.includes("for this session") ? "No retry needed" : "Registered for another grading"}
                    </span>
                  ) : (
                    <span className={`bgc-status-badge bgc-status-${item.student?.status?.toLowerCase()}`}>
                      {item.student?.status_display || item.student?.status}
                    </span>
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
                      className="btn-ghost bgc-row-btn"
                      target="_blank"
                      rel="noreferrer"
                    >
                      View student
                    </Link>
                    <button
                      type="button"
                      className="btn-ghost bgc-row-btn bgc-btn-remove"
                      onClick={() => handleRemoveFlaggedCandidate(item.key)}
                    >
                      Remove from list
                    </button>
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
                        <span className="bgc-badge bgc-badge-form">Form created (Not started)</span>
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
            className="btn-ghost bgc-finish-btn"
            data-testid="bgc-finish-view-session-btn"
          >
            Finish and view {session.title}
          </Link>

          <div className="bgc-retry-action-wrap">
            <button
              type="button"
              className="btn-primary gs-create-btn"
              onClick={handleRetryFlagged}
              disabled={isSubmitting || retryableCount === 0}
              data-testid="bgc-retry-flagged-btn"
            >
              {isSubmitting ? "Retrying..." : `Save changes and retry ${retryableCount}`}
            </button>
            <span className="bgc-retry-helper-text">Only resolved candidates will be retried.</span>
          </div>
        </footer>
      </section>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW: Cohort Builder Workspace
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <section aria-labelledby="bgc-title" className="page page--wide bgc-page" data-testid="bgc-page">
      {/* Breadcrumbs */}
      <nav className="crumbs" aria-label="Breadcrumbs">
        <Link to="/gradings" className="bgc-breadcrumb-link">Gradings</Link>
        <span className="bgc-breadcrumb-sep" aria-hidden="true">/</span>
        <Link to={`/gradings/${session.id}`} className="bgc-breadcrumb-link">{session.title}</Link>
        <span className="bgc-breadcrumb-sep" aria-hidden="true">/</span>
        <span className="bgc-breadcrumb-current">Build grading cohort</span>
      </nav>

      {/* Header */}
      <header className="bgc-header">
        <h1 className="bgc-title" id="bgc-title">Build grading cohort</h1>
        <p className="bgc-subtitle">Add whole groups, then review any exceptions.</p>
      </header>

      {/* Session Card Strip */}
      <div className="bgc-session-card">
        <div className="bgc-session-card-left">
          <span className="bgc-session-title">{session.title}</span>
          <span className={`gsd-status-pill gsd-status-${session.status?.toLowerCase()}`}>
            <span className="gsd-status-indicator" aria-hidden="true" />
            {session.status_display || session.status}
          </span>
        </div>
        <div className="bgc-session-card-meta">
          <span>{formatSessionDate(session.grading_date)}</span>
          <span className="bgc-meta-sep" aria-hidden="true">·</span>
          <span>{session.location || "No location specified"}</span>
        </div>
      </div>

      {submitError && (
        <div className="gsd-error-banner" role="alert">
          <span>⚠️ {submitError}</span>
          <button
            type="button"
            className="gsd-error-dismiss-btn"
            onClick={() => setSubmitError(null)}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Dual-Column Workspace */}
      <div className="split">
        {/* ── LEFT COLUMN: Finding & Adding Candidates ──────────────────── */}
        <div className="bgc-left-column">
          {/* Section 1: Find eligible students */}
          <section className="bgc-section" aria-labelledby="bgc-find-heading">
            <h2 id="bgc-find-heading" className="bgc-section-title">
              1. Find eligible students
            </h2>
            <p className="bgc-section-subtext">
              Search and filter to find students to add. Left students are not shown (not eligible).
            </p>

            {/* Filter toolbar */}
            <div className="filter-bar">
              <div className="filter-bar__full bgc-search-field">
                <span className="bgc-search-icon" aria-hidden="true">🔍</span>
                <input
                  type="search"
                  className="bgc-search-input"
                  placeholder="Search name or WKSA ID"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search name or WKSA ID"
                />
              </div>

              <div className="field">
                <label htmlFor="bgc-rank-filter">Current rank</label>
                <select
                  id="bgc-rank-filter"
                  value={rankFilter}
                  onChange={(e) => setRankFilter(e.target.value)}
                >
                  <option value="ALL">All ranks</option>
                  {ranks
                    .filter((r) => nextRankMap.get(r.id)?.has_syllabus)
                    .map((r) => (
                      <option key={r.id} value={String(r.id)}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="bgc-age-filter">Age group</label>
                <select
                  id="bgc-age-filter"
                  value={ageFilter}
                  onChange={(e) => setAgeFilter(e.target.value)}
                  data-testid="bgc-age-filter"
                >
                  <option value="ALL">All ages</option>
                  {ageBands.map((band) => (
                    <option key={band.code} value={band.code}>
                      {band.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="bgc-status-filter">Status</label>
                <select
                  id="bgc-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "ACTIVE_INACTIVE" | "ACTIVE" | "INACTIVE")}
                >
                  <option value="ACTIVE_INACTIVE">Active + Inactive</option>
                  <option value="ACTIVE">Active only</option>
                  <option value="INACTIVE">Inactive only</option>
                </select>
              </div>
            </div>

            {/* Filter matching summary banner */}
            <div className="action-row bgc-filter-summary-card">
              <div className="bgc-summary-info">
                <span className="bgc-info-icon" aria-hidden="true">ℹ</span>
                <span className="bgc-info-text">
                  Students who have left, or are still registered for another grading that has not reached its result, are not listed.
                </span>
              </div>
              <div className="action-row">
                <span className="bgc-matching-count">
                  {filteredEligibleStudents.length === 1
                    ? "1 student matches"
                    : `${filteredEligibleStudents.length} students match`}
                </span>
                <button
                  type="button"
                  className="btn-primary gs-create-btn bgc-add-filtered-btn"
                  onClick={handleAddAllFiltered}
                  disabled={filteredEligibleStudents.length === 0 || isRosterUpdating}
                  data-testid="bgc-add-all-filtered-btn"
                >
                  Add all {filteredEligibleStudents.length} filtered students
                </button>
              </div>
            </div>

            {/* Filtered matching student records table */}
            <div data-testid="bgc-filtered-students-table">
              {filteredEligibleStudents.length === 0 ? (
                <div className="bgc-empty-filtered" data-testid="bgc-empty-filtered">
                  No eligible students match the selected filters.
                </div>
              ) : (
                <ResponsiveTable
                  label="Matching eligible students"
                  rows={filteredEligibleStudents}
                  rowKey={(student) => student.id}
                  rowTestId={(student) => `bgc-student-row-${student.id}`}
                  columns={[
                    {
                      key: "student",
                      header: "Student",
                      primary: true,
                      render: (student) => (
                        <>
                          <Link
                            to={`/students/${student.id}`}
                            className="bgc-student-name-link"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {student.first_name} {student.last_name}
                          </Link>
                          <span className="bgc-student-id">{student.wksa_id || "—"}</span>
                        </>
                      ),
                    },
                    {
                      key: "rank",
                      header: "Rank",
                      render: (student) => (
                        <RankFlow
                          from={rankMap.get(student.current_rank)}
                          to={nextRankMap.get(student.current_rank)}
                          fromFallback={student.current_rank_name || "—"}
                        />
                      ),
                    },
                    {
                      key: "age-status",
                      header: "Age and status",
                      render: (student) => (
                        <div className="bgc-chips">
                          <span className="bgc-ageband-badge">{student.age_band_display || student.age_band || "—"}</span>
                          <span className={`bgc-status-badge bgc-status-${student.status.toLowerCase()}`}>
                            {student.status_display || student.status}
                          </span>
                        </div>
                      ),
                    },
                    {
                      key: "action",
                      header: "Action",
                      actions: "inline",
                      render: (student) =>
                        cohortStudentIdSet.has(student.id) ? (
                          <button
                            type="button"
                            className="btn-ghost bgc-student-added-btn"
                            onClick={() => handleRemoveStudentFromCohort(student.id)}
                            title="Click to remove student from cohort"
                            data-testid={`bgc-student-added-${student.id}`}
                          >
                            Added ✓
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-primary gs-create-btn bgc-add-student-btn"
                            onClick={() => handleAddStudentToCohort(student)}
                            data-testid={`bgc-add-student-${student.id}`}
                          >
                            + Add
                          </button>
                        ),
                    },
                  ]}
                />
              )}
            </div>
          </section>

          {/* Section 2: Add whole rank groups */}
          <section className="bgc-section" aria-labelledby="bgc-rank-groups-heading">
            <h2 id="bgc-rank-groups-heading" className="bgc-section-title">
              2. Add whole rank groups
            </h2>
            <p className="bgc-section-subtext">
              Students are grouped by their current rank. Add whole groups to register them for the next rank.
            </p>

            <ResponsiveTable
              label="Eligible rank groups"
              rows={rankGroups}
              rowKey={(group) => group.rank.id}
              empty={
                filteredEligibleStudents.length === 0
                  ? "No eligible students match the selected filters."
                  : "No eligible students found to register."
              }
              columns={[
                {
                  key: "rank",
                  header: "Rank",
                  primary: true,
                  render: (group) => <RankFlow from={group.rank} to={group.destinationRank} />,
                },
                {
                  key: "age-mix",
                  header: "Age mix",
                  render: (group) => (
                    <span className="bgc-agemix-badge">
                      {group.programmeCounts.map((entry) => `${entry.label} ${entry.count}`).join(" | ")}
                    </span>
                  ),
                },
                {
                  key: "eligible",
                  header: "Eligible",
                  render: (group) => (
                    <div className="bgc-eligible-count-cell">
                      <span className="bgc-eligible-num">{group.students.length}</span>
                      <span className="bgc-eligible-breakdown">
                        ({group.activeCount} active
                        {group.inactiveCount > 0 && (
                          <>
                            , <span className="bgc-inactive-alert">{group.inactiveCount} inactive</span>
                          </>
                        )}
                        )
                      </span>
                    </div>
                  ),
                },
                {
                  key: "action",
                  header: "Action",
                  actions: "inline",
                  render: (group) => {
                    const allGroupAdded = group.students.every((student) => cohortStudentIdSet.has(student.id));
                    const someGroupAdded = group.students.some((student) => cohortStudentIdSet.has(student.id));
                    return allGroupAdded ? (
                      <button
                        type="button"
                        className="btn-ghost bgc-group-added-btn"
                        onClick={() => handleRemoveRankGroup(group.rank.id)}
                        title="Click to remove group"
                        data-testid={`bgc-group-added-${group.rank.id}`}
                      >
                        Added ✓
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-primary gs-create-btn bgc-add-group-btn"
                        onClick={() => handleAddRankGroup(group)}
                        data-testid={`bgc-add-group-${group.rank.id}`}
                      >
                        {someGroupAdded ? `Add remaining` : `Add all ${group.students.length}`}
                      </button>
                    );
                  },
                },
              ]}
            />
          </section>
        </div>

        {/* ── RIGHT COLUMN: Cohort Ledger & Confirmation ─────────────────── */}
        <div className="split__aside">
          <aside className="bgc-cohort-tray" aria-label="Cohort to register">
            <div className="bgc-tray-header">
              <div className="action-row">
                <h2 className="bgc-tray-title">Cohort to register</h2>
                <span className="bgc-cohort-count" data-testid="bgc-cohort-count">
                  {cohort.length} candidate{cohort.length === 1 ? "" : "s"} selected
                </span>
              </div>
              <p className="bgc-tray-subtext">
                Groups added to this cohort. You can review and remove individual students if needed.
              </p>
            </div>

            {/* Selected groups table */}
            <ResponsiveTable
              label="Selected cohort groups"
              rows={cohortBreakdown}
              rowKey={(item) => item.rankId}
              empty="No rank groups added yet. Add a group from the left panel to begin."
              columns={[
                {
                  key: "rank",
                  header: "Rank",
                  primary: true,
                  render: (item) => (
                    <RankFlow from={item.currentRank} to={item.destinationRank} />
                  ),
                },
                { key: "count", header: "Count", render: (item) => <span className="bgc-tray-count">{item.count}</span> },
                {
                  key: "remove",
                  header: "Remove",
                  actions: "inline",
                  render: (item) => (
                    <button
                      type="button"
                      className="bgc-btn-remove-group"
                      onClick={() => handleRemoveRankGroup(item.rankId)}
                      aria-label={`Remove ${item.currentRank?.name} group`}
                    >
                      ✕
                    </button>
                  ),
                },
              ]}
            />

            {/* Review exceptions link */}
            <div className="bgc-exceptions-callout">
              <button
                type="button"
                className="bgc-review-exceptions-btn"
                onClick={() => setExceptionsModalOpen(true)}
                disabled={cohort.length === 0}
                data-testid="bgc-review-exceptions-btn"
              >
                Review exceptions →
              </button>
              <p className="bgc-exceptions-help">
                Remove individual students from the selected roster before registering. Only needed if there are exceptions.
              </p>
            </div>

            {/* Assessment form pre-generation toggle */}
            <div className="bgc-assessment-toggle-row">
              <label className="bgc-switch-label" htmlFor="bgc-assessments-toggle">
                <div className="bgc-switch">
                  <input
                    id="bgc-assessments-toggle"
                    type="checkbox"
                    checked={generateAssessments}
                    onChange={(e) => setGenerateAssessments(e.target.checked)}
                    data-testid="bgc-assessments-toggle"
                  />
                  <span className="bgc-switch-slider" aria-hidden="true" />
                </div>
                <div className="bgc-switch-text">
                  <span className="bgc-switch-title">Prepare assessment forms now</span>
                  <span className="bgc-switch-desc">Forms will be created as Not started.</span>
                </div>
              </label>
            </div>

            {/* Action buttons */}
            <div className="action-row bgc-tray-actions">
              <Link
                to={`/gradings/${session.id}`}
                className="btn-ghost bgc-cancel-btn"
                data-testid="bgc-cancel-btn"
              >
                Cancel
              </Link>
              <button
                type="button"
                className="btn-primary gs-create-btn bgc-register-btn"
                onClick={handleSubmitCohort}
                disabled={isSubmitting || cohort.length === 0}
                data-testid="bgc-register-candidates-btn"
              >
                {isSubmitting ? "Registering..." : `Register ${cohort.length} candidate${cohort.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </aside>
        </div>
      </div>

      {/* ── Modal: Review Cohort Exceptions ──────────────────────────────── */}
      {exceptionsModalOpen && (
        <Dialog
          title={`Review cohort candidates (${cohort.length})`}
          onClose={() => setExceptionsModalOpen(false)}
        >
          <p className="gsd-modal-message">
            Remove individual students who should not be registered in this grading cohort.
          </p>

          <ul className="bgc-modal-list">
            {cohort.map((item) => (
              <li key={item.student.id} className="bgc-modal-list-item">
                <div className="bgc-modal-student-info">
                  <span className="bgc-modal-student-name">
                    {item.student.first_name} {item.student.last_name}
                  </span>
                  <span className="bgc-modal-student-wksa">{item.student.wksa_id}</span>
                  <span className="bgc-modal-rank-flow">
                    {item.currentRank?.name} ➔ {item.destinationRank?.name || "—"}
                  </span>
                  <span className={`bgc-status-badge bgc-status-${item.student.status.toLowerCase()}`}>
                    {item.student.status_display || item.student.status}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-ghost bgc-btn-remove-individual"
                  onClick={() => handleRemoveStudentFromCohort(item.student.id)}
                  data-testid={`bgc-remove-student-${item.student.id}`}
                >
                  ✕ Remove
                </button>
              </li>
            ))}
          </ul>

          <div className="action-row dialog__actions">
            <button
              type="button"
              className="btn-primary gs-create-btn"
              onClick={() => setExceptionsModalOpen(false)}
              data-testid="bgc-modal-done-btn"
              data-dialog-autofocus
            >
              Done
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
