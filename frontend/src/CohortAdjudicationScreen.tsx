/**
 * Master final decision - Cohort Adjudication Board (SCR-028, FDR-044).
 *
 * Replaces SCR-022's per-candidate slide-over. A locked session's cohort is a
 * decision queue: each row carries the served evidence counts, the
 * instructor's proposal and an inline Pass / Conditional / Fail; a detail pane
 * holds the row in focus. Decisions are staged first, then written one
 * candidate at a time, and every row succeeds or fails on its own (FDR-028) -
 * nothing here is all-or-nothing, and failures stay staged for a retry.
 *
 * One deliberate deviation from the board: the detail pane lists **every**
 * recorded `assessor_notes` value, not only shortfalls (see
 * `SealedAssessmentEvidence`, which the proposal drawer shares).
 *
 * Counts are served (each assessment's `overall`, FDR-046), never
 * recounted. Whether the viewer may decide comes from `/api/auth/me/`
 * (`can_make_final_grading_decision`); the server enforces it regardless.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  type CandidateAssessment,
  type CandidateOutcome,
  type CandidateOutcomeOutcome,
  type GradingCandidate,
  finaliseCandidateOutcome,
  getAllCandidateAssessments,
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
import { SealedAssessmentEvidence } from "./SealedAssessmentEvidence";

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

function outcomeClass(outcome: CandidateOutcomeOutcome | null | undefined): string {
  if (outcome === "PASS") return "cab-pill cab-pill-pass";
  if (outcome === "FAIL") return "cab-pill cab-pill-fail";
  return "cab-pill cab-pill-conditional";
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
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);

  // Recording unmounts or disables the control that started it, so focus
  // moves to the outcome message rather than dropping to the page.
  useEffect(() => {
    if (lastResult) resultRef.current?.focus();
  }, [lastResult]);

  const enabled = !Number.isNaN(sessionId) && sessionId > 0;

  const sessionQuery = useQuery({
    queryKey: ["gradingSessions", "detail", sessionId],
    queryFn: () => getGradingSession(sessionId),
    enabled,
  });
  const candidatesQuery = useQuery({
    queryKey: ["gradingCandidates", sessionId],
    queryFn: () => getAllGradingCandidates({ session: sessionId }),
    enabled,
  });
  const assessmentsQuery = useQuery({
    queryKey: ["candidateAssessments", sessionId],
    queryFn: () => getAllCandidateAssessments({ session: sessionId }),
    enabled,
  });
  const outcomesQuery = useQuery({
    queryKey: ["candidateOutcomes", sessionId],
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
  const withdrawnCount =
    (candidatesQuery.data?.results ?? []).length - rows.length;
  const finalisedCount = rows.filter((row) => row.outcome?.status === "FINALISED").length;

  const focusRow =
    rows.find((row) => row.candidate.id === focusId) ??
    rows.find((row) => row.decidable) ??
    rows[0];

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

  async function record(outcomeIds: number[]) {
    if (outcomeIds.length === 0 || outcomeIds.some((oid) => missingRequirements(staged[oid]))) {
      return;
    }
    setIsRecording(true);
    setLastResult(null);
    const failed: Record<number, string> = {};
    let recorded = 0;
    // One candidate at a time: each row stands or falls on its own.
    for (const outcomeId of outcomeIds) {
      const decision = staged[outcomeId];
      try {
        await finaliseCandidateOutcome(outcomeId, {
          final_outcome: decision.outcome,
          decision_notes: decision.notes.trim(),
          conditional_requirements:
            decision.outcome === "CONDITIONAL" ? decision.conditionalRequirements.trim() : "",
        });
        recorded += 1;
      } catch (err) {
        failed[outcomeId] = err instanceof ApiError ? err.message : "The decision could not be recorded.";
      }
    }
    setStaged((current) => {
      const next = { ...current };
      outcomeIds.forEach((oid) => {
        if (!(oid in failed)) delete next[oid];
      });
      return next;
    });
    setFailures((current) => {
      const next = { ...current };
      outcomeIds.forEach((oid) => delete next[oid]);
      return { ...next, ...failed };
    });
    const failedCount = Object.keys(failed).length;
    setLastResult(
      failedCount === 0
        ? `${recorded} ${recorded === 1 ? "decision" : "decisions"} recorded.`
        : `${recorded} recorded, ${failedCount} could not be recorded and ${failedCount === 1 ? "remains" : "remain"} staged.`,
    );
    setIsRecording(false);
    await queryClient.invalidateQueries({ queryKey: ["candidateOutcomes", sessionId] });
  }

  const failedIds = Object.keys(failures).map(Number).filter((oid) => oid in staged);

  if (
    sessionQuery.isLoading ||
    candidatesQuery.isLoading ||
    assessmentsQuery.isLoading ||
    outcomesQuery.isLoading
  ) {
    return (
      <section aria-label="Final decisions" className="cab-page">
        <div className="cab-state" role="status">Loading final decisions…</div>
      </section>
    );
  }

  if (!session) {
    return (
      <section aria-label="Final decisions" className="cab-page">
        <div className="cab-state" role="alert">This grading session could not be loaded.</div>
      </section>
    );
  }

  const focusDecision = focusRow?.outcome ? staged[focusRow.outcome.id] : undefined;

  return (
    <section aria-labelledby="cab-title" className="cab-page">
      <header className="cab-topbar">
        <Link to={`/gradings/${session.id}`} className="cab-back">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M20 12H5M10 7l-5 5 5 5" />
          </svg>
          Back to session
        </Link>
        <div className="cab-heading">
          <h1 id="cab-title">Final decisions · {session.title}</h1>
          <p>
            {session.status_display} · {formatSessionDate(session.grading_date)}
            {session.location ? ` · ${session.location}` : ""}
          </p>
        </div>
        <p className="cab-progress" role="status">
          <strong>{finalisedCount}</strong> / {rows.length} finalised
        </p>
      </header>

      {session.status !== "LOCKED" && (
        <p className="cab-notice" role="status">
          {session.status === "COMPLETED"
            ? "This session is completed. Its decisions are the permanent record."
            : "Final decisions open once the session is locked, after every assessment is completed."}
        </p>
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

      <div className="cab-layout">
        <div className="cab-queue">
          <table className="cab-table">
            <thead>
              <tr>
                <th scope="col">Candidate</th>
                <th scope="col">Evidence</th>
                <th scope="col">Proposal</th>
                <th scope="col">Decision</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const outcome = row.outcome;
                const overall = row.assessment?.overall;
                const decision = outcome ? staged[outcome.id] : undefined;
                const isFocused = focusRow?.candidate.id === row.candidate.id;
                const failure = outcome ? failures[outcome.id] : undefined;
                return (
                  <tr
                    key={row.candidate.id}
                    className={`cab-row${isFocused ? " cab-row-focused" : ""}`}
                    data-testid={`cab-row-${row.candidate.id}`}
                  >
                    <td>
                      <button
                        type="button"
                        className="cab-row-name"
                        onClick={() => {
                          setFocusId(row.candidate.id);
                          // Below this width the detail pane sits under the
                          // queue, so a tap would otherwise change nothing
                          // on screen.
                          if (window.matchMedia("(max-width: 64rem)").matches) {
                            requestAnimationFrame(() => detailHeadingRef.current?.focus());
                          }
                        }}
                        aria-pressed={isFocused}
                      >
                        {row.candidate.student_display_name}
                      </button>
                      <span className="cab-row-sub">
                        {row.candidate.student_wksa_id} · {row.candidate.from_rank_name} →{" "}
                        {row.candidate.testing_for_rank_name}
                      </span>
                    </td>
                    <td data-label="Evidence">
                      {overall ? (
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
                      )}
                    </td>
                    <td data-label="Proposal">
                      {outcome?.proposed_outcome ? (
                        <span className={outcomeClass(outcome.proposed_outcome)}>
                          {outcome.proposed_outcome_display}
                        </span>
                      ) : (
                        <span className="cab-flags">Awaiting proposal</span>
                      )}
                    </td>
                    <td data-label="Decision">
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
                              disabled={isRecording}
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
                        <p className="cab-row-error" role="alert">{failure}</p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="cab-state">No candidates to decide in this session.</p>}
        </div>

        {focusRow && (
          <aside className="cab-detail" aria-labelledby="cab-focus-title" data-testid="cab-detail">
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
                    <span className={outcomeClass(focusRow.outcome.proposed_outcome)}>
                      {focusRow.outcome.proposed_outcome_display}
                    </span>{" "}
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
                  <span className={outcomeClass(focusRow.outcome.final_outcome)}>
                    {focusRow.outcome.final_outcome_display}
                  </span>{" "}
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
                  <label className="outcome-field">
                    Re-test requirements (required)
                    <textarea
                      value={focusDecision.conditionalRequirements}
                      onChange={(e) =>
                        updateStaged(focusRow.outcome!.id, { conditionalRequirements: e.target.value })
                      }
                      disabled={isRecording}
                      rows={3}
                    />
                  </label>
                )}
                <label className="outcome-field">
                  Decision notes
                  <textarea
                    value={focusDecision.notes}
                    onChange={(e) => updateStaged(focusRow.outcome!.id, { notes: e.target.value })}
                    disabled={isRecording}
                    rows={3}
                  />
                </label>
                <button
                  type="button"
                  className="btn-secondary cab-record-one"
                  disabled={isRecording || missingRequirements(focusDecision)}
                  onClick={() => record([focusRow.outcome!.id])}
                >
                  Record decision for {focusRow.candidate.student_display_name.split(" ")[0]}
                </button>
              </section>
            )}
          </aside>
        )}
      </div>

      {canDecide && (
        <footer className="cab-bar">
          <p className="cab-bar-text">
            Staged decisions are written one candidate at a time. Each row succeeds or fails on its
            own, and failures stay staged for a retry.
          </p>
          {incomplete.length > 0 && (
            <p className="cab-row-error" role="alert">
              Conditional decisions need re-test requirements before they can be recorded.
            </p>
          )}
          {lastResult && (
            <p className="cab-bar-result" role="status" ref={resultRef} tabIndex={-1}>
              {lastResult}
            </p>
          )}
          {failedIds.length > 0 && (
            <button
              type="button"
              className="btn-secondary"
              disabled={isRecording}
              onClick={() => record(failedIds)}
            >
              Retry {failedIds.length} failed
            </button>
          )}
          <button
            type="button"
            className="btn-primary cab-record-all"
            disabled={isRecording || stagedIds.length === 0 || incomplete.length > 0}
            onClick={() => record(stagedIds)}
            data-testid="cab-record-staged"
          >
            {isRecording
              ? "Recording…"
              : stagedIds.length === 0
                ? "No decisions staged"
                : `Record ${stagedIds.length} staged ${stagedIds.length === 1 ? "decision" : "decisions"}`}
          </button>
        </footer>
      )}
    </section>
  );
}
