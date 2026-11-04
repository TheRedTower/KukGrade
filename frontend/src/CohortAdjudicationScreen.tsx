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
import { EmptyState } from "./EmptyState";
import { keys } from "./queryKeys";
import { PageHeader } from "./PageHeader";
import { Alert } from "./Alert";
import { LoadingState } from "./LoadingState";
import { ErrorText } from "./ErrorText";
import { Badge } from "./Badge";
import { ResponsiveTable } from "./ResponsiveTable";
import { outcomeTone } from "./badgeClass";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isAnonymousResponse,
  errorMessage,
  type CandidateAssessment,
  type CandidateOutcome,
  type CandidateOutcomeOutcome,
  type GradingCandidate,
  discardStagedDecision,
  finaliseCandidateOutcome,
  getAllCandidateAssessments,
  getStagedDecisions,
  stageDecision,
  type StagedDecision as ApiStagedDecision,
  getAllCandidateOutcomes,
  getAllGradingCandidates,
  getGradingSession,
} from "./api";
import { useAuth } from "./auth";
import { formatSessionDate, formatTime } from "./dates";
import { RankBelt } from "./Belt";
import "./CandidateAssessment.css";
import "./CohortAdjudication.css";
import { CheckIcon } from "./Icons";
import { OUTCOME_CHOICES } from "./OutcomeControls";
import { useSealedEvidenceLoaded } from "./queries";
import { SealedAssessmentEvidence } from "./SealedAssessmentEvidence";
import { Button } from "./Button";

type StagedDecision = {
  outcome: CandidateOutcomeOutcome;
  notes: string;
  conditionalRequirements: string;
};

type BoardRow = {
  candidate: GradingCandidate;
  assessment?: CandidateAssessment;
  outcome?: CandidateOutcome;
  decidable: boolean;
};

// How long typing settles before a staged decision is kept on the server.
const KEEP_DELAY_MS = 600;

function fromServer(rows: ApiStagedDecision[]): Record<number, StagedDecision> {
  return Object.fromEntries(
    rows.map((row) => [
      row.outcome,
      {
        outcome: row.final_outcome,
        notes: row.decision_notes ?? "",
        conditionalRequirements: row.conditional_requirements ?? "",
      },
    ]),
  );
}

function without<T>(map: Record<number, T>, key: number): Record<number, T> {
  const next = { ...map };
  delete next[key];
  return next;
}

function missingRequirements(decision: StagedDecision): boolean {
  return decision.outcome === "CONDITIONAL" && !decision.conditionalRequirements.trim();
}

