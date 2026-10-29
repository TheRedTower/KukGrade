import { Badge } from "./Badge";
import { ResponsiveTable } from "./ResponsiveTable";
import { outcomeTone } from "./badgeClass";
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
import { Dialog } from "./Dialog";
import "./PromotionLedger.css";
import { formatShortDate } from "./dates";
import { Button } from "./Button";

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

  const [isBatchSummaryOpen, setIsBatchSummaryOpen] = useState(false);
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
  // The ledger needs all four answers; a missing or failed one must not read
  // as "nothing promoted yet".
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
      setIsBatchSummaryOpen(false);

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

  const feedbackBanner = actionFeedback && (
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
  );

  const isLoading = isLoadingSession || (!ledgerLoaded && !ledgerFailed);

  return (
    <section aria-labelledby="pl-title" className="page pl-page" data-testid="promotion-ledger-screen">
      {/* Breadcrumb & Navigation */}
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/gradings">
          Grading Sessions
        </Link>
        <span className="crumbs__sep" aria-hidden="true">
          ›
        </span>
        <Link to={`/gradings/${sessionId}`}>
          {session?.title || "Session"}
        </Link>
        <span className="crumbs__sep" aria-hidden="true">
          ›
        </span>
        <span aria-current="page">
          Promotion Ledger
        </span>
      </nav>

      {/* Screen Header */}
      <header className="action-row">
        <div className="pl-header-main">
          <h1 className="pl-title" id="pl-title">
            {session ? `${session.title} — Promotion Ledger` : "Promotion Ledger"}
          </h1>
          <p className="pl-subtitle">
            Review the candidates who passed, check their new ranks, and promote them. Every promotion is dated the grading day.
          </p>
        </div>
        <div className="pl-header-actions">
          <Button
            variant="ghost"
            onClick={() => navigate(`/gradings/${sessionId}`)}
          >
            ← Back to session
          </Button>
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

      {!isBatchSummaryOpen && !singlePromoteCandidate && feedbackBanner}

      {/* Top Cohort Promotion Summary Card */}
      <section className="action-row pl-summary-card" aria-label="Cohort Promotion Summary">
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

        <Button
          variant="primary"
          onClick={() => setIsBatchSummaryOpen(true)}
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
        </Button>
      </section>

      {/* Candidates Promotion Ledger Table */}
      {ledgerFailed ? (
        <div className="pl-loading-state" role="alert">
          <p>The promotion ledger could not be loaded, so no one can be promoted from it yet.</p>
          <Button
            variant="secondary"
            onClick={() => {
              for (const query of ledgerQueries) {
                if (query.isError) void query.refetch();
              }
            }}
          >
            Try again
          </Button>
        </div>
      ) : isLoading ? (
        <div className="pl-loading-state" role="status">Loading candidate promotion ledger…</div>
      ) : rows.length === 0 ? (
        <div className="pl-empty-state">
          <p>No candidates registered in this grading session.</p>
        </div>
      ) : (
        <ResponsiveTable
          label="Student Promotion Ledger"
          rows={rows}
          rowKey={(row) => row.candidate.id}
          rowTestId={(row) => `promotion-row-${row.candidate.id}`}
          columns={[
            {
              key: "candidate",
              header: "Candidate",
              primary: true,
              render: (row) => (
                <div className="pl-candidate-cell">
                  <span className="pl-candidate-avatar" aria-hidden="true">
                    {row.candidate.student_display_name.charAt(0)}
                  </span>
                  <div className="pl-candidate-meta">
                    <span className="pl-candidate-name">{row.candidate.student_display_name}</span>
                    {/* The rank held at registration, snapshotted on the candidate -
                        never the student's live rank, which moves on once promoted. */}
                    <span className="pl-candidate-belt-sub">({row.candidate.from_rank_name})</span>
                  </div>
                </div>
              ),
            },
            {
              key: "belt",
              header: "Current Belt",
              render: (row) => (
                <div className="pl-belt-chip">
                  <RankBelt rankId={row.candidate.from_rank} />
                  <span className="pl-belt-name">{row.candidate.from_rank_name}</span>
                </div>
              ),
            },
            {
              key: "outcome",
              header: "Outcome",
              render: (row) => {
                const outcome = row.outcome;
                if (outcome?.status === "FINALISED") {
                  const words = { PASS: "Pass", CONDITIONAL: "Conditional", FAIL: "Fail" } as const;
                  const result = outcome.final_outcome;
                  if (result) return <Badge tone={outcomeTone(result)}>{words[result]} (Finalised)</Badge>;
                }
                if (outcome?.status === "PROPOSED") {
                  return <Badge tone="neutral">Proposed: {outcome.proposed_outcome_display || "Pending"}</Badge>;
                }
                return <Badge tone="neutral">Pending Outcome</Badge>;
              },
            },
            {
              key: "eligibility",
              header: "Promotion Eligibility",
              render: (row) =>
                row.isPromoted ? (
                  <div className="pl-eligibility-promoted">
                    <Badge tone="success">
                      Promoted to {row.promotion?.to_rank_name || row.candidate.testing_for_rank_name} ✓
                    </Badge>
                    {row.promotion?.effective_date && (
                      <span className="pl-promoted-date">
                        Effective {formatShortDate(row.promotion.effective_date)}
                      </span>
                    )}
                  </div>
                ) : row.isEligible ? (
                  <Badge tone="warning">Eligible for {row.candidate.testing_for_rank_name}</Badge>
                ) : (
                  <span className="pl-ineligible-note">{row.eligibility?.reason || "Eligibility unavailable"}</span>
                ),
            },
            {
              key: "actions",
              header: "Actions",
              actions: true,
              render: (row) =>
                row.isPromoted ? (
                  <span className="pl-action-complete" aria-label="Promotion completed">
                    Promoted ✓
                  </span>
                ) : row.isEligible ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSinglePromoteCandidate(row);
                      setSinglePromoteNotes("");
                    }}
                    disabled={!canPromote || singlePromoteMutation.isPending || bulkPromoteMutation.isPending}
                    data-testid={`promote-candidate-btn-${row.candidate.id}`}
                  >
                    <span>Promote to {row.candidate.testing_for_rank_name}</span>
                    <span aria-hidden="true">▾</span>
                  </Button>
                ) : (
                  <span className="pl-action-disabled">—</span>
                ),
            },
          ]}
        />
      )}

      {isBatchSummaryOpen && eligibleCohort.length > 0 && (
        <Dialog
          title="Promotion summary"
          closeLabel="Close the promotion summary"
          onClose={() => setIsBatchSummaryOpen(false)}
          canClose={!bulkPromoteMutation.isPending}
        >
          {feedbackBanner}
          <p className="pl-batch-count">{eligibleCohort.length} Candidates Selected</p>
          <ol className="pl-batch-chips">
            {eligibleCohort.map((r, i) => (
              <li key={r.candidate.id} className="pl-batch-chip">
                <span className="pl-chip-num">{i + 1}.</span>
                <span className="pl-chip-name">{r.candidate.student_display_name}</span>
                <span className="pl-chip-rank">({r.candidate.from_rank_name})</span>
                <span className="pl-chip-arrow" aria-hidden="true">→</span>
                <strong className="pl-chip-target">{r.candidate.testing_for_rank_name}</strong>
              </li>
            ))}
          </ol>
          <dl className="facts">
            <div>
              <dt>Grading date</dt>
              <dd>{formatShortDate(session?.grading_date)}</dd>
            </div>
            <div>
              <dt>Promoter</dt>
              <dd>
                {currentUser?.full_name || currentUser?.first_name || "Authorised Master"}
              </dd>
            </div>
          </dl>
          <div className="action-row dialog__actions">
            <Button
              variant="primary"
              onClick={handleConfirmBulkPromote}
              disabled={bulkPromoteMutation.isPending || !canPromote}
            >
              {bulkPromoteMutation.isPending ? "Promoting cohort…" : "Confirm promotions"}
            </Button>
          </div>
        </Dialog>
      )}

      {singlePromoteCandidate && (
        <Dialog
          title="Confirm Student Promotion"
          onClose={() => setSinglePromoteCandidate(null)}
          canClose={!singlePromoteMutation.isPending}
          closeButton={false}
        >
          {feedbackBanner}
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

          <div className="field">
            <label htmlFor="single-promote-notes">Promotion Notes (Optional)</label>
            <textarea
              id="single-promote-notes"
              rows={2}
              value={singlePromoteNotes}
              onChange={(e) => setSinglePromoteNotes(e.target.value)}
              placeholder="Official record notes or ceremonial remarks..."
              disabled={singlePromoteMutation.isPending}
            />
          </div>

          <div className="action-row dialog__actions">
            <Button
              variant="ghost"
              onClick={() => setSinglePromoteCandidate(null)}
              disabled={singlePromoteMutation.isPending}
              data-dialog-autofocus
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirmSinglePromote}
              disabled={singlePromoteMutation.isPending || !canPromote}
            >
              {singlePromoteMutation.isPending
                ? "Recording promotion…"
                : `Promote to ${singlePromoteCandidate.candidate.testing_for_rank_name}`}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
