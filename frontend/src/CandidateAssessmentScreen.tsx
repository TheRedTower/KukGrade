import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  CandidateAssessmentItem,
  CandidateAssessmentItemResult,
  GradingCandidate,
  generateCandidateAssessment,
  getAllGradingCandidates,
  getCandidateAssessments,
  getAllCandidateAssessmentItems,
  getGradingSession,
  getStudents,
  updateCandidateAssessment,
  updateCandidateAssessmentItem,
} from "./api";
import "./CandidateAssessment.css";

function formatTimeOnly(isoStr: string | null): string {
  if (!isoStr) return "";
  try {
    const date = new Date(isoStr);
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return "";
  }
}

function RankVisual({ rankName }: { rankName: string }) {
  const isStripe = rankName.toLowerCase().includes("stripe");
  const lower = rankName.toLowerCase();

  let color = "#94a3b8"; // default
  if (lower.includes("yellow")) color = "#eab308";
  else if (lower.includes("blue")) color = "#2563eb";
  else if (lower.includes("red")) color = "#dc2626";
  else if (lower.includes("brown")) color = "#78350f";
  else if (lower.includes("black") || lower.includes("dahn") || lower.includes("pu sa")) color = "#0f172a";

  if (isStripe) {
    return (
      <span
        className="caw-rank-stripes"
        style={{ "--rank-color": color } as React.CSSProperties}
        aria-hidden="true"
      >
        <span className="caw-stripe-bar" />
        <span className="caw-stripe-bar" />
      </span>
    );
  }

  return (
    <span
      className="caw-rank-dot"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

interface CategoryGroup {
  category: string;
  categoryDisplay: string;
  koreanName?: string;
  items: CandidateAssessmentItem[];
  totalCount: number;
  requiredCount: number;
  requiredAssessedCount: number;
  remainingRequiredCount: number;
  isDone: boolean;
}

export function CandidateAssessmentScreen() {
  const { sessionId, candidateId } = useParams<{ sessionId: string; candidateId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const numSessionId = sessionId ? Number(sessionId) : undefined;
  const numCandidateId = candidateId ? Number(candidateId) : undefined;

  // User selected category filter
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // Toggle for Completion Review mode (SCR-020)
  const [isReviewMode, setIsReviewMode] = useState(false);
  // General assessment notes for completion (user override or initial server notes)
  const [userNotes, setUserNotes] = useState<string | null>(null);
  // Error state for actions
  const [actionError, setActionError] = useState<string | null>(null);

  // 1. Fetch grading session
  const sessionQuery = useQuery({
    queryKey: ["gradingSession", numSessionId],
    queryFn: () => getGradingSession(numSessionId!),
    enabled: numSessionId !== undefined && !isNaN(numSessionId),
  });

  // 2. Fetch candidate info
  const candidatesQuery = useQuery({
    queryKey: ["gradingCandidates", numSessionId],
    queryFn: () => getAllGradingCandidates({ session: numSessionId! }),
    enabled: numSessionId !== undefined && !isNaN(numSessionId),
  });

  const candidate: GradingCandidate | undefined = useMemo(() => {
    if (!candidatesQuery.data?.results || !numCandidateId) return undefined;
    return candidatesQuery.data.results.find((c) => c.id === numCandidateId);
  }, [candidatesQuery.data, numCandidateId]);

  // 3. Fetch candidate's student to retrieve current_rank
  const studentQuery = useQuery({
    queryKey: ["student", candidate?.student],
    queryFn: () => getStudents({ search: candidate?.student_wksa_id }),
    enabled: !!candidate?.student_wksa_id,
  });

  const studentRankName = useMemo(() => {
    if (studentQuery.data?.results && studentQuery.data.results.length > 0) {
      return studentQuery.data.results[0].current_rank_name;
    }
    return "";
  }, [studentQuery.data]);

  // 4. Fetch candidate assessments for this candidate
  const assessmentQuery = useQuery({
    queryKey: ["candidateAssessment", numCandidateId],
    queryFn: async () => {
      const res = await getCandidateAssessments({ candidate: numCandidateId! });
      return res.results.length > 0 ? res.results[0] : null;
    },
    enabled: numCandidateId !== undefined && !isNaN(numCandidateId),
  });

  const assessment = assessmentQuery.data;

  const generalNotes = userNotes !== null ? userNotes : (assessment?.notes ?? "");

  // 5. Fetch all items for this assessment
  const itemsQuery = useQuery({
    queryKey: ["candidateAssessmentItems", assessment?.id],
    queryFn: () => getAllCandidateAssessmentItems({ assessment: assessment!.id }),
    enabled: !!assessment?.id,
  });

  const items = useMemo(() => {
    return itemsQuery.data?.results ?? [];
  }, [itemsQuery.data]);

  // 6. Group items by category
  const categoryGroups: CategoryGroup[] = useMemo(() => {
    if (items.length === 0) return [];

    const map = new Map<string, CategoryGroup>();
    for (const item of items) {
      const catKey = item.category;
      if (!map.has(catKey)) {
        map.set(catKey, {
          category: catKey,
          categoryDisplay: item.category_display || catKey,
          koreanName: item.korean_name,
          items: [],
          totalCount: 0,
          requiredCount: 0,
          requiredAssessedCount: 0,
          remainingRequiredCount: 0,
          isDone: false,
        });
      }
      const group = map.get(catKey)!;
      group.items.push(item);
      group.totalCount += 1;
      if (item.required) {
        group.requiredCount += 1;
        if (item.result !== "NOT_ASSESSED") {
          group.requiredAssessedCount += 1;
        }
      }
    }

    // Set active category default if not set
    const groups = Array.from(map.values()).map((g) => {
      const remaining = g.requiredCount - g.requiredAssessedCount;
      return {
        ...g,
        remainingRequiredCount: remaining,
        isDone: remaining === 0,
      };
    });

    return groups;
  }, [items]);

  // Default active category to the first one with remaining items, or the first group
  const activeCategory =
    selectedCategory ??
    (categoryGroups.find((g) => !g.isDone)?.category ?? categoryGroups[0]?.category ?? "");

  // 7. Overall rollup statistics
  const stats = useMemo(() => {
    let totalItems = 0;
    let requiredItems = 0;
    let requiredAssessed = 0;
    let metCount = 0;
    let notMetCount = 0;
    let notAssessedCount = 0;

    for (const item of items) {
      totalItems += 1;
      if (item.required) {
        requiredItems += 1;
        if (item.result !== "NOT_ASSESSED") {
          requiredAssessed += 1;
        }
      }
      if (item.result === "MET") metCount += 1;
      else if (item.result === "NOT_MET") notMetCount += 1;
      else notAssessedCount += 1;
    }

    const remainingRequired = requiredItems - requiredAssessed;
    const percent = requiredItems > 0 ? Math.round((requiredAssessed / requiredItems) * 100) : 100;

    return {
      totalItems,
      requiredItems,
      requiredAssessed,
      remainingRequired,
      percent,
      metCount,
      notMetCount,
      notAssessedCount,
      canComplete: remainingRequired === 0 && requiredItems > 0,
    };
  }, [items]);

  // 8. Mutations
  const generateAssessmentMutation = useMutation({
    mutationFn: () => {
      if (!candidate) throw new Error("Candidate not found");
      return generateCandidateAssessment(candidate.id);
    },
    onSuccess: (generated) => {
      setActionError(null);
      queryClient.setQueryData(["candidateAssessment", numCandidateId], generated);
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", numSessionId] });
      queryClient.invalidateQueries({ queryKey: ["gradingCandidates", numSessionId] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setActionError(err.message);
      } else {
        setActionError("Failed to prepare the assessment form.");
      }
    },
  });

  // Start assessment mutation
  const startAssessmentMutation = useMutation({
    mutationFn: () => {
      if (!assessment) throw new Error("Assessment not found");
      return updateCandidateAssessment(assessment.id, { status: "IN_PROGRESS" });
    },
    onSuccess: (updated) => {
      setActionError(null);
      queryClient.setQueryData(["candidateAssessment", numCandidateId], updated);
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", numSessionId] });
      queryClient.invalidateQueries({ queryKey: ["gradingCandidates", numSessionId] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setActionError(err.message);
      } else {
        setActionError("Failed to start assessment.");
      }
    },
  });

  // Update item result mutation
  const updateItemMutation = useMutation({
    mutationFn: ({
      itemId,
      result,
      notes,
    }: {
      itemId: number;
      result?: CandidateAssessmentItemResult;
      notes?: string;
    }) => {
      const payload: { result?: CandidateAssessmentItemResult; assessor_notes?: string } = {};
      if (result !== undefined) payload.result = result;
      if (notes !== undefined) payload.assessor_notes = notes;
      return updateCandidateAssessmentItem(itemId, payload);
    },
    onMutate: async ({ itemId, result, notes }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ["candidateAssessmentItems", assessment?.id] });
      const previous = queryClient.getQueryData<{ results: CandidateAssessmentItem[] }>([
        "candidateAssessmentItems",
        assessment?.id,
      ]);

      if (previous?.results) {
        const nextResults = previous.results.map((i) => {
          if (i.id === itemId) {
            return {
              ...i,
              result: result !== undefined ? result : i.result,
              assessor_notes: notes !== undefined ? notes : i.assessor_notes,
            };
          }
          return i;
        });
        queryClient.setQueryData(["candidateAssessmentItems", assessment?.id], {
          ...previous,
          results: nextResults,
        });
      }
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["candidateAssessmentItems", assessment?.id], context.previous);
      }
      if (err instanceof ApiError) {
        setActionError(err.message);
      } else {
        setActionError("Could not save item evaluation.");
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["candidateAssessmentItems", assessment?.id] });
      queryClient.invalidateQueries({ queryKey: ["candidateAssessment", numCandidateId] });
    },
  });

  // Complete assessment mutation
  const completeAssessmentMutation = useMutation({
    mutationFn: () => {
      if (!assessment) throw new Error("Assessment not found");
      return updateCandidateAssessment(assessment.id, {
        status: "COMPLETED",
        notes: generalNotes,
      });
    },
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["candidateAssessment", numCandidateId] });
      queryClient.invalidateQueries({ queryKey: ["candidateAssessments", numSessionId] });
      queryClient.invalidateQueries({ queryKey: ["gradingCandidates", numSessionId] });
      navigate(`/gradings/${numSessionId}`);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setActionError(err.message);
      } else {
        setActionError("Failed to complete assessment.");
      }
    },
  });

  // Loading state
  if (
    sessionQuery.isLoading ||
    candidatesQuery.isLoading ||
    assessmentQuery.isLoading ||
    (assessment && itemsQuery.isLoading)
  ) {
    return (
      <section aria-label="Candidate assessment workspace" className="caw-page" data-testid="caw-loading">
        <div className="caw-loading-state" role="status">
          <span className="status-dot status-dot-pulse" aria-hidden="true" />
          <p>Loading candidate assessment workspace...</p>
        </div>
      </section>
    );
  }

  // Not found or error state
  if (!sessionQuery.data || !candidate) {
    return (
      <section aria-label="Candidate assessment workspace" className="caw-page" data-testid="caw-not-found">
        <div className="caw-error-banner" role="alert">
          <p>Candidate or grading session not found.</p>
          <Link to={`/gradings/${sessionId}`} className="btn-secondary">
            ← Return to session roster
          </Link>
        </div>
      </section>
    );
  }

  const session = sessionQuery.data;
  const isAssessmentCompleted = assessment?.status === "COMPLETED";
  const isAssessmentMissing = assessment === null;
  const isAssessmentNotStarted = assessment?.status === "NOT_STARTED";
  const isAssessmentInProgress = assessment?.status === "IN_PROGRESS";

  // Filter items for the active category
  const activeGroup = categoryGroups.find((g) => g.category === activeCategory) ?? categoryGroups[0];
  const itemsToDisplay = activeCategory ? (activeGroup?.items ?? []) : items;

  // Render SCR-020: Assessment Completion Review Mode
  if (isReviewMode) {
    const notMetItems = items.filter((item) => item.result === "NOT_MET");

    return (
      <section aria-labelledby="caw-review-title" className="caw-page" data-testid="caw-review-workspace">
        {/* Top Breadcrumb Header */}
        <nav aria-label="Breadcrumbs" className="caw-breadcrumbs">
          <Link to="/gradings">Gradings</Link>
          <span aria-hidden="true" className="breadcrumb-separator">/</span>
          <Link to={`/gradings/${session.id}`}>{session.title}</Link>
          <span aria-hidden="true" className="breadcrumb-separator">/</span>
          <span className="breadcrumb-current">{candidate.student_display_name} (Completion Review)</span>
        </nav>

        <header className="caw-review-header">
          <div>
            <h1 className="caw-candidate-title" id="caw-review-title">Review &amp; Complete Assessment</h1>
            <div className="caw-candidate-sub">
              <span className="caw-candidate-name">{candidate.student_display_name}</span>
              {candidate.student_wksa_id && (
                <span className="caw-candidate-wksa">WKSA ID: {candidate.student_wksa_id}</span>
              )}
              <div className="caw-rank-pills">
                <span className="caw-rank-tag">
                  {studentRankName && <RankVisual rankName={studentRankName} />}
                  <span>{studentRankName || "Current Rank"}</span>
                </span>
                <span aria-hidden="true" className="caw-rank-arrow">→</span>
                <span className="caw-rank-tag caw-rank-tag-dest">
                  <RankVisual rankName={candidate.testing_for_rank_name} />
                  <span>{candidate.testing_for_rank_name}</span>
                </span>
                <span className="caw-age-pill">{candidate.age_band_display}</span>
              </div>
            </div>
          </div>
        </header>

        {actionError && (
          <div className="caw-action-error" role="alert">
            <span aria-hidden="true">⚠️</span>
            <p>{actionError}</p>
          </div>
        )}

        {/* Dual-Card Review Layout */}
        <div className="caw-review-grid">
          {/* Left Column: Evaluation Rollup & Category Breakdown */}
          <div className="caw-review-left-card">
            <div className="caw-card-header">
              <h2 className="caw-card-title">Evaluation Rollup</h2>
              <div className="caw-rollup-chips">
                <span className="caw-chip caw-chip-total">
                  {stats.requiredAssessed}/{stats.requiredItems} Required Assessed ({stats.percent}%)
                </span>
                <span className="caw-chip caw-chip-met">
                  ✓ {stats.metCount} Met
                </span>
                {stats.notMetCount > 0 && (
                  <span className="caw-chip caw-chip-not-met">
                    ✕ {stats.notMetCount} Not Met
                  </span>
                )}
              </div>
            </div>

            <div className="caw-category-table-wrap">
              <h3 className="caw-table-heading">Category Breakdown</h3>
              <table className="caw-category-table">
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col">Met status</th>
                    <th scope="col">Percentage</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryGroups.map((group) => {
                    const metInGroup = group.items.filter((i) => i.result === "MET").length;
                    const notMetInGroup = group.items.filter((i) => i.result === "NOT_MET").length;
                    const pct = group.totalCount > 0 ? Math.round((metInGroup / group.totalCount) * 100) : 100;

                    return (
                      <tr key={group.category} data-testid={`review-cat-row-${group.category}`}>
                        <td className="caw-cat-td-name">
                          <strong>{group.categoryDisplay}</strong>
                          {group.koreanName && (
                            <span className="caw-korean-sub"> ({group.koreanName})</span>
                          )}
                        </td>
                        <td className="caw-cat-td-status">
                          {metInGroup}/{group.totalCount} Met
                        </td>
                        <td className="caw-cat-td-pct">
                          {notMetInGroup > 0 ? (
                            <span className="caw-pct-flag">({notMetInGroup} Not Met)</span>
                          ) : (
                            <span className="caw-pct-clean">({pct}%) <span className="caw-check-icon">✓</span></span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Column: Flagged Not Met Items & Confirmation */}
          <div className="caw-review-right-card">
            {/* Flagged Not Met Items */}
            <div className="caw-not-met-section">
              <h2 className="caw-card-title caw-title-warning">
                Attention: {notMetItems.length} {notMetItems.length === 1 ? "Item" : "Items"} Not Met
              </h2>
              {notMetItems.length === 0 ? (
                <p className="caw-clean-text">All requirements were successfully met with no recorded deficiencies.</p>
              ) : (
                <ul className="caw-not-met-list">
                  {notMetItems.map((item) => (
                    <li key={item.id} className="caw-not-met-item" data-testid={`flagged-item-${item.id}`}>
                      <div className="caw-not-met-header">
                        <span className="caw-not-met-title">
                          #{item.requirement_sequence} {item.item_name}
                          {item.korean_name && ` · ${item.korean_name}`}
                        </span>
                        <span className="caw-not-met-cat">Category: {item.category_display}</span>
                      </div>
                      {item.assessor_notes && (
                        <p className="caw-not-met-notes">"{item.assessor_notes}"</p>
                      )}
                      {item.assessor_email && (
                        <span className="caw-not-met-assessor">
                          Assessed by {item.assessor_email}
                          {item.assessed_at && ` at ${formatTimeOnly(item.assessed_at)}`}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* General Assessment Notes */}
            <div className="caw-notes-section">
              <label htmlFor="general-assessment-notes" className="caw-card-title">
                General Assessment Notes
              </label>
              <textarea
                id="general-assessment-notes"
                className="caw-notes-textarea"
                rows={4}
                placeholder="Overall candidate notes (optional)"
                value={generalNotes}
                onChange={(e) => setUserNotes(e.target.value)}
                disabled={isAssessmentCompleted}
              />
            </div>

            {/* Confirm Completion Box */}
            <div className="caw-confirm-box">
              <div className="caw-confirm-warning">
                <span className="caw-warning-icon" aria-hidden="true">⚠️</span>
                <span>Completed assessments cannot be edited once confirmed.</span>
              </div>
              <div className="caw-confirm-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsReviewMode(false)}
                >
                  Return to scoring
                </button>
                <button
                  type="button"
                  className="btn-primary caw-complete-btn"
                  onClick={() => completeAssessmentMutation.mutate()}
                  disabled={completeAssessmentMutation.isPending || isAssessmentCompleted}
                  data-testid="confirm-complete-assessment-btn"
                >
                  {completeAssessmentMutation.isPending ? "Confirming..." : "Confirm & complete assessment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Render SCR-019: Mat-side Scoring Workspace
  return (
    <section aria-labelledby="caw-title" className="caw-page" data-testid="caw-workspace">
      {/* Top Breadcrumbs */}
      <nav aria-label="Breadcrumbs" className="caw-breadcrumbs">
        <Link to="/gradings">Gradings</Link>
        <span aria-hidden="true" className="breadcrumb-separator">/</span>
        <Link to={`/gradings/${session.id}`}>{session.title}</Link>
        <span aria-hidden="true" className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">{candidate.student_display_name} (Assessment)</span>
      </nav>

      {/* Header Banner */}
      <header className="caw-header">
        <div className="caw-header-left">
          <h1 className="caw-candidate-name" id="caw-title">{candidate.student_display_name}</h1>
          {candidate.student_wksa_id && (
            <span className="caw-candidate-wksa">
              <span className="caw-wksa-label">WKSA ID</span>
              <span className="caw-wksa-val">{candidate.student_wksa_id}</span>
            </span>
          )}
          <div className="caw-rank-pills">
            <span className="caw-rank-tag">
              {studentRankName && <RankVisual rankName={studentRankName} />}
              <span>{studentRankName || "Current Rank"}</span>
            </span>
            <span aria-hidden="true" className="caw-rank-arrow">→</span>
            <span className="caw-rank-tag caw-rank-tag-dest">
              <RankVisual rankName={candidate.testing_for_rank_name} />
              <span>{candidate.testing_for_rank_name}</span>
            </span>
            <span className="caw-age-pill">{candidate.age_band_display}</span>
            <span
              className={`caw-status-pill caw-status-${assessment?.status?.toLowerCase() || "not-started"}`}
            >
              <span className="caw-status-dot" aria-hidden="true" />
              {assessment?.status_display || "Not started"}
            </span>
          </div>
        </div>

        <div className="caw-header-right">
          {isAssessmentCompleted ? (
            <button
              type="button"
              className="btn-secondary caw-review-btn"
              onClick={() => setIsReviewMode(true)}
              data-testid="caw-view-review-btn"
            >
              View completion record →
            </button>
          ) : (
            <button
              type="button"
              className={`caw-complete-action-btn ${stats.canComplete ? "caw-complete-ready" : ""}`}
              disabled={!stats.canComplete}
              onClick={() => setIsReviewMode(true)}
              title={
                stats.canComplete
                  ? "Proceed to completion review"
                  : `${stats.remainingRequired} required items remain unassessed`
              }
              data-testid="caw-complete-assessment-btn"
            >
              {stats.canComplete
                ? "Complete assessment →"
                : `Complete assessment (${stats.remainingRequired} required remaining)`}
            </button>
          )}
        </div>
      </header>

      {actionError && (
        <div className="caw-action-error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <p>{actionError}</p>
        </div>
      )}

      {/* Required Items Assessed Progress Ledger */}
      <div className="caw-progress-ledger" role="status" aria-live="polite">
        <div className="caw-progress-main">
          <span className="caw-progress-icon" aria-hidden="true">
            {stats.remainingRequired === 0 ? "✓" : "!"}
          </span>
          <span className="caw-progress-text">
            <strong>{stats.requiredAssessed} / {stats.requiredItems}</strong> Required items assessed ({stats.percent}%)
          </span>
        </div>
        <div className="caw-progress-chips">
          <span className="caw-chip caw-chip-met">
            {stats.metCount} Met
          </span>
          <span className="caw-chip caw-chip-not-met">
            {stats.notMetCount} Not Met
          </span>
          <span className="caw-chip caw-chip-not-assessed">
            {stats.notAssessedCount} Not Assessed
          </span>
        </div>
      </div>

      {isAssessmentMissing && (
        <div className="caw-not-started-banner" data-testid="caw-missing-assessment-banner">
          <div className="caw-not-started-content">
            <h3>Prepare Assessment Form</h3>
            <p>
              Generate the candidate&rsquo;s immutable syllabus snapshot before starting
              assessment.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => generateAssessmentMutation.mutate()}
            disabled={generateAssessmentMutation.isPending || session.status !== "DRAFT"}
            data-testid="generate-assessment-btn"
          >
            {generateAssessmentMutation.isPending
              ? "Preparing..."
              : session.status !== "DRAFT"
              ? "Session must be Draft to prepare"
              : "Prepare assessment form"}
          </button>
        </div>
      )}

      {/* A generated snapshot is started separately once the session is open. */}
      {isAssessmentNotStarted && (
        <div className="caw-not-started-banner" data-testid="caw-not-started-banner">
          <div className="caw-not-started-content">
            <h3>Assessment Ready To Begin</h3>
            <p>
              Candidates must have their assessment started before individual syllabus items can be scored.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => startAssessmentMutation.mutate()}
            disabled={startAssessmentMutation.isPending || session.status !== "OPEN"}
            data-testid="start-assessment-btn"
          >
            {startAssessmentMutation.isPending
              ? "Starting..."
              : session.status !== "OPEN"
              ? "Session must be Open to start"
              : "Start assessment"}
          </button>
        </div>
      )}

      {/* Dual-Pane Workspace */}
      <div className="caw-dual-pane">
        {/* Left Category Sub-Rail */}
        <aside aria-label="Syllabus Categories" className="caw-category-rail">
          <ul className="caw-category-list" role="tablist" aria-orientation="vertical">
            {categoryGroups.map((group) => {
              const isActive = activeCategory === group.category;
              return (
                <li key={group.category} role="presentation">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`caw-category-tab ${isActive ? "caw-tab-active" : ""}`}
                    onClick={() => setSelectedCategory(group.category)}
                    data-testid={`caw-cat-tab-${group.category}`}
                  >
                    <span className="caw-tab-title">
                      {group.categoryDisplay}
                      {group.koreanName && (
                        <span className="caw-tab-korean"> ({group.koreanName})</span>
                      )}
                    </span>
                    {group.isDone ? (
                      <span className="caw-tab-done-badge" aria-label="Category completed">
                        <span aria-hidden="true">✓</span> Done
                      </span>
                    ) : (
                      <span className="caw-tab-remaining-badge">
                        {group.remainingRequiredCount} remaining
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Right Assessment Items Panel */}
        <main className="caw-items-panel">
          {activeGroup && (
            <div className="caw-category-heading-wrap">
              <h2 className="caw-category-heading">
                {activeGroup.categoryDisplay}
                {activeGroup.koreanName && ` · ${activeGroup.koreanName}`}
                <span className="caw-category-track"> ({candidate.age_band_display})</span>
              </h2>
            </div>
          )}

          {itemsToDisplay.length === 0 ? (
            <div className="caw-empty-items">
              <p>No assessment items found in this section.</p>
            </div>
          ) : (
            <div className="caw-items-list" role="list">
              {itemsToDisplay.map((item) => (
                <AssessmentItemRow
                  key={item.id}
                  item={item}
                  isEditable={isAssessmentInProgress && !isAssessmentCompleted}
                  onUpdateResult={(result) =>
                    updateItemMutation.mutate({ itemId: item.id, result })
                  }
                  onUpdateNotes={(notes) =>
                    updateItemMutation.mutate({ itemId: item.id, notes })
                  }
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

/**
 * Individual Candidate Assessment Item Row Component
 * Implements FDR-033 3-state segmented controls with 48px touch targets,
 * inline notes and assessor attribution.
 */
function AssessmentItemRow({
  item,
  isEditable,
  onUpdateResult,
  onUpdateNotes,
}: {
  item: CandidateAssessmentItem;
  isEditable: boolean;
  onUpdateResult: (result: CandidateAssessmentItemResult) => void;
  onUpdateNotes: (notes: string) => void;
}) {
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(item.assessor_notes || "");

  const handleNotesBlur = () => {
    setIsEditingNotes(false);
    if (notesValue !== (item.assessor_notes || "")) {
      onUpdateNotes(notesValue);
    }
  };

  return (
    <div
      className={`caw-item-card ${item.result === "NOT_MET" ? "caw-item-not-met" : ""}`}
      data-testid={`caw-item-${item.id}`}
    >
      <div className="caw-item-main">
        {/* Left details */}
        <div className="caw-item-info">
          <div className="caw-item-title-row">
            <span className="caw-item-seq">#{item.requirement_sequence}</span>
            <span className="caw-item-name">{item.item_name}</span>
            {item.korean_name && (
              <span className="caw-item-korean"> · {item.korean_name}</span>
            )}
            {item.required ? (
              <span className="caw-required-badge">Required</span>
            ) : (
              <span className="caw-optional-badge">Optional</span>
            )}
          </div>

          {item.requirement_notes && (
            <p className="caw-item-desc">{item.requirement_notes}</p>
          )}

          {/* Assessor attribution & notes summary */}
          <div className="caw-item-meta-row">
            {item.assessor_email && (
              <span className="caw-assessor-tag">
                Assessed by {item.assessor_email}
                {item.assessed_at && ` at ${formatTimeOnly(item.assessed_at)}`}
              </span>
            )}

            {!isEditingNotes && item.assessor_notes && (
              <button
                type="button"
                className="caw-note-preview-btn"
                onClick={() => setIsEditingNotes(true)}
                title="Click to edit assessor note"
              >
                Note: "{item.assessor_notes}"
              </button>
            )}

            {!isEditingNotes && !item.assessor_notes && isEditable && (
              <button
                type="button"
                className="caw-add-note-btn"
                onClick={() => setIsEditingNotes(true)}
              >
                + Add note
              </button>
            )}
          </div>

          {/* Inline notes input */}
          {isEditingNotes && isEditable && (
            <div className="caw-inline-note-wrap">
              <input
                type="text"
                className="caw-inline-note-input"
                placeholder="Add observation note (e.g. Guard dropped on turn)..."
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                onBlur={handleNotesBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNotesBlur();
                  if (e.key === "Escape") {
                    setNotesValue(item.assessor_notes || "");
                    setIsEditingNotes(false);
                  }
                }}
                autoFocus
              />
              <button
                type="button"
                className="btn-secondary caw-save-note-btn"
                onClick={handleNotesBlur}
              >
                Save
              </button>
            </div>
          )}
        </div>

        {/* Right: FDR-033 Segmented 3-state touch controls (min 48px touch targets) */}
        <div
          className="caw-segmented-control"
          role="group"
          aria-label={`Evaluation for ${item.item_name}`}
        >
          <button
            type="button"
            className={`caw-seg-btn caw-seg-not-assessed ${
              item.result === "NOT_ASSESSED" ? "caw-seg-active" : ""
            }`}
            disabled={!isEditable}
            onClick={() => onUpdateResult("NOT_ASSESSED")}
            aria-pressed={item.result === "NOT_ASSESSED"}
            data-testid={`btn-not-assessed-${item.id}`}
          >
            <span aria-hidden="true">—</span>
            <span>Not Assessed</span>
          </button>

          <button
            type="button"
            className={`caw-seg-btn caw-seg-met ${
              item.result === "MET" ? "caw-seg-active" : ""
            }`}
            disabled={!isEditable}
            onClick={() => onUpdateResult("MET")}
            aria-pressed={item.result === "MET"}
            data-testid={`btn-met-${item.id}`}
          >
            <span aria-hidden="true">✓</span>
            <span>Met</span>
          </button>

          <button
            type="button"
            className={`caw-seg-btn caw-seg-not-met ${
              item.result === "NOT_MET" ? "caw-seg-active" : ""
            }`}
            disabled={!isEditable}
            onClick={() => onUpdateResult("NOT_MET")}
            aria-pressed={item.result === "NOT_MET"}
            data-testid={`btn-not-met-${item.id}`}
          >
            <span aria-hidden="true">✕</span>
            <span>Not Met</span>
          </button>
        </div>
      </div>
    </div>
  );
}
