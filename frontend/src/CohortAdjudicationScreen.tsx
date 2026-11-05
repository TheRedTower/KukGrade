/**
 * Master final decision - Cohort Adjudication Board.
 *
 * A locked session's cohort is a
 * decision queue: each row carries the served evidence counts, the
 * instructor's proposal and an inline Pass / Conditional / Fail; a detail pane
 * holds the row in focus. Decisions are staged first, then written one
 * candidate at a time, and every row succeeds or fails on its own -
 * nothing here is all-or-nothing, and failures stay staged for a retry.
 *
 * One deliberate deviation from the board: the detail pane lists **every**
 * recorded `assessor_notes` value, not only shortfalls (see
 * `SealedAssessmentEvidence`, which the proposal drawer shares).
 *
 * Counts are served (each assessment's `overall`), never
 * recounted. Whether the viewer may decide comes from `/api/auth/me/`
 * (`can_make_final_grading_decision`); the server enforces it regardless.
 */
import { useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "./EmptyState";
import { keys } from "./queryKeys";
import { PageHeader } from "./PageHeader";
import { Alert } from "./Alert";
import { LoadingState } from "./LoadingState";
import { Button } from "./Button";
import { getAllGradingCandidates, getGradingSession } from "./api";
import { buildRows } from "./adjudicationBoard";
import { useAuth } from "./auth";
import { formatSessionDate } from "./dates";
import "./CandidateAssessment.css";
import "./CohortAdjudication.css";
import { CohortDecisionQueue } from "./CohortDecisionQueue";
import { CohortFocusPane } from "./CohortFocusPane";
import { CohortRecordBar } from "./CohortRecordBar";
import { useSealedEvidenceLoaded } from "./queries";
import { useStagedDecisions } from "./useStagedDecisions";

export function CohortAdjudicationScreen() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const [focusId, setFocusId] = useState<number | null>(() => {
    const requested = Number(searchParams.get("candidate"));
    return Number.isNaN(requested) || requested <= 0 ? null : requested;
  });
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);

  const enabled = !Number.isNaN(sessionId) && sessionId > 0;

  const sessionQuery = useQuery({
    queryKey: keys.gradingSessions.detail(sessionId),
    queryFn: () => getGradingSession(sessionId),
    enabled,
  });
  const candidatesQuery = useQuery({
    queryKey: keys.gradingCandidates.session(sessionId),
    queryFn: () => getAllGradingCandidates({ session: sessionId }),
    enabled,
  });

  const session = sessionQuery.data;
  const rows = buildRows(candidatesQuery.data?.results ?? []);
  const canDecide = Boolean(user?.can_make_final_grading_decision) && session?.status === "LOCKED";

  const decisions = useStagedDecisions({ sessionId, enabled, canDecide, onFocus: setFocusId });

  const withdrawnCount = (candidatesQuery.data?.results ?? []).length - rows.length;
  const finalisedCount = rows.filter((row) => row.outcome?.status === "FINALISED").length;

  const focusRow = rows.find((row) => row.candidate.id === focusId) ?? rows.find((row) => row.decidable) ?? rows[0];
  // A single decision is recorded beside its evidence, so not before that
  // evidence has loaded.
  const focusEvidenceLoaded = useSealedEvidenceLoaded(focusRow?.assessment?.id);

  // Where the detail pane sits under the queue (the layout decides, by the
  // page's own width), a tap on a name would otherwise change nothing on screen.
  const focusRowFromQueue = (candidateId: number, button: HTMLElement) => {
    setFocusId(candidateId);
    const queue = button.closest(".rtable")?.getBoundingClientRect();
    requestAnimationFrame(() => {
      const heading = detailHeadingRef.current;
      if (!heading || !queue) return;
      if (heading.getBoundingClientRect().left < queue.right) heading.focus();
    });
  };

  if (sessionQuery.isLoading || candidatesQuery.isLoading) {
    return (
      <section aria-label="Final decisions" className="page cab-page">
        <LoadingState>Loading final decisions…</LoadingState>
      </section>
    );
  }

  // Either request failing would otherwise render as a real, empty cohort (no
  // rows, or "No assessment" on every row).
  const failedQueries = [sessionQuery, candidatesQuery].filter(
    (query) => query.isError,
  );
  if (!session || failedQueries.length > 0) {
    return (
      <section aria-label="Final decisions" className="page cab-page">
        <Alert
          action={
            failedQueries.length > 0 ? (
              <Button variant="secondary" onClick={() => failedQueries.forEach((query) => void query.refetch())}>
                Try again
              </Button>
            ) : undefined
          }
        >
          The final decisions could not be loaded.
        </Alert>
      </section>
    );
  }

  return (
    <section aria-labelledby="cab-title" className="page cab-page">
      <PageHeader
        back={{ to: `/gradings/${session.id}`, label: "Back to session" }}
        title={`Final decisions · ${session.title}`}
        titleId="cab-title"
        subtitle={`${session.status_display} · ${formatSessionDate(session.grading_date)}${session.location ? ` · ${session.location}` : ""}`}
        actions={
          <p className="cab-progress" role="status">
            <strong>{finalisedCount}</strong> / {rows.length} finalised
          </p>
        }
      />

      {session.status !== "LOCKED" && (
        <p className="cab-notice" role="status">
          {session.status === "COMPLETED"
            ? "This session is completed. Its decisions are the permanent record."
            : "Final decisions open once the session is locked, after every assessment is completed."}
        </p>
      )}
      {canDecide && decisions.keptQuery.isError && (
        <Alert
          action={
            <Button variant="secondary" onClick={() => void decisions.keptQuery.refetch()}>
              Try again
            </Button>
          }
        >
          Your staged decisions could not be loaded. Staging is paused until they are, so none is overwritten.
        </Alert>
      )}
      {session.status === "LOCKED" && !user?.can_make_final_grading_decision && (
        <p className="cab-notice" role="status">
          Final decisions are made by an authorised Master. You can review the cohort here.
        </p>
      )}
      {withdrawnCount > 0 && (
        <p className="cab-footnote">
          {withdrawnCount} withdrawn {withdrawnCount === 1 ? "candidate is" : "candidates are"} not shown.
        </p>
      )}

      <div className="split">
        <div>
          {rows.length === 0 ? (
            <EmptyState framed title="No candidates to decide in this session." />
          ) : (
            <CohortDecisionQueue
              rows={rows}
              focusId={focusRow?.candidate.id}
              staged={decisions.staged}
              failures={decisions.failures}
              canDecide={canDecide}
              canStage={decisions.canStage}
              onFocus={focusRowFromQueue}
              onStage={decisions.stage}
            />
          )}
        </div>

        {focusRow && (
          <CohortFocusPane
            row={focusRow}
            sessionId={session.id}
            decision={focusRow.outcome ? decisions.staged[focusRow.outcome.id] : undefined}
            canStage={decisions.canStage}
            recording={decisions.isRecording}
            evidenceLoaded={focusEvidenceLoaded}
            headingRef={detailHeadingRef}
            onUpdate={decisions.updateStaged}
            onRecord={decisions.record}
          />
        )}
      </div>

      {canDecide && (
        <CohortRecordBar
          stagedIds={decisions.stagedIds}
          failedIds={decisions.failedIds}
          incomplete={decisions.incomplete}
          keepFailures={decisions.keepFailures}
          lastResult={decisions.lastResult}
          resultRef={decisions.resultRef}
          recording={decisions.isRecording}
          onRecord={decisions.record}
        />
      )}
    </section>
  );
}