export function CohortAdjudicationScreen() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [staged, setStaged] = useState<Record<number, StagedDecision>>({});
  const [focusId, setFocusId] = useState<number | null>(() => {
    const requested = Number(searchParams.get("candidate"));
    return Number.isNaN(requested) || requested <= 0 ? null : requested;
  });
  const [isRecording, setIsRecording] = useState(false);
  const [failures, setFailures] = useState<Record<number, string>>({});
  const [lastResult, setLastResult] = useState<string | null>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  // What the server holds for each staged row, so only changes are sent.
  // What the server has acknowledged for each staged row, what the screen
  // wants it to hold once typing settles, and the one write in flight per row.
  const keptOnServer = useRef<Record<number, string> | null>(null);
  const wanted = useRef<Record<number, string>>({});
  const saving = useRef<Record<number, Promise<void>>>({});
  const [restored, setRestored] = useState<ApiStagedDecision[] | null>(null);
  const [keepFailures, setKeepFailures] = useState<Record<number, string>>({});
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);

  // Recording unmounts or disables the control that started it, so focus
  // moves to the outcome message rather than dropping to the page.
  useEffect(() => {
    if (lastResult) resultRef.current?.focus();
  }, [lastResult]);

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
  const assessmentsQuery = useQuery({
    queryKey: keys.candidateAssessments.session(sessionId),
    queryFn: () => getAllCandidateAssessments({ session: sessionId }),
    enabled,
  });
  const outcomesQuery = useQuery({
    queryKey: keys.candidateOutcomes.session(sessionId),
    queryFn: () => getAllCandidateOutcomes({ session: sessionId }),
    enabled,
  });

  const session = sessionQuery.data;
  const assessmentByCandidate = new Map(
    (assessmentsQuery.data?.results ?? []).map((a) => [a.candidate, a]),
  );
  const outcomeByCandidate = new Map(
    (outcomesQuery.data?.results ?? []).map((o) => [o.candidate, o]),
  );
  const rows: BoardRow[] = (candidatesQuery.data?.results ?? [])
    .filter((candidate) => candidate.status !== "WITHDRAWN")
    .map((candidate) => {
      const assessment = assessmentByCandidate.get(candidate.id);
      const outcome = outcomeByCandidate.get(candidate.id);
      return {
        candidate,
        assessment,
        outcome,
        decidable: outcome?.status === "PROPOSED",
      };
    });

  const canDecide =
    Boolean(user?.can_make_final_grading_decision) && session?.status === "LOCKED";

  // Decisions staged earlier, and kept on the server, come back: a session
  // that timed out, or a closed tab, loses nothing that was staged.
  const keptQuery = useQuery({
    queryKey: keys.stagedDecisions(sessionId),
    queryFn: () => getStagedDecisions(sessionId),
    enabled: enabled && canDecide,
    // Read afresh each time the board opens: never an earlier visit's copy.
    gcTime: 0,
  });
  // Until they are read, nothing can be staged, so none is overwritten.
  if (restored === null && keptQuery.isSuccess && keptQuery.isFetchedAfterMount) {
    setRestored(keptQuery.data);
    setStaged((current) => ({ ...fromServer(keptQuery.data), ...current }));
  }
  const canStage = restored !== null && !isRecording;

  // Each write goes through the mutation cache, so an expired session signs the viewer out.
  const keepMutation = useMutation({
    mutationFn: async ({ outcomeId, decision }: { outcomeId: number; decision: StagedDecision | null }) => {
      if (!decision) return discardStagedDecision(outcomeId);
      await stageDecision(outcomeId, {
        final_outcome: decision.outcome,
        decision_notes: decision.notes,
        conditional_requirements: decision.conditionalRequirements,
      });
    },
  });
  const keep = keepMutation.mutateAsync;

  // Sends a row's wanted state, one write at a time, so the last edit is the
  // last write; a change made meanwhile is sent when the write in flight ends.
  const flush = useCallback(
    function flush(outcomeId: number) {
      const kept = keptOnServer.current;
      if (!kept || outcomeId in saving.current) return;
      const json = wanted.current[outcomeId];
      if (json === kept[outcomeId]) return;
      const decision = json === undefined ? null : (JSON.parse(json) as StagedDecision);
      saving.current[outcomeId] = keep({ outcomeId, decision }).then(
        () => {
          delete saving.current[outcomeId];
          if (json === undefined) delete kept[outcomeId];
          else kept[outcomeId] = json;
          setKeepFailures((current) => without(current, outcomeId));
          flush(outcomeId);
        },
        (err: unknown) => {
          delete saving.current[outcomeId];
          // Changed, recorded or unstaged since: what is wanted now is tried instead.
          if (wanted.current[outcomeId] !== json) return flush(outcomeId);
          setKeepFailures((current) => ({
            ...current,
            [outcomeId]: errorMessage(err, "Your staged decisions could not be kept."),
          }));
        },
      );
    },
    [keep],
  );

  // Every change to what is staged is kept once typing settles. Not while
  // recording: recording removes the server's copy itself.
  useEffect(() => {
    if (restored === null || isRecording) return;
    keptOnServer.current ??= Object.fromEntries(
      Object.entries(fromServer(restored)).map(([outcomeId, decision]) => [outcomeId, JSON.stringify(decision)]),
    );
    const kept = keptOnServer.current;
    const timer = window.setTimeout(() => {
      wanted.current = Object.fromEntries(
        Object.entries(staged).map(([outcomeId, decision]) => [outcomeId, JSON.stringify(decision)]),
      );
      new Set([...Object.keys(staged), ...Object.keys(kept)].map(Number)).forEach(flush);
    }, KEEP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [staged, restored, isRecording, flush]);
  const withdrawnCount =
    (candidatesQuery.data?.results ?? []).length - rows.length;
  const finalisedCount = rows.filter((row) => row.outcome?.status === "FINALISED").length;

  const focusRow =
    rows.find((row) => row.candidate.id === focusId) ??
    rows.find((row) => row.decidable) ??
    rows[0];
  // A single decision is recorded beside its evidence, so not before that
  // evidence has loaded.
  const focusEvidenceLoaded = useSealedEvidenceLoaded(focusRow?.assessment?.id);

  function stage(row: BoardRow, outcome: CandidateOutcomeOutcome) {
    const outcomeId = row.outcome?.id;
    if (outcomeId === undefined) return;
    setFocusId(row.candidate.id);
    setStaged((current) => {
      const next = { ...current };
      if (next[outcomeId]?.outcome === outcome) {
        delete next[outcomeId];
      } else {
        next[outcomeId] = {
          outcome,
          notes: next[outcomeId]?.notes ?? "",
          conditionalRequirements: next[outcomeId]?.conditionalRequirements ?? "",
        };
      }
      return next;
    });
  }

  function updateStaged(outcomeId: number, patch: Partial<StagedDecision>) {
    setStaged((current) =>
      current[outcomeId] ? { ...current, [outcomeId]: { ...current[outcomeId], ...patch } } : current,
    );
  }

  const stagedIds = Object.keys(staged).map(Number);
  const incomplete = stagedIds.filter((outcomeId) => missingRequirements(staged[outcomeId]));

  // Each write goes through the mutation cache, so a session that expired mid-way signs the viewer out.
  const finaliseMutation = useMutation({
    mutationFn: (write: { outcomeId: number; payload: Parameters<typeof finaliseCandidateOutcome>[1] }) =>
      finaliseCandidateOutcome(write.outcomeId, write.payload),
  });

  async function record(outcomeIds: number[]) {
    if (outcomeIds.length === 0 || outcomeIds.some((oid) => missingRequirements(staged[oid]))) {
      return;
    }
    setIsRecording(true);
    setLastResult(null);
    // A save still in flight would otherwise land after its decision is recorded.
    await Promise.allSettled(Object.values(saving.current));
    const failed: Record<number, string> = {};
    const recorded = new Set<number>();
    // One candidate at a time: each row stands or falls on its own.
    for (const outcomeId of outcomeIds) {
      const decision = staged[outcomeId];
      try {
        await finaliseMutation.mutateAsync({
          outcomeId,
          payload: {
            final_outcome: decision.outcome,
            decision_notes: decision.notes.trim(),
            conditional_requirements:
              decision.outcome === "CONDITIONAL" ? decision.conditionalRequirements.trim() : "",
          },
        });
        recorded.add(outcomeId);
      } catch (err) {
        failed[outcomeId] = errorMessage(err, "The decision could not be recorded.");
        // The session has ended: the viewer is signed out, so the rest would only meet the same answer.
        if (isAnonymousResponse(err)) break;
      }
    }
    setStaged((current) => {
      const next = { ...current };
      recorded.forEach((oid) => delete next[oid]);
      return next;
    });
    // Recording removed the server's copies.
    recorded.forEach((oid) => {
      delete keptOnServer.current?.[oid];
      delete wanted.current[oid];
    });
    setKeepFailures((current) => [...recorded].reduce(without, current));
    setFailures((current) => {
      const next = { ...current };
      outcomeIds.forEach((oid) => delete next[oid]);
      return { ...next, ...failed };
    });
    // Rows the session's end stopped short of are still staged, like the failed ones.
    const kept = outcomeIds.length - recorded.size;
    setLastResult(
      kept === 0
        ? `${recorded.size} ${recorded.size === 1 ? "decision" : "decisions"} recorded.`
        : `${recorded.size} recorded, ${kept} could not be recorded and ${kept === 1 ? "remains" : "remain"} staged.`,
    );
    setIsRecording(false);
    await queryClient.invalidateQueries({ queryKey: keys.candidateOutcomes.session(sessionId) });
  }

  const failedIds = Object.keys(failures).map(Number).filter((oid) => oid in staged);

  if (
    sessionQuery.isLoading ||
    candidatesQuery.isLoading ||
    assessmentsQuery.isLoading ||
    outcomesQuery.isLoading
  ) {
    return (
      <section aria-label="Final decisions" className="page cab-page">
        <LoadingState>Loading final decisions…</LoadingState>
      </section>
    );
  }

  // Any of the four requests failing would otherwise render as a real, empty
  // cohort (no rows, or "No assessment" on every row).
  const failedQueries = [sessionQuery, candidatesQuery, assessmentsQuery, outcomesQuery].filter(
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

  const focusDecision = focusRow?.outcome ? staged[focusRow.outcome.id] : undefined;

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
      {canDecide && keptQuery.isError && (
        <Alert
          action={
            <Button variant="secondary" onClick={() => void keptQuery.refetch()}>
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
            <ResponsiveTable
              label="Final decisions"
              rows={rows}
              rowKey={(row) => row.candidate.id}
              rowTestId={(row) => `cab-row-${row.candidate.id}`}
              selected={(row) => focusRow?.candidate.id === row.candidate.id}
              columns={[
                {
                  key: "candidate",
                  header: "Candidate",
                  primary: true,
                  render: (row) => (
                    <>
                      <button
                        type="button"
                        className="cab-row-name"
                        onClick={(event) => {
                          setFocusId(row.candidate.id);
                          // Where the detail pane sits under the queue (the
                          // layout decides, by the page's own width), a tap
                          // would otherwise change nothing on screen.
                          const queue = event.currentTarget.closest(".rtable")?.getBoundingClientRect();
                          requestAnimationFrame(() => {
                            const heading = detailHeadingRef.current;
                            if (!heading || !queue) return;
                            if (heading.getBoundingClientRect().left < queue.right) heading.focus();
                          });
                        }}
                        aria-pressed={focusRow?.candidate.id === row.candidate.id}
                      >
                        {row.candidate.student_display_name}
                      </button>
                      <span className="cab-row-sub">
                        {row.candidate.student_wksa_id} · {row.candidate.from_rank_name} →{" "}
                        {row.candidate.testing_for_rank_name}
                      </span>
                    </>
                  ),
                },
                {
                  key: "evidence",
                  header: "Evidence",
                  render: (row) => {
                    const overall = row.assessment?.overall;
                    return overall ? (
                      <>
                        <span className="cab-counts">
                          {overall.required_met} / {overall.required} met
                        </span>
                        <span className={overall.not_met > 0 ? "cab-flags cab-flags-shortfall" : "cab-flags"}>
                          {overall.not_met > 0 ? `${overall.not_met} not met` : "no shortfalls"}
                        </span>
                      </>
                    ) : (
                      <span className="cab-flags">No assessment</span>
                    );
                  },
                },
                {
                  key: "proposal",
                  header: "Proposal",
                  render: (row) =>
                    row.outcome?.proposed_outcome ? (
                      <Badge tone={outcomeTone(row.outcome.proposed_outcome)}>{row.outcome.proposed_outcome_display}</Badge>
                    ) : (
                      <span className="cab-flags">Awaiting proposal</span>
                    ),
                },
                {
                  key: "decision",
                  header: "Decision",
                  render: (row) => {
                    const outcome = row.outcome;
                    const decision = outcome ? staged[outcome.id] : undefined;
                    const failure = outcome ? failures[outcome.id] : undefined;
                    return (
                      <>
                        {outcome?.status === "FINALISED" ? (
                          <span className="cab-recorded">
                            <CheckIcon size={14} /> Recorded · {outcome.final_outcome_display}
                          </span>
                        ) : row.decidable && canDecide && outcome ? (
                          <div
                            className="outcome-segments"
                            role="group"
                            aria-label={`Final outcome for ${row.candidate.student_display_name}`}
                          >
                            {OUTCOME_CHOICES.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className={`outcome-segment outcome-segment-${option.value.toLowerCase()}`}
                                aria-pressed={decision?.outcome === option.value}
                                disabled={!canStage}
                                onClick={() => stage(row, option.value)}
                              >
                                {decision?.outcome === option.value && <CheckIcon size={14} />}
                                {option.label}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="cab-flags">Not open for decision</span>
                        )}
                        {failure && decision && (
                          <ErrorText field>{failure}</ErrorText>
                        )}
                      </>
                    );
                  },
                },
              ]}
            />
          )}
        </div>

        {focusRow && (
          <aside className="cab-detail split__aside" aria-labelledby="cab-focus-title" data-testid="cab-detail">
            <p className="outcome-eyebrow">In focus</p>
            <h2 id="cab-focus-title" ref={detailHeadingRef} tabIndex={-1}>
              {focusRow.candidate.student_display_name}
            </h2>
            <p className="outcome-rank-line">
              <RankBelt rankId={focusRow.candidate.from_rank} />
              {focusRow.candidate.from_rank_name}
              <span aria-hidden="true">→</span>
              <RankBelt rankId={focusRow.candidate.testing_for_rank} />
              {focusRow.candidate.testing_for_rank_name}
            </p>

            <SealedAssessmentEvidence
              className="cab-detail-section"
              assessmentId={focusRow.assessment?.id}
              sessionId={session.id}
              candidateId={focusRow.candidate.id}
            />

            <section className="cab-detail-section" aria-labelledby="cab-proposal-title">
              <h3 id="cab-proposal-title">Proposal</h3>
              {focusRow.outcome?.proposed_outcome ? (
                <>
                  <p>
                    <Badge tone={outcomeTone(focusRow.outcome.proposed_outcome)}>{focusRow.outcome.proposed_outcome_display}</Badge>{" "}
                    <span className="cab-note-by">
                      {focusRow.outcome.proposed_by_name}
                      {focusRow.outcome.proposed_at ? ` · ${formatTime(focusRow.outcome.proposed_at)}` : ""}
                    </span>
                  </p>
                  {focusRow.outcome.proposal_notes && <p>{focusRow.outcome.proposal_notes}</p>}
                </>
              ) : (
                <p className="cab-flags">No proposal yet.</p>
              )}
            </section>

            {focusRow.outcome?.status === "FINALISED" && (
              <section className="cab-detail-section" aria-labelledby="cab-decision-title">
                <h3 id="cab-decision-title">Final decision</h3>
                <p>
                  <Badge tone={outcomeTone(focusRow.outcome.final_outcome)}>{focusRow.outcome.final_outcome_display}</Badge>{" "}
                  <span className="cab-note-by">
                    {focusRow.outcome.decided_by_name}
                    {focusRow.outcome.decided_at ? ` · ${formatTime(focusRow.outcome.decided_at)}` : ""}
                  </span>
                </p>
                {focusRow.outcome.conditional_requirements && (
                  <p>Re-test: {focusRow.outcome.conditional_requirements}</p>
                )}
                {focusRow.outcome.decision_notes && <p>{focusRow.outcome.decision_notes}</p>}
              </section>
            )}

            {focusDecision && focusRow.outcome && (
              <section className="cab-detail-section" aria-labelledby="cab-staged-title">
                <h3 id="cab-staged-title">Staged: {OUTCOME_CHOICES.find((d) => d.value === focusDecision.outcome)?.label}</h3>
                {focusDecision.outcome === "CONDITIONAL" && (
                  <label className="field field--sentence"><span>Re-test requirements (required)</span>
                    <textarea
                      value={focusDecision.conditionalRequirements}
                      onChange={(e) =>
                        updateStaged(focusRow.outcome!.id, { conditionalRequirements: e.target.value })
                      }
                      disabled={!canStage}
                      rows={3}
                    />
                  </label>
                )}
                <label className="field field--sentence"><span>Decision notes</span>
                  <textarea
                    value={focusDecision.notes}
                    onChange={(e) => updateStaged(focusRow.outcome!.id, { notes: e.target.value })}
                    disabled={!canStage}
                    rows={3}
                  />
                </label>
                <Button
                  variant="secondary" className="cab-record-one"
                  disabled={
                    isRecording || missingRequirements(focusDecision) || !focusEvidenceLoaded
                  }
                  onClick={() => record([focusRow.outcome!.id])}
                >
                  Record decision for {focusRow.candidate.student_display_name.split(" ")[0]}
                </Button>
              </section>
            )}
          </aside>
        )}
      </div>

      {canDecide && (
        <footer className="cab-bar">
          <p className="cab-bar-text">
            Decisions are recorded one candidate at a time. Any that cannot be recorded stay here to try again; the rest are kept.
            What you stage is saved for you until it is recorded, even if you are signed out.
          </p>
          {Object.keys(keepFailures).length > 0 && (
            <ErrorText field>
              {Object.values(keepFailures)[0]} {Object.keys(keepFailures).length === 1 ? "That decision is" : "Those decisions are"} still
              here, but will be lost if you leave this page.
            </ErrorText>
          )}
          {incomplete.length > 0 && (
            <ErrorText field>
              Conditional decisions need re-test requirements before they can be recorded.
            </ErrorText>
          )}
          {lastResult && (
            <p className="cab-bar-result" role="status" ref={resultRef} tabIndex={-1}>
              {lastResult}
            </p>
          )}
          {failedIds.length > 0 && (
            <Button
              variant="secondary"
              disabled={isRecording}
              onClick={() => record(failedIds)}
            >
              Retry {failedIds.length} failed
            </Button>
          )}
          <Button
            variant="primary" className="cab-record-all"
            disabled={isRecording || stagedIds.length === 0 || incomplete.length > 0}
            onClick={() => record(stagedIds)}
            data-testid="cab-record-staged"
          >
            {isRecording
              ? "Recording…"
              : stagedIds.length === 0
                ? "No decisions staged"
                : `Record ${stagedIds.length} staged ${stagedIds.length === 1 ? "decision" : "decisions"}`}
          </Button>
        </footer>
      )}
    </section>
  );
}
