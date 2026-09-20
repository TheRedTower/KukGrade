import React, { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  BulkCandidateRegistrationPayload,
  BulkCandidateRegistrationResponse,
  GradingSession,
  Rank,
  StudentListItem,
  bulkRegisterCandidates,
  getAllGradingCandidates,
  getAllStudents,
  getGradingSession,
  getRanks,
} from "./api";
import { useDialogFocus } from "./useDialogFocus";

function formatSessionDate(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    if (!year || !month || !day) return dateStr;
    const date = new Date(year, month - 1, day);
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  } catch {
    return dateStr;
  }
}

function RankVisual({ rankName }: { rankName: string }) {
  const isStripe = rankName.toLowerCase().includes("stripe");
  const lower = rankName.toLowerCase();

  let color = "#94a3b8"; // white / default
  if (lower.includes("white")) color = "#cbd5e1";
  else if (lower.includes("yellow")) color = "#eab308";
  else if (lower.includes("blue")) color = "#2563eb";
  else if (lower.includes("red")) color = "#dc2626";
  else if (lower.includes("brown")) color = "#78350f";
  else if (lower.includes("black") || lower.includes("dahn")) color = "#0f172a";

  if (isStripe) {
    return (
      <span
        className="bgc-rank-stripes"
        style={{ "--rank-color": color } as React.CSSProperties}
        aria-hidden="true"
      >
        <span className="bgc-stripe-bar" />
        <span className="bgc-stripe-bar" />
      </span>
    );
  }

  return (
    <span
      className="bgc-rank-dot"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

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
  const exceptionsDialogRef = useDialogFocus<HTMLDivElement>({
    isOpen: exceptionsModalOpen,
    onClose: () => setExceptionsModalOpen(false),
  });

  // Submitting and registration results state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Exception Resolver (SCR-018) state
  const [registrationResult, setRegistrationResult] = useState<BulkCandidateRegistrationResponse | null>(null);
  const [flaggedItems, setFlaggedItems] = useState<FlaggedCandidateItem[]>([]);
  const [showSuccessfulList, setShowSuccessfulList] = useState(false);

  // Queries
  const sessionQuery = useQuery({
    queryKey: ["gradingSession", sessionId],
    queryFn: () => getGradingSession(sessionId),
    enabled: !isNaN(sessionId),
  });

  const ranksQuery = useQuery({
    queryKey: ["ranks"],
    queryFn: () => getRanks({ page_size: 50 }),
  });

  const studentsQuery = useQuery({
    queryKey: ["students", "all-eligible"],
    queryFn: () => getAllStudents(),
  });

  const candidatesQuery = useQuery({
    queryKey: ["gradingCandidates", sessionId],
    queryFn: () => getAllGradingCandidates({ session: sessionId }),
    enabled: !isNaN(sessionId),
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

    const activeRanks = ranks.filter((r) => r.active);
    for (let i = 0; i < activeRanks.length; i++) {
      const cur = activeRanks[i];
      if (i + 1 < activeRanks.length) {
        nextMap.set(cur.id, activeRanks[i + 1]);
      }
    }

    return { rankMap: map, nextRankMap: nextMap };
  }, [ranks]);

  // Already registered student IDs in this grading session
  const registeredStudentIds = useMemo(() => {
    const existing = Array.isArray(candidatesQuery.data)
      ? candidatesQuery.data
      : (candidatesQuery.data?.results ?? []);
    return new Set<number>(existing.map((c) => c.student));
  }, [candidatesQuery.data]);

  // Eligible students: exclude LEFT (domain rule) and exclude already registered in this session
  const eligibleStudents = useMemo(() => {
    const all = studentsQuery.data?.results ?? [];
    return all.filter((s) => s.status !== "LEFT" && !registeredStudentIds.has(s.id));
  }, [studentsQuery.data, registeredStudentIds]);

  // Filtered eligible students based on toolbar controls
  const filteredEligibleStudents = useMemo(() => {
    return eligibleStudents.filter((s) => {
      // Search
      const q = search.trim().toLowerCase();
      if (q) {
        const fullName = `${s.first_name} ${s.last_name}`.toLowerCase();
        const wksa = (s.wksa_id || "").toLowerCase();
        if (!fullName.includes(q) && !wksa.includes(q)) {
          return false;
        }
      }

      // Rank filter
      if (rankFilter !== "ALL") {
        if (String(s.current_rank) !== rankFilter && s.current_rank_code !== rankFilter) {
          return false;
        }
      }

      // Status filter
      if (statusFilter === "ACTIVE" && s.status !== "ACTIVE") return false;
      if (statusFilter === "INACTIVE" && s.status !== "INACTIVE") return false;

      // Age group filter
      if (ageFilter !== "ALL") {
        const matchesCanonical = s.age_band === ageFilter;
        const matchesShort =
          (ageFilter === "8_UNDER" && s.age_band === "AGE_8_AND_UNDER") ||
          (ageFilter === "9_12" && s.age_band === "AGE_9_TO_12") ||
          (ageFilter === "13_17" && s.age_band === "AGE_13_TO_17") ||
          (ageFilter === "18_PLUS" && s.age_band === "AGE_18_AND_OVER");
        const matchesDisplay =
          (ageFilter === "8 and under" && s.age_band === "AGE_8_AND_UNDER") ||
          (ageFilter === "9-12" && s.age_band === "AGE_9_TO_12") ||
          (ageFilter === "13-17" && s.age_band === "AGE_13_TO_17") ||
          (ageFilter === "18+" && s.age_band === "AGE_18_AND_OVER");

        if (!matchesCanonical && !matchesShort && !matchesDisplay) {
          return false;
        }
      }

      return true;
    });
  }, [eligibleStudents, search, rankFilter, statusFilter, ageFilter]);

  // Group filtered eligible students by their current rank
  const rankGroups = useMemo(() => {
    const groups: {
      rank: Rank;
      destinationRank: Rank | null;
      students: StudentListItem[];
      activeCount: number;
      inactiveCount: number;
      kidsCount: number;
      adultsCount: number;
    }[] = [];

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
        const kidsCount = students.filter(
          (s) => s.age_band === "AGE_8_AND_UNDER" || s.age_band === "AGE_9_TO_12"
        ).length;
        const adultsCount = students.filter(
          (s) => s.age_band === "AGE_13_TO_17" || s.age_band === "AGE_18_AND_OVER"
        ).length;
        groups.push({
          rank: r,
          destinationRank: dest,
          students,
          activeCount,
          inactiveCount,
          kidsCount,
          adultsCount,
        });
      }
    }

    return groups;
  }, [ranks, filteredEligibleStudents, nextRankMap]);

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

  // Submit bulk candidate registration
  const handleSubmitCohort = async () => {
    if (cohort.length === 0 || !session) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const payload: BulkCandidateRegistrationPayload = {
      session: session.id,
      candidates: cohort.map((item) => ({
        student: item.student.id,
        testing_for_rank: item.destinationRank?.id,
      })),
      generate_assessments: generateAssessments,
    };

    try {
      const response = await bulkRegisterCandidates(payload);

      // Invalidate relevant queries so cache reflects newly registered candidates
      queryClient.invalidateQueries({ queryKey: ["gradingCandidates", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["gradingSession", sessionId] });

      const errorKeys = Object.keys(response.errors);
      if (errorKeys.length === 0) {
        // Complete 100% success! Navigate directly to grading session detail
        navigate(`/gradings/${sessionId}`);
      } else {
        // Partial success or errors: transition to Exception Resolver (SCR-018)
        setRegistrationResult(response);

        const flagged: FlaggedCandidateItem[] = errorKeys.map((idxStr) => {
          const idx = Number(idxStr);
          const cohortItem = cohort[idx];
          const errorMsg = (response.errors[idxStr] || []).join(", ");
          const isAlreadyRegistered = errorMsg.toLowerCase().includes("already registered");

          return {
            key: idxStr,
            student: cohortItem?.student,
            destinationRank: cohortItem?.destinationRank,
            error: errorMsg || "Registration failed",
            isAlreadyRegistered,
          };
        });

        setFlaggedItems(flagged);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(err.message);
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError("Failed to register grading candidates. Please check your connection.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Exception Resolver: Remove flagged item from retry list
  const handleRemoveFlaggedCandidate = (key: string) => {
    setFlaggedItems((prev) => prev.filter((item) => item.key !== key));
  };

  // Exception Resolver: Retry remaining flagged candidates
  const handleRetryFlagged = async () => {
    const retryableItems = flaggedItems.filter((item) => !item.isAlreadyRegistered);
    if (retryableItems.length === 0 || !session) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const retryPayload: BulkCandidateRegistrationPayload = {
      session: session.id,
      candidates: retryableItems.map((item) => ({
        student: item.student.id,
        testing_for_rank: item.destinationRank?.id,
      })),
      generate_assessments: generateAssessments,
    };

    try {
      const response = await bulkRegisterCandidates(retryPayload);

      queryClient.invalidateQueries({ queryKey: ["gradingCandidates", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["gradingSession", sessionId] });

      const remainingErrorKeys = Object.keys(response.errors);
      if (remainingErrorKeys.length === 0) {
        // All retries succeeded! Finish and return to grading session
        navigate(`/gradings/${sessionId}`);
      } else {
        // Update flagged items with remaining errors
        const newlyFlagged: FlaggedCandidateItem[] = remainingErrorKeys.map((idxStr) => {
          const idx = Number(idxStr);
          const item = retryableItems[idx];
          const errorMsg = (response.errors[idxStr] || []).join(", ");
          return {
            key: idxStr,
            student: item.student,
            destinationRank: item.destinationRank,
            error: errorMsg,
            isAlreadyRegistered: errorMsg.toLowerCase().includes("already registered"),
          };
        });
        setFlaggedItems(newlyFlagged);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(err.message);
      } else {
        setSubmitError("Retry failed. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading and error states for session
  if (isNaN(sessionId)) {
    return (
      <div className="bgc-page" data-testid="bgc-page">
        <div className="gsd-error-state">
          <h2>Invalid Grading Session ID</h2>
          <p>Please return to the grading sessions list.</p>
          <Link to="/gradings" className="btn-primary">Back to Gradings</Link>
        </div>
      </div>
    );
  }

  if (sessionQuery.isLoading) {
    return (
      <div className="bgc-page" data-testid="bgc-page">
        <div className="gsd-loading-state">
          <div className="gsd-spinner" aria-hidden="true" />
          <p>Loading grading session cohort workspace...</p>
        </div>
      </div>
    );
  }

  if (sessionQuery.isError || !session) {
    return (
      <div className="bgc-page" data-testid="bgc-page">
        <div className="gsd-error-state">
          <h2>Failed to load grading session</h2>
          <p>{sessionQuery.error instanceof Error ? sessionQuery.error.message : "Session not found."}</p>
          <Link to="/gradings" className="btn-primary">Back to Gradings</Link>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW: Exception Resolver (SCR-018 / FDR-031)
  // ══════════════════════════════════════════════════════════════════════════
  if (registrationResult && flaggedItems.length > 0) {
    const createdCount = registrationResult.created.length;
    const flaggedCount = flaggedItems.length;
    const retryableCount = flaggedItems.filter((i) => !i.isAlreadyRegistered).length;

    return (
      <div className="bgc-page" data-testid="bgc-page">
        {/* Breadcrumbs */}
        <nav className="bgc-breadcrumbs" aria-label="Breadcrumbs">
          <Link to="/gradings" className="bgc-breadcrumb-link">Gradings</Link>
          <span className="bgc-breadcrumb-sep" aria-hidden="true">/</span>
          <Link to={`/gradings/${session.id}`} className="bgc-breadcrumb-link">{session.title}</Link>
          <span className="bgc-breadcrumb-sep" aria-hidden="true">/</span>
          <span className="bgc-breadcrumb-current">Resolve flagged candidates</span>
        </nav>

        {/* Header */}
        <header className="bgc-header">
          <h1 className="bgc-title">Resolve flagged candidates</h1>
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

          <div className="bgc-table-wrap">
            <table className="bgc-table" aria-label="Flagged candidates">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">WKSA ID</th>
                  <th scope="col">Issue</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="bgc-th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {flaggedItems.map((item) => (
                  <tr key={item.key} className="bgc-tr-flagged">
                    <td className="bgc-td-student">
                      <span className="bgc-student-name">
                        {item.student?.first_name} {item.student?.last_name}
                      </span>
                    </td>
                    <td className="bgc-td-wksa">{item.student?.wksa_id}</td>
                    <td className="bgc-td-issue">
                      <span className="bgc-issue-text">{item.error}</span>
                    </td>
                    <td className="bgc-td-status">
                      {item.isAlreadyRegistered ? (
                        <span className="bgc-status-badge bgc-badge-muted">No retry needed</span>
                      ) : (
                        <span className={`bgc-status-badge bgc-status-${item.student?.status?.toLowerCase()}`}>
                          {item.student?.status_display || item.student?.status}
                        </span>
                      )}
                    </td>
                    <td className="bgc-td-actions">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW: Cohort Builder Workspace (SCR-017 / FDR-030)
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="bgc-page" data-testid="bgc-page">
      {/* Breadcrumbs */}
      <nav className="bgc-breadcrumbs" aria-label="Breadcrumbs">
        <Link to="/gradings" className="bgc-breadcrumb-link">Gradings</Link>
        <span className="bgc-breadcrumb-sep" aria-hidden="true">/</span>
        <Link to={`/gradings/${session.id}`} className="bgc-breadcrumb-link">{session.title}</Link>
        <span className="bgc-breadcrumb-sep" aria-hidden="true">/</span>
        <span className="bgc-breadcrumb-current">Build grading cohort</span>
      </nav>

      {/* Header */}
      <header className="bgc-header">
        <h1 className="bgc-title">Build grading cohort</h1>
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
      <div className="bgc-workspace-grid">
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
            <div className="bgc-filters-bar">
              <div className="bgc-search-field">
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

              <div className="bgc-filter-group">
                <label htmlFor="bgc-rank-filter" className="bgc-filter-label">
                  Current rank
                </label>
                <select
                  id="bgc-rank-filter"
                  className="bgc-select"
                  value={rankFilter}
                  onChange={(e) => setRankFilter(e.target.value)}
                >
                  <option value="ALL">All ranks</option>
                  {ranks.map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bgc-filter-group">
                <label htmlFor="bgc-age-filter" className="bgc-filter-label">
                  Age group
                </label>
                <select
                  id="bgc-age-filter"
                  className="bgc-select"
                  value={ageFilter}
                  onChange={(e) => setAgeFilter(e.target.value)}
                  data-testid="bgc-age-filter"
                >
                  <option value="ALL">All ages</option>
                  <option value="AGE_8_AND_UNDER">8 and under</option>
                  <option value="AGE_9_TO_12">9-12</option>
                  <option value="AGE_13_TO_17">13-17</option>
                  <option value="AGE_18_AND_OVER">18+</option>
                </select>
              </div>

              <div className="bgc-filter-group">
                <label htmlFor="bgc-status-filter" className="bgc-filter-label">
                  Status
                </label>
                <select
                  id="bgc-status-filter"
                  className="bgc-select"
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
            <div className="bgc-filter-summary-card">
              <div className="bgc-summary-info">
                <span className="bgc-info-icon" aria-hidden="true">ℹ</span>
                <span className="bgc-info-text">
                  Students with Left status are excluded (not eligible for grading).
                </span>
              </div>
              <div className="bgc-summary-actions">
                <span className="bgc-matching-count">
                  {filteredEligibleStudents.length === 1
                    ? "1 student matches"
                    : `${filteredEligibleStudents.length} students match`}
                </span>
                <button
                  type="button"
                  className="btn-primary gs-create-btn bgc-add-filtered-btn"
                  onClick={handleAddAllFiltered}
                  disabled={filteredEligibleStudents.length === 0}
                  data-testid="bgc-add-all-filtered-btn"
                >
                  Add all {filteredEligibleStudents.length} filtered students
                </button>
              </div>
            </div>

            {/* Filtered matching student records table */}
            <div className="bgc-table-wrap bgc-matching-table-wrap" data-testid="bgc-filtered-students-table">
              {filteredEligibleStudents.length === 0 ? (
                <div className="bgc-empty-filtered" data-testid="bgc-empty-filtered">
                  No eligible students match the selected filters.
                </div>
              ) : (
                <table className="bgc-table" aria-label="Matching eligible students">
                  <thead>
                    <tr>
                      <th scope="col">Student</th>
                      <th scope="col">WKSA ID</th>
                      <th scope="col">Current rank</th>
                      <th scope="col">Destination rank</th>
                      <th scope="col">Age band</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="bgc-th-action">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEligibleStudents.map((s) => {
                      const isAdded = cohortStudentIdSet.has(s.id);
                      const currentRankObj = rankMap.get(s.current_rank);
                      const destRankObj = nextRankMap.get(s.current_rank);

                      return (
                        <tr key={s.id} data-testid={`bgc-student-row-${s.id}`}>
                          <td className="bgc-td-student">
                            <Link
                              to={`/students/${s.id}`}
                              className="bgc-student-name-link"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {s.first_name} {s.last_name}
                            </Link>
                          </td>
                          <td className="bgc-td-wksa">{s.wksa_id || "—"}</td>
                          <td className="bgc-td-rank">
                            <div className="bgc-rank-cell">
                              <RankVisual rankName={s.current_rank_name || currentRankObj?.name || ""} />
                              <span className="bgc-rank-label">
                                {s.current_rank_name || currentRankObj?.name || "—"}
                              </span>
                            </div>
                          </td>
                          <td className="bgc-td-rank">
                            {destRankObj ? (
                              <div className="bgc-rank-cell">
                                <RankVisual rankName={destRankObj.name} />
                                <span className="bgc-rank-label">{destRankObj.name}</span>
                              </div>
                            ) : (
                              <span className="bgc-highest-rank">Highest rank</span>
                            )}
                          </td>
                          <td className="bgc-td-ageband">
                            <span className="bgc-ageband-badge">
                              {s.age_band_display || s.age_band || "—"}
                            </span>
                          </td>
                          <td className="bgc-td-status">
                            <span className={`bgc-status-badge bgc-status-${s.status.toLowerCase()}`}>
                              {s.status_display || s.status}
                            </span>
                          </td>
                          <td className="bgc-td-action">
                            {isAdded ? (
                              <button
                                type="button"
                                className="btn-ghost bgc-student-added-btn"
                                onClick={() => handleRemoveStudentFromCohort(s.id)}
                                title="Click to remove student from cohort"
                                data-testid={`bgc-student-added-${s.id}`}
                              >
                                Added ✓
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn-primary gs-create-btn bgc-add-student-btn"
                                onClick={() => handleAddStudentToCohort(s)}
                                data-testid={`bgc-add-student-${s.id}`}
                              >
                                + Add
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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

            <div className="bgc-table-wrap">
              <table className="bgc-table" aria-label="Eligible rank groups">
                <thead>
                  <tr>
                    <th scope="col">Current rank</th>
                    <th scope="col" aria-hidden="true" className="bgc-th-arrow" />
                    <th scope="col">Destination rank</th>
                    <th scope="col">Age mix</th>
                    <th scope="col">Eligible</th>
                    <th scope="col" className="bgc-th-action">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rankGroups.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="bgc-empty-td">
                        {filteredEligibleStudents.length === 0
                          ? "No eligible students match the selected filters."
                          : "No eligible students found to register."}
                      </td>
                    </tr>
                  ) : (
                    rankGroups.map((group) => {
                      const allGroupAdded = group.students.every((s) => cohortStudentIdSet.has(s.id));
                      const someGroupAdded = group.students.some((s) => cohortStudentIdSet.has(s.id));

                      return (
                        <tr key={group.rank.id}>
                          <td className="bgc-td-rank">
                            <div className="bgc-rank-cell">
                              <RankVisual rankName={group.rank.name} />
                              <span className="bgc-rank-label">{group.rank.name}</span>
                            </div>
                          </td>
                          <td className="bgc-td-arrow" aria-hidden="true">
                            →
                          </td>
                          <td className="bgc-td-rank">
                            {group.destinationRank ? (
                              <div className="bgc-rank-cell">
                                <RankVisual rankName={group.destinationRank.name} />
                                <span className="bgc-rank-label">{group.destinationRank.name}</span>
                              </div>
                            ) : (
                              <span className="bgc-highest-rank">Highest rank</span>
                            )}
                          </td>
                          <td className="bgc-td-agemix">
                            <span className="bgc-agemix-badge">
                              Kids {group.kidsCount} | Adults {group.adultsCount}
                            </span>
                          </td>
                          <td className="bgc-td-eligible">
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
                          </td>
                          <td className="bgc-td-action">
                            {allGroupAdded ? (
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
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                  </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* ── RIGHT COLUMN: Cohort Ledger & Confirmation ─────────────────── */}
        <div className="bgc-right-column">
          <aside className="bgc-cohort-tray" aria-label="Cohort to register">
            <div className="bgc-tray-header">
              <div className="bgc-tray-title-row">
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
            <div className="bgc-tray-table-wrap">
              <table className="bgc-tray-table" aria-label="Selected cohort groups">
                <thead>
                  <tr>
                    <th scope="col">Current rank</th>
                    <th scope="col" aria-hidden="true" className="bgc-th-arrow" />
                    <th scope="col">Next rank</th>
                    <th scope="col">Count</th>
                    <th scope="col" className="bgc-th-remove">Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {cohortBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="bgc-tray-empty-td">
                        No rank groups added yet. Add a group from the left panel to begin.
                      </td>
                    </tr>
                  ) : (
                    cohortBreakdown.map((item) => (
                      <tr key={item.rankId}>
                        <td className="bgc-tray-td-rank">
                          <div className="bgc-rank-cell">
                            {item.currentRank && <RankVisual rankName={item.currentRank.name} />}
                            <span className="bgc-rank-label">
                              {item.currentRank?.name || "Unknown"}
                            </span>
                          </div>
                        </td>
                        <td className="bgc-tray-td-arrow" aria-hidden="true">
                          →
                        </td>
                        <td className="bgc-tray-td-rank">
                          <div className="bgc-rank-cell">
                            {item.destinationRank && (
                              <RankVisual rankName={item.destinationRank.name} />
                            )}
                            <span className="bgc-rank-label">
                              {item.destinationRank?.name || "—"}
                            </span>
                          </div>
                        </td>
                        <td className="bgc-tray-td-count">{item.count}</td>
                        <td className="bgc-tray-td-remove">
                          <button
                            type="button"
                            className="bgc-btn-remove-group"
                            onClick={() => handleRemoveRankGroup(item.rankId)}
                            aria-label={`Remove ${item.currentRank?.name} group`}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

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
            <div className="bgc-tray-actions">
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
        <div
          className="gsd-modal-overlay"
          role="presentation"
          onClick={() => setExceptionsModalOpen(false)}
        >
          <div
            ref={exceptionsDialogRef}
            className="gsd-modal-card bgc-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bgc-modal-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gsd-modal-header">
              <h2 id="bgc-modal-title" className="gsd-modal-title">
                Review cohort candidates ({cohort.length})
              </h2>
              <button
                type="button"
                className="gsd-modal-close-btn"
                onClick={() => setExceptionsModalOpen(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <p className="gsd-modal-message">
              Remove individual students who should not be registered in this grading cohort.
            </p>

            <div className="bgc-modal-list-wrap">
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
            </div>

            <div className="gsd-modal-actions">
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
          </div>
        </div>
      )}
    </div>
  );
}
