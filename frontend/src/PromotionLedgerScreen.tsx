import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  type CandidateOutcome,
  type GradingCandidate,
  type Promotion,
  type Rank,
  bulkPromoteCandidateOutcomes,
  getAllCandidateOutcomes,
  getAllGradingCandidates,
  getAllPromotions,
  getGradingSession,
  getRanks,
  promoteCandidateOutcome,
} from "./api";
import { useAuth } from "./auth";
import { BeltSwatch } from "./SyllabusScreen";
import { useDialogFocus } from "./useDialogFocus";
import "./PromotionLedger.css";
import { formatApiDate } from "./dates";

/*
  `grading_date` and `Promotion.effective_date` are both date-only. Parsed as
  timestamps they were read as UTC midnight, so west of UTC the ledger showed
  the day before the grading - and `effective_date` is the date a rank change
  took effect, which is part of the promotion record.
*/
function formatSessionDate(dateStr?: string | null): string {
  return formatApiDate(dateStr, { day: "numeric", month: "short", year: "numeric" });
}

type PromotionRowItem = {
  candidate: GradingCandidate;
  outcome?: CandidateOutcome;
  promotion?: Promotion;
  currentRankName: string;
  currentRankCode: string;
  targetRankName: string;
  isEligible: boolean;
  isPromoted: boolean;
};

