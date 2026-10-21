import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  type CandidateOutcome,
  type GradingCandidate,
  type Promotion,
  type PromotionEligibility,
  bulkPromoteCandidateOutcomes,
  getAllCandidateOutcomes,
  getAllGradingCandidates,
  getAllPromotions,
  getGradingSession,
  getPromotionEligibility,
  promoteCandidateOutcome,
} from "./api";
import { useAuth } from "./auth";
import { RankBelt } from "./Belt";
import { useDialogFocus } from "./useDialogFocus";
import "./PromotionLedger.css";
import { formatShortDate } from "./dates";

type PromotionRowItem = {
  candidate: GradingCandidate;
  outcome?: CandidateOutcome;
  promotion?: Promotion;
  eligibility?: PromotionEligibility;
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
    queryKey: ["gradingSessions", "detail", sessionId],
    queryFn: () => getGradingSession(sessionId),
    enabled: !Number.isNaN(sessionId) && sessionId > 0,
  });

  const candidatesQuery = useQuery({
    queryKey: ["gradingCandidates", sessionId],
    queryFn: () => getAllGradingCandidates({ session: sessionId }),
    enabled: !Number.isNaN(sessionId) && sessionId > 0,
  });

  const outcomesQuery = useQuery({
    queryKey: ["candidateOutcomes", sessionId],
    queryFn: () => getAllCandidateOutcomes({ session: sessionId }),
    enabled: !Number.isNaN(sessionId) && sessionId > 0,
  });

  const promotionsQuery = useQuery({
    queryKey: ["promotions", sessionId],
    queryFn: () => getAllPromotions({ session: sessionId }),
    enabled: !Number.isNaN(sessionId) && sessionId > 0,
  });
  const eligibilityQuery = useQuery({
    queryKey: ["promotionEligibility", sessionId],
    queryFn: () => getPromotionEligibility(sessionId),
    enabled: !Number.isNaN(sessionId) && sessionId > 0,
  });

  const ledgerQueries = [candidatesQuery, outcomesQuery, promotionsQuery, eligibilityQuery];
  // Eligibility is read from all three together, so a missing or failed one
  // must not read as "nothing promoted yet" (KG-A16).
  const ledgerFailed = ledgerQueries.some((query) => query.isError);
  const ledgerLoaded = ledgerQueries.every((query) => query.isSuccess);
  const candidatesData = ledgerLoaded ? candidatesQuery.data : undefined;
  const outcomesData = ledgerLoaded ? outcomesQuery.data : undefined;
  const promotionsData = ledgerLoaded ? promotionsQuery.data : undefined;
  const eligibilityData = ledgerLoaded ? eligibilityQuery.data : undefined;

  // Promotions map
  const promotionsMap = useMemo(() => {
    const map = new Map<number, Promotion>();
    promotionsData?.results.forEach((p) => {
      map.set(p.grading_candidate, p);
    });
    return map;
  }, [promotionsData]);

  // Outcomes map
  const outcomesMap = useMemo(() => {
    const map = new Map<number, CandidateOutcome>();
    outcomesData?.results.forEach((o) => map.set(o.candidate, o));
    return map;
  }, [outcomesData]);

  const eligibilityMap = useMemo(() => new Map(eligibilityData?.map((item) => [item.candidate, item])), [eligibilityData]);

  // Enriched rows
  const rows = useMemo<PromotionRowItem[]>(() => {
    if (!candidatesData?.results) return [];

    return candidatesData.results.map((candidate) => {
      const outcome = outcomesMap.get(candidate.id);
      const promotion = promotionsMap.get(candidate.id);
      const eligibility = eligibilityMap.get(candidate.id);

      const isPromoted = Boolean(promotion);
      const isEligible = eligibility?.eligible === true;

      return {
        candidate,
        outcome,
        promotion,
        eligibility,
        isEligible,
        isPromoted,
      };
    });
  }, [candidatesData, outcomesMap, promotionsMap, eligibilityMap]);

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
      queryClient.invalidateQueries({ queryKey: ["promotionEligibility", sessionId] });
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
    onSuccess: (res, sentOutcomes) => {
      queryClient.invalidateQueries({ queryKey: ["promotions", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["students"] });
      queryClient.invalidateQueries({ queryKey: ["gradingCandidates", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["promotionEligibility", sessionId] });
      setIsBatchTrayOpen(false);

      const failures = Object.entries(res.errors);
      if (failures.length > 0) {
        // Errors are keyed by the row's index in the request; name each
        // candidate and say why, so the admin knows whom to look at rather
        // than only how many.
        const nameFor = (index: string) => {
          const outcomeId = sentOutcomes[Number(index)];
          return (
            rows.find((r) => r.outcome?.id === outcomeId)?.candidate.student_display_name ??
            "A candidate"
          );
        };
        const details = failures
          .map(([index, reasons]) => `${nameFor(index)}: ${reasons.join(" ")}`)
          .join("; ");
        setActionFeedback({
          type: "error",
          message: `Promoted ${res.promoted.length} of ${res.promoted.length + failures.length}. Not promoted - ${details}`,
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
        message: err.message || "Could not promote the selected candidates.",
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

  const isLoading = isLoadingSession || (!ledgerLoaded && !ledgerFailed);

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
            Review the candidates who passed, check their new ranks, and promote them. Every promotion is dated the grading day.
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
            <strong>Promotion authority needed</strong>
            <p>
              You can review this ledger, but promoting students needs promotion authority, which an administrator can grant.
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
            {eligibleCohort.length} {eligibleCohort.length === 1 ? "Candidate" : "Candidates"} Finalised with Pass · Eligible for Promotion
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
      {/* Focusable, so a keyboard can scroll it sideways when it is wider than the screen. */}
      <div className="pl-table-container" tabIndex={0} role="region" aria-label="Promotion ledger">
        {ledgerFailed ? (
          <div className="pl-loading-state" role="alert">
            <p>The promotion ledger could not be loaded, so no one can be promoted from it yet.</p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                for (const query of ledgerQueries) {
                  if (query.isError) void query.refetch();
                }
              }}
            >
              Try again
            </button>
          </div>
        ) : isLoading ? (
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
                // The rank held at registration, snapshotted on the candidate -
                // never the student's live rank, which moves on once promoted.
                const currentRankDisplay = row.candidate.from_rank_name;
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
                  outcomeLabel = `Proposed: ${outcome.proposed_outcome_display || "Pending"}`;
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
                        <RankBelt rankId={row.candidate.from_rank} />
                        <span className="pl-belt-name">{row.candidate.from_rank_name}</span>
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
                            Promoted to {row.promotion?.to_rank_name || row.candidate.testing_for_rank_name} ✓
                          </span>
                          {row.promotion?.effective_date && (
                            <span className="pl-promoted-date">
                              Effective {formatShortDate(row.promotion.effective_date)}
                            </span>
                          )}
                        </div>
                      ) : row.isEligible ? (
                        <span className="badge badge-accent pl-eligible-badge">
                          Eligible for {row.candidate.testing_for_rank_name}
                        </span>
                      ) : (
                        <span className="pl-ineligible-note">
                          {row.eligibility?.reason || "Eligibility unavailable"}
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
                          <span>Promote to {row.candidate.testing_for_rank_name}</span>
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
          aria-label="Promotion summary"
          role="region"
        >
          <div className="pl-batch-tray-content">
            {/* Left Section: Header & Candidate Pills List */}
            <div className="pl-batch-left">
              <div className="pl-batch-header">
                <h2 className="pl-batch-title">Promotion summary</h2>
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
                    <span className="pl-chip-rank">({r.candidate.from_rank_name})</span>
                    <span className="pl-chip-arrow" aria-hidden="true">
                      →
                    </span>
                    <strong className="pl-chip-target">{r.candidate.testing_for_rank_name}</strong>
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
                aria-label="Close the promotion summary"
              >
                ✕
              </button>
              <div className="pl-batch-meta">
                <div className="pl-meta-row">
                  <span className="pl-meta-label">Grading date</span>
                  <span className="pl-meta-val">
                    {formatShortDate(session?.grading_date)}
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
                    <span>Confirm promotions</span>
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
                  <span>Current: <strong>{singlePromoteCandidate.candidate.from_rank_name}</strong></span>
                  <span className="pl-modal-arrow" aria-hidden="true">→</span>
                  <span>Conferring: <strong className="pl-highlight-rank">{singlePromoteCandidate.candidate.testing_for_rank_name}</strong></span>
                </p>
                <p className="pl-modal-date-notice">
                  Effective date: <strong>{formatShortDate(session?.grading_date)}</strong> (the grading day).
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
                  `Promote to ${singlePromoteCandidate.candidate.testing_for_rank_name}`
                )}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
