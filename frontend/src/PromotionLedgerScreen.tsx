import { PageHeader } from "./PageHeader";
import { keys, refresh } from "./queryKeys";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";
import { RecordPage } from "./RecordPage";
import { recordStatus, useIdParam } from "./recordStatus";
import { Alert } from "./Alert";
import { Badge } from "./Badge";
import { ResponsiveTable } from "./ResponsiveTable";
import { outcomeTone } from "./badgeClass";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  type CandidateOutcome,
  type GradingCandidate,
  type Promotion,
  type PromotionEligibility,
  bulkPromoteCandidateOutcomes,
  getAllGradingCandidates,
  getGradingSession,
  getPromotionEligibility,
  promoteCandidateOutcome,
  errorMessage,
} from "./api";
import { useAuth } from "./auth";
import { RankBelt } from "./Belt";
import { ConfirmDialog } from "./ConfirmDialog";
import "./PromotionLedger.css";
import { formatShortDate } from "./dates";
import { Button } from "./Button";
import { counted } from "./plural";
import { CandidateRanks } from "./RankTransition";

type PromotionRowItem = {
  candidate: GradingCandidate;
  outcome?: CandidateOutcome;
  promotion?: Promotion;
  eligibility?: PromotionEligibility;
  isEligible: boolean;
  isPromoted: boolean;
};