export function PromotionLedgerScreen(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  const [isBatchTrayOpen, setIsBatchTrayOpen] = useState(false);
  const [singlePromoteCandidate, setSinglePromoteCandidate] = useState<PromotionRowItem | null>(
    null,
  );
  const [singlePromoteNotes, setSinglePromoteNotes] = useState("");
  const [actionFeedback, setActionFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const canPromote = Boolean(currentUser?.can_promote_student);

  // Queries
  const { data: session, isLoading: isLoadingSession } = useQuery({
    queryKey: ["gradingSession", sessionId],
    queryFn: () => getGradingSession(sessionId),
    enabled: !Number.isNaN(sessionId) && sessionId > 0,
  });

  const { data: candidatesData, isLoading: isLoadingCandidates } = useQuery({
    queryKey: ["gradingCandidates", sessionId],
    queryFn: () => getAllGradingCandidates({ session: sessionId }),
    enabled: !Number.isNaN(sessionId) && sessionId > 0,
  });

  const { data: outcomesData, isLoading: isLoadingOutcomes } = useQuery({
    queryKey: ["candidateOutcomes", sessionId],
    queryFn: () => getAllCandidateOutcomes({ session: sessionId }),
    enabled: !Number.isNaN(sessionId) && sessionId > 0,
  });

  const { data: promotionsData, isLoading: isLoadingPromotions } = useQuery({
    queryKey: ["promotions", sessionId],
    queryFn: () => getAllPromotions({ session: sessionId }),
    enabled: !Number.isNaN(sessionId) && sessionId > 0,
  });

  const { data: ranksData } = useQuery({
    queryKey: ["ranks"],
    queryFn: () => getRanks(),
  });

  // Ranks map
  const ranksMap = useMemo(() => {
    const map = new Map<number, Rank>();
    ranksData?.results.forEach((r) => map.set(r.id, r));
    return map;
  }, [ranksData]);

  // Promotions map
  const promotionsMap = useMemo(() => {
    const map = new Map<number, Promotion>();
    promotionsData?.results.forEach((p) => {
      map.set(p.grading_candidate, p);
      if (p.outcome) map.set(p.outcome, p);
    });
    return map;
  }, [promotionsData]);

  // Outcomes map
  const outcomesMap = useMemo(() => {
    const map = new Map<number, CandidateOutcome>();
    outcomesData?.results.forEach((o) => map.set(o.candidate, o));
    return map;
  }, [outcomesData]);

  // Enriched rows
  const rows = useMemo<PromotionRowItem[]>(() => {
    if (!candidatesData?.results) return [];

    return candidatesData.results.map((candidate) => {
      const outcome = outcomesMap.get(candidate.id);
      const promotion = promotionsMap.get(candidate.id);

      const currentRankObj = ranksMap.get(candidate.student);
      const currentRankName =
        currentRankObj?.name ||
        promotion?.from_rank_name ||
        "Current Rank";
      const currentRankCode =
        currentRankObj?.code ||
        promotion?.from_rank_code ||
        "WHITE";

      const targetRankName =
        candidate.testing_for_rank_name ||
        promotion?.to_rank_name ||
        "Next Rank";

      const isPromoted = Boolean(promotion);
      const isFinalisedPass =
        outcome?.status === "FINALISED" && outcome?.final_outcome === "PASS";
      const isNotWithdrawn = candidate.status !== "WITHDRAWN";

      const isEligible = isFinalisedPass && isNotWithdrawn && !isPromoted;

      return {
        candidate,
        outcome,
        promotion,
        currentRankName,
        currentRankCode,
        targetRankName,
        isEligible,
        isPromoted,
      };
    });
  }, [candidatesData, outcomesMap, promotionsMap, ranksMap]);

  // Eligible cohort
  const eligibleCohort = useMemo(() => rows.filter((r) => r.isEligible), [rows]);

  // Single promote mutation
  const singlePromoteMutation = useMutation({
    mutationFn: async ({ outcomeId, notes }: { outcomeId: number; notes?: string }) => {
      return promoteCandidateOutcome(outcomeId, { notes });
    },
    onSuccess: (promotion) => {
      queryClient.invalidateQueries({ queryKey: ["promotions", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["students"] });
      queryClient.invalidateQueries({ queryKey: ["gradingCandidates", sessionId] });
      setSinglePromoteCandidate(null);
      setSinglePromoteNotes("");
      setActionFeedback({
        type: "success",
        message: `Successfully promoted ${promotion.student_display_name} to ${promotion.to_rank_name}!`,
      });
    },
    onError: (err: Error) => {
      setActionFeedback({
        type: "error",
        message: err.message || "Failed to promote candidate.",
      });
    },
  });
  const singlePromotionDialogRef = useDialogFocus<HTMLDivElement>({
    isOpen: singlePromoteCandidate !== null,
    onClose: () => setSinglePromoteCandidate(null),
    canClose: !singlePromoteMutation.isPending,
  });

  // Bulk promote mutation
  const bulkPromoteMutation = useMutation({
    mutationFn: async (outcomes: number[]) => {
      return bulkPromoteCandidateOutcomes({ outcomes });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["promotions", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["students"] });
      queryClient.invalidateQueries({ queryKey: ["gradingCandidates", sessionId] });
      setIsBatchTrayOpen(false);

      if (res.errors && res.errors.length > 0) {
        setActionFeedback({
          type: "error",
          message: `Promoted ${res.promoted.length} candidates, but ${res.errors.length} encountered errors.`,
        });
      } else {
        setActionFeedback({
          type: "success",
          message: `Successfully promoted all ${res.promoted.length} qualified candidates!`,
        });
      }
    },
    onError: (err: Error) => {
      setActionFeedback({
        type: "error",
        message: err.message || "Failed to execute batch promotion.",
      });
    },
  });

  function handleConfirmBulkPromote() {
    const outcomeIds = eligibleCohort
      .map((r) => r.outcome?.id)
      .filter((id): id is number => typeof id === "number");

    if (outcomeIds.length === 0) return;
    bulkPromoteMutation.mutate(outcomeIds);
  }

  function handleConfirmSinglePromote() {
    if (!singlePromoteCandidate?.outcome?.id) return;
    singlePromoteMutation.mutate({
      outcomeId: singlePromoteCandidate.outcome.id,
      notes: singlePromoteNotes.trim(),
    });
  }

  const isLoading =
    isLoadingSession || isLoadingCandidates || isLoadingOutcomes || isLoadingPromotions;

  return (
    <section aria-labelledby="pl-title" className="pl-container" data-testid="promotion-ledger-screen">
      {/* Breadcrumb & Navigation */}
      <nav className="pl-breadcrumb" aria-label="Breadcrumb">
        <Link to="/gradings" className="pl-breadcrumb-link">
          Grading Sessions
        </Link>
        <span className="pl-breadcrumb-sep" aria-hidden="true">
          ›
        </span>
        <Link to={`/gradings/${sessionId}`} className="pl-breadcrumb-link">
          {session?.title || "Session"}
        </Link>
        <span className="pl-breadcrumb-sep" aria-hidden="true">
          ›
        </span>
        <span className="pl-breadcrumb-current" aria-current="page">
          Promotion Ledger
        </span>
      </nav>

      {/* Screen Header */}
      <header className="pl-header">
        <div className="pl-header-main">
          <h1 className="pl-title" id="pl-title">
            {session ? `${session.title} — Promotion Ledger` : "Promotion Ledger"}
          </h1>
          <p className="pl-subtitle">
            Review finalised candidates, confirm destination ranks, and execute official student
            promotions with locked session grading dates.
          </p>
        </div>
        <div className="pl-header-actions">
          <button
            type="button"
            className="btn btn-ghost pl-back-btn"
            onClick={() => navigate(`/gradings/${sessionId}`)}
          >
            ← Back to session
          </button>
        </div>
      </header>

      {/* Authority Disclaimer if user lacks permission */}
      {!canPromote && (
        <div className="pl-banner pl-banner-warning" role="alert">
          <span className="pl-banner-icon" aria-hidden="true">
            🔒
          </span>
          <div>
            <strong>Promotion Authority Required</strong>
            <p>
              You do not hold the <code>can_promote_student</code> permission. The promotion
              ledger is displayed in read-only inspection mode. Only authorised Masters or
              administrators may confer ranks.
            </p>
          </div>
        </div>
      )}

      {/* Action feedback banner */}
      {actionFeedback && (
        <div
          className={`pl-banner pl-banner-${actionFeedback.type}`}
          role={actionFeedback.type === "error" ? "alert" : "status"}
        >
          <span className="pl-banner-icon" aria-hidden="true">
            {actionFeedback.type === "success" ? "✓" : "✕"}
          </span>
          <div className="pl-banner-content">
            <span>{actionFeedback.message}</span>
            <button
              type="button"
              className="pl-banner-dismiss"
              onClick={() => setActionFeedback(null)}
              aria-label="Dismiss message"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Top Cohort Promotion Summary Card */}
      <section className="pl-summary-card" aria-label="Cohort Promotion Summary">
        <div className="pl-summary-info">
          <span className="pl-summary-count">
            {eligibleCohort.length} Candidates Finalised with Pass · Eligible for Promotion
          </span>
          {eligibleCohort.length === 0 && rows.some((r) => r.isPromoted) && (
            <span className="pl-summary-note">
              All qualified candidates in this cohort have already been promoted.
            </span>
          )}
        </div>

        <button
          type="button"
          className="btn btn-primary pl-summary-cta"
          onClick={() => setIsBatchTrayOpen(true)}
          disabled={eligibleCohort.length === 0 || !canPromote}
          title={
            !canPromote
              ? "Promotion authority required to promote cohort"
              : eligibleCohort.length === 0
              ? "No unpromoted candidates eligible"
              : `Review and promote ${eligibleCohort.length} qualified candidates`
          }
        >
          <span aria-hidden="true">✓</span>
          <span>Promote Qualified Cohort ({eligibleCohort.length} Candidates)</span>
        </button>
      </section>

      {/* Candidates Promotion Ledger Table */}
      <div className="pl-table-container">
        {isLoading ? (
          <div className="pl-loading-state" role="status">Loading candidate promotion ledger…</div>
        ) : rows.length === 0 ? (
          <div className="pl-empty-state">
            <p>No candidates registered in this grading session.</p>
          </div>
        ) : (
          <table className="pl-table" aria-label="Student Promotion Ledger">
            <thead>
              <tr>
                <th scope="col" className="pl-th-candidate">
                  Candidate
                </th>
                <th scope="col" className="pl-th-current-belt">
                  Current Belt
                </th>
                <th scope="col" className="pl-th-outcome">
                  Outcome
                </th>
                <th scope="col" className="pl-th-eligibility">
                  Promotion Eligibility
                </th>
                <th scope="col" className="pl-th-actions" style={{ textAlign: "right" }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const candidateId = row.candidate.id;
                const studentName = row.candidate.student_display_name;
                const currentRankDisplay = row.currentRankName;
                const outcome = row.outcome;

                let outcomeBadgeClass = "badge-neutral";
                let outcomeLabel = "Pending Outcome";

                if (outcome?.status === "FINALISED") {
                  if (outcome.final_outcome === "PASS") {
                    outcomeBadgeClass = "badge-success";
                    outcomeLabel = "Pass (Finalised)";
                  } else if (outcome.final_outcome === "CONDITIONAL") {
                    outcomeBadgeClass = "badge-warning";
                    outcomeLabel = "Conditional (Finalised)";
                  } else if (outcome.final_outcome === "FAIL") {
                    outcomeBadgeClass = "badge-danger";
                    outcomeLabel = "Fail (Finalised)";
                  }
                } else if (outcome?.status === "PROPOSED") {
                  outcomeLabel = `Proposed: ${outcome.proposed_outcome || "Pending"}`;
                }

                return (
                  <tr
                    key={candidateId}
                    className={`pl-table-row ${row.isEligible ? "is-eligible" : ""} ${
                      row.isPromoted ? "is-promoted" : ""
                    }`}
                    data-testid={`promotion-row-${candidateId}`}
                  >
                    {/* Candidate Identity */}
                    <td className="pl-cell-candidate">
                      <div className="pl-candidate-cell">
                        <span className="pl-candidate-avatar" aria-hidden="true">
                          {studentName.charAt(0)}
                        </span>
                        <div className="pl-candidate-meta">
                          <span className="pl-candidate-name">{studentName}</span>
                          <span className="pl-candidate-belt-sub">
                            ({currentRankDisplay})
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Current Belt */}
                    <td className="pl-cell-current-belt">
                      <div className="pl-belt-chip">
                        <BeltSwatch
                          rankCode={row.currentRankCode}
                          rankName={row.currentRankName}
                        />
                        <span className="pl-belt-name">{row.currentRankName}</span>
                      </div>
                    </td>

                    {/* Outcome Badge */}
                    <td className="pl-cell-outcome">
                      <span className={`badge ${outcomeBadgeClass}`}>
                        {outcomeLabel}
                      </span>
                    </td>

                    {/* Promotion Eligibility */}
                    <td className="pl-cell-eligibility">
                      {row.isPromoted ? (
                        <div className="pl-eligibility-promoted">
                          <span className="badge badge-success">
                            Promoted to {row.promotion?.to_rank_name || row.targetRankName} ✓
                          </span>
                          {row.promotion?.effective_date && (
                            <span className="pl-promoted-date">
                              Effective {formatSessionDate(row.promotion.effective_date)}
                            </span>
                          )}
                        </div>
                      ) : row.isEligible ? (
                        <span className="badge badge-accent pl-eligible-badge">
                          Eligible for {row.targetRankName}
                        </span>
                      ) : outcome?.final_outcome === "CONDITIONAL" ? (
                        <span className="pl-ineligible-note">
                          Re-test required before promotion
                        </span>
                      ) : outcome?.final_outcome === "FAIL" ? (
                        <span className="pl-ineligible-note">
                          Outcome not passed
                        </span>
                      ) : (
                        <span className="pl-ineligible-note">
                          Outcome pending finalisation
                        </span>
                      )}
                    </td>

                    {/* Row Actions */}
                    <td className="pl-cell-actions" style={{ textAlign: "right" }}>
                      {row.isPromoted ? (
                        <span className="pl-action-complete" aria-label="Promotion completed">
                          Promoted ✓
                        </span>
                      ) : row.isEligible ? (
                        <button
                          type="button"
                          className="btn btn-secondary pl-row-promote-btn"
                          onClick={() => {
                            setSinglePromoteCandidate(row);
                            setSinglePromoteNotes("");
                          }}
                          disabled={
                            !canPromote ||
                            singlePromoteMutation.isPending ||
                            bulkPromoteMutation.isPending
                          }
                          data-testid={`promote-candidate-btn-${candidateId}`}
                        >
                          <span>Promote to {row.targetRankName}</span>
                          <span className="pl-btn-caret" aria-hidden="true">
                            ▾
                          </span>
                        </button>
                      ) : (
                        <span className="pl-action-disabled">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pinned Batch Confirmation Preview Tray (SCR-023 bottom dock) */}
      {isBatchTrayOpen && eligibleCohort.length > 0 && (
        <aside
          className="pl-batch-tray"
          aria-label="Pinned batch confirmation preview"
          role="region"
        >
          <div className="pl-batch-tray-content">
            {/* Left Section: Header & Candidate Pills List */}
            <div className="pl-batch-left">
              <div className="pl-batch-header">
                <h2 className="pl-batch-title">Pinned batch confirmation preview</h2>
                <span className="pl-batch-count-tag">
                  {eligibleCohort.length} Candidates Selected
                </span>
              </div>
              <div className="pl-batch-chips" role="list">
                {eligibleCohort.map((r, i) => (
                  <div
                    key={r.candidate.id}
                    className="pl-batch-chip"
                    role="listitem"
                  >
                    <span className="pl-chip-num">{i + 1}.</span>
                    <span className="pl-chip-name">{r.candidate.student_display_name}</span>
                    <span className="pl-chip-rank">({r.currentRankName})</span>
                    <span className="pl-chip-arrow" aria-hidden="true">
                      →
                    </span>
                    <strong className="pl-chip-target">{r.targetRankName}</strong>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Section: Metadata Card & Action CTA */}
            <div className="pl-batch-right">
              <button
                type="button"
                className="pl-batch-close-btn"
                onClick={() => setIsBatchTrayOpen(false)}
                aria-label="Close batch preview tray"
              >
                ✕
              </button>
              <div className="pl-batch-meta">
                <div className="pl-meta-row">
                  <span className="pl-meta-label">Locked</span>
                  <span className="pl-meta-val">
                    {formatSessionDate(session?.grading_date)}
                  </span>
                </div>
                <div className="pl-meta-row">
                  <span className="pl-meta-label">Promoter</span>
                  <span className="pl-meta-val">
                    {currentUser?.full_name || currentUser?.first_name || "Authorised Master"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary pl-batch-confirm-btn"
                onClick={handleConfirmBulkPromote}
                disabled={bulkPromoteMutation.isPending || !canPromote}
              >
                {bulkPromoteMutation.isPending ? (
                  <>
                    <span className="pl-spinner" aria-hidden="true" />
                    <span>Promoting cohort…</span>
                  </>
                ) : (
                  <>
                    <span aria-hidden="true">✓</span>
                    <span>Confirm Batch Promotion</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Single Candidate Promotion Confirmation Dialog */}
      {singlePromoteCandidate && (
        <div
          className="pl-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !singlePromoteMutation.isPending) {
              setSinglePromoteCandidate(null);
            }
          }}
        >
          <div
            ref={singlePromotionDialogRef}
            className="pl-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="single-promote-title"
            tabIndex={-1}
          >
            <header className="pl-modal-header">
              <h2 id="single-promote-title" className="pl-modal-title">
                Confirm Student Promotion
              </h2>
              <button
                type="button"
                className="pl-modal-close-btn"
                onClick={() => setSinglePromoteCandidate(null)}
                disabled={singlePromoteMutation.isPending}
                aria-label="Close promotion dialog"
              >
                ✕
              </button>
            </header>

            <div className="pl-modal-body">
              <div className="pl-modal-candidate-info">
                <span className="pl-modal-name">
                  {singlePromoteCandidate.candidate.student_display_name}
                </span>
                <p className="pl-modal-ranks">
                  <span>Current: <strong>{singlePromoteCandidate.currentRankName}</strong></span>
                  <span className="pl-modal-arrow" aria-hidden="true">→</span>
                  <span>Conferring: <strong className="pl-highlight-rank">{singlePromoteCandidate.targetRankName}</strong></span>
                </p>
                <p className="pl-modal-date-notice">
                  Effective date: <strong>{formatSessionDate(session?.grading_date)}</strong> (locked to grading date).
                </p>
              </div>

              <div className="pl-field-wrap">
                <label htmlFor="single-promote-notes" className="pl-field-label">
                  Promotion Notes (Optional)
                </label>
                <textarea
                  id="single-promote-notes"
                  className="pl-textarea"
                  rows={2}
                  value={singlePromoteNotes}
                  onChange={(e) => setSinglePromoteNotes(e.target.value)}
                  placeholder="Official record notes or ceremonial remarks..."
                  disabled={singlePromoteMutation.isPending}
                />
              </div>
            </div>

            <footer className="pl-modal-footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setSinglePromoteCandidate(null)}
                disabled={singlePromoteMutation.isPending}
                data-dialog-autofocus
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmSinglePromote}
                disabled={singlePromoteMutation.isPending || !canPromote}
              >
                {singlePromoteMutation.isPending ? (
                  <>
                    <span className="pl-spinner" aria-hidden="true" />
                    <span>Recording promotion…</span>
                  </>
                ) : (
                  `Promote to ${singlePromoteCandidate.targetRankName}`
                )}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