export function PromotionLedgerScreen(): React.ReactElement {
  const id = useIdParam();
  // The queries wait for a real id; 0 is never sent.
  const sessionId = id ?? 0;
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  const [isBatchSummaryOpen, setIsBatchSummaryOpen] = useState(false);
  const [singlePromoteCandidate, setSinglePromoteCandidate] = useState<PromotionRowItem | null>(null);
  const [singlePromoteNotes, setSinglePromoteNotes] = useState("");
  const [actionFeedback, setActionFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const canPromote = Boolean(currentUser?.can_promote_student);

  // Queries
  const sessionQuery = useQuery({
    queryKey: keys.gradingSessions.detail(sessionId),
    queryFn: () => getGradingSession(sessionId),
    enabled: id !== null,
  });
  const session = sessionQuery.data;
  const isLoadingSession = sessionQuery.isLoading;

  const candidatesQuery = useQuery({
    queryKey: keys.gradingCandidates.session(sessionId),
    queryFn: () => getAllGradingCandidates({ session: sessionId }),
    enabled: id !== null,
  });

  const eligibilityQuery = useQuery({
    queryKey: keys.promotionEligibility(sessionId),
    queryFn: () => getPromotionEligibility(sessionId),
    enabled: id !== null,
  });

  const ledgerQueries = [candidatesQuery, eligibilityQuery];
  // The ledger needs both answers (the roster carries each candidate's outcome
  // and promotion); a missing or failed one must not read
  // as "nothing promoted yet".
  const ledgerFailed = ledgerQueries.some((query) => query.isError);
  const ledgerLoaded = ledgerQueries.every((query) => query.isSuccess);
  const candidatesData = ledgerLoaded ? candidatesQuery.data : undefined;
  const eligibilityData = ledgerLoaded ? eligibilityQuery.data : undefined;

  const eligibilityMap = useMemo(
    () => new Map(eligibilityData?.map((item) => [item.candidate, item])),
    [eligibilityData],
  );

  // Enriched rows
  const rows = useMemo<PromotionRowItem[]>(() => {
    if (!candidatesData?.results) return [];

    return candidatesData.results.map((candidate) => {
      const outcome = candidate.outcome ?? undefined;
      const promotion = candidate.promotion ?? undefined;
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
  }, [candidatesData, eligibilityMap]);

  // Eligible cohort
  const eligibleCohort = useMemo(() => rows.filter((r) => r.isEligible), [rows]);

  // Single promote mutation
  const singlePromoteMutation = useMutation({
    mutationFn: async ({ outcomeId, notes }: { outcomeId: number; notes?: string }) => {
      return promoteCandidateOutcome(outcomeId, { notes });
    },
    onSuccess: (promotion) => {
      refresh.afterPromotion(queryClient, sessionId);
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
        message: errorMessage(err, "Failed to promote candidate."),
      });
    },
  });

  // Bulk promote mutation
  const bulkPromoteMutation = useMutation({
    mutationFn: async (outcomes: number[]) => {
      return bulkPromoteCandidateOutcomes({ outcomes });
    },
    onSuccess: (res) => {
      refresh.afterPromotion(queryClient, sessionId);
      setIsBatchSummaryOpen(false);

      const failures = Object.entries(res.errors);
      if (failures.length > 0) {
        // Errors are keyed by the outcome each row sent; name each candidate
        // and say why, so the admin knows whom to look at rather than only
        // how many.
        const nameFor = (outcomeId: string) =>
          rows.find((r) => String(r.outcome?.id) === outcomeId)?.candidate.student_display_name ?? "A candidate";
        const details = failures
          .map(([outcomeId, reasons]) => `${nameFor(outcomeId)}: ${reasons.join(" ")}`)
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
        message: errorMessage(err, "Could not promote the selected candidates."),
      });
    },
  });

  function handleConfirmBulkPromote() {
    const outcomeIds = eligibleCohort.map((r) => r.outcome?.id).filter((id): id is number => typeof id === "number");

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
    <Alert
      tone={actionFeedback.type === "error" ? "error" : "success"}
      className="pl-alert"
      onDismiss={() => setActionFeedback(null)}
    >
      {actionFeedback.message}
    </Alert>
  );

  const isLoading = isLoadingSession || (!ledgerLoaded && !ledgerFailed);

  // A link to a session that is not there says so; the ledger's own
  // loading and failures show inside the page below.
  if (recordStatus(id, sessionQuery) === "missing") {
    return (
      <RecordPage
        back={{ to: "/gradings", label: "Gradings" }}
        label="Promotion Ledger"
        missing="Grading session not found"
        status="missing"
      />
    );
  }

  return (
    <section aria-labelledby="pl-title" className="page" data-testid="promotion-ledger-screen">
      <PageHeader
        back={{ to: `/gradings/${sessionId}`, label: session?.title || "Session" }}
        title={session ? `${session.title} — Promotion Ledger` : "Promotion Ledger"}
        titleId="pl-title"
        subtitle="Review the candidates who passed, check their new ranks, and promote them. Every promotion is dated the grading day."
      />

      {/* Authority Disclaimer if user lacks permission */}
      {!canPromote && (
        <Alert tone="warning" title="Promotion authority needed" className="pl-alert">
          You can review this ledger, but promoting students needs promotion authority, which an administrator can
          grant.
        </Alert>
      )}

      {!(isBatchSummaryOpen && eligibleCohort.length > 0) && !singlePromoteCandidate && feedbackBanner}

      {/* Top Cohort Promotion Summary Card */}
      <section className="action-row pl-summary-card" aria-label="Cohort Promotion Summary">
        <div className="stack stack--1">
          <span className="pl-summary-count item-title">
            {counted(eligibleCohort.length, "Candidate", "Candidates")} Finalised with Pass · Eligible for Promotion
          </span>
          {eligibleCohort.length === 0 && rows.some((r) => r.isPromoted) && (
            <span className="meta">All qualified candidates in this cohort have already been promoted.</span>
          )}
        </div>

        <Button
          variant="primary"
          onClick={() => {
            setActionFeedback(null);
            setIsBatchSummaryOpen(true);
          }}
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
        <Alert
          action={
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
          }
        >
          The promotion ledger could not be loaded, so no one can be promoted from it yet.
        </Alert>
      ) : isLoading ? (
        <LoadingState>Loading candidate promotion ledger…</LoadingState>
      ) : rows.length === 0 ? (
        <EmptyState framed title="No candidates registered in this grading session." />
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
                <div className="row row--3">
                  <span className="mark pl-candidate-avatar" aria-hidden="true">
                    {row.candidate.student_display_name.charAt(0)}
                  </span>
                  <div className="pl-candidate-meta">
                    <span className="item-title">{row.candidate.student_display_name}</span>
                    {/* The rank held at registration, snapshotted on the candidate -
                        never the student's live rank, which moves on once promoted. */}
                    <span className="meta">({row.candidate.from_rank_name})</span>
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
                  <span>{row.candidate.from_rank_name}</span>
                </div>
              ),
            },
            {
              key: "outcome",
              header: "Outcome",
              render: (row) => {
                const outcome = row.outcome;
                if (outcome?.status === "FINALISED") {
                  const result = outcome.final_outcome;
                  if (result)
                    return (
                      <Badge tone={outcomeTone(result)}>
                        {outcome.final_outcome_display} ({outcome.status_display})
                      </Badge>
                    );
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
                      <span className="meta">Effective {formatShortDate(row.promotion.effective_date)}</span>
                    )}
                  </div>
                ) : row.isEligible ? (
                  <Badge tone="warning">Eligible for {row.candidate.testing_for_rank_name}</Badge>
                ) : (
                  <span className="meta">{row.eligibility?.reason || "Eligibility unavailable"}</span>
                ),
            },
            {
              key: "actions",
              header: "Actions",
              actions: true,
              render: (row) =>
                row.isPromoted ? (
                  <span className="pl-action-complete item-title" aria-label="Promotion completed">
                    Promoted ✓
                  </span>
                ) : row.isEligible ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setActionFeedback(null);
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
        <ConfirmDialog
          title="Promotion summary"
          confirmLabel="Confirm promotions"
          pendingLabel="Promoting cohort…"
          pending={bulkPromoteMutation.isPending}
          confirmDisabled={!canPromote}
          startOnCancel
          onClose={() => setIsBatchSummaryOpen(false)}
          onConfirm={handleConfirmBulkPromote}
        >
          {feedbackBanner}
          <p className="pl-batch-count meta">{eligibleCohort.length} Candidates Selected</p>
          <ol className="row row--wrap list-plain">
            {eligibleCohort.map((r, i) => (
              <li key={r.candidate.id} className="pl-batch-chip">
                <span className="pl-chip-num item-title">{i + 1}.</span>
                <span className="pl-chip-name">{r.candidate.student_display_name}</span>
                <CandidateRanks candidate={r.candidate} spoken="promoted to" />
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
              <dd>{currentUser?.full_name || currentUser?.first_name || "Authorised Master"}</dd>
            </div>
          </dl>
        </ConfirmDialog>
      )}

      {singlePromoteCandidate && (
        <ConfirmDialog
          title="Confirm Student Promotion"
          confirmLabel={`Promote to ${singlePromoteCandidate.candidate.testing_for_rank_name}`}
          pendingLabel="Recording promotion…"
          pending={singlePromoteMutation.isPending}
          confirmDisabled={!canPromote}
          startOnCancel
          onClose={() => setSinglePromoteCandidate(null)}
          onConfirm={handleConfirmSinglePromote}
        >
          {feedbackBanner}
          <div className="pl-modal-candidate-info">
            <span className="pl-modal-name section-title">{singlePromoteCandidate.candidate.student_display_name}</span>
            <p className="row row--wrap pl-modal-ranks">
              <CandidateRanks
                candidate={singlePromoteCandidate.candidate}
                fromLabel="Current"
                toLabel="Conferring"
                spoken="promoted to"
              />
            </p>
            <p className="pl-modal-date-notice meta">
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
        </ConfirmDialog>
      )}
    </section>
  );
}
