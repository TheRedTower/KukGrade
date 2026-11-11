import { Badge } from "./Badge";
import { buttonClass } from "./buttonClass";
import { ErrorText } from "./ErrorText";
import { type BoardRow, type StagedDecision } from "./adjudicationBoard";
import { outcomeTone } from "./badgeClass";
import { CheckIcon } from "./Icons";
import { useChoices } from "./choices";
import "./OutcomeControls.css";
import { ResponsiveTable } from "./ResponsiveTable";
import type { CandidateOutcomeOutcome } from "./api";
import { CandidateRanks } from "./RankTransition";

interface CohortDecisionQueueProps {
  rows: BoardRow[];
  /** The row in focus. */
  focusId: number | undefined;
  staged: Record<number, StagedDecision>;
  failures: Record<number, string>;
  canDecide: boolean;
  canStage: boolean;
  onFocus: (candidateId: number, button: HTMLElement) => void;
  onStage: (row: BoardRow, outcome: CandidateOutcomeOutcome) => void;
}

/** The cohort as a decision queue: evidence, proposal, and an inline Pass / Conditional / Fail. */
export function CohortDecisionQueue({ rows, focusId, staged, failures, canDecide, canStage, onFocus, onStage }: CohortDecisionQueueProps) {
  const outcomes = useChoices().outcomes;
  return (
            <ResponsiveTable
              label="Final decisions"
              rows={rows}
              rowKey={(row) => row.candidate.id}
              rowTestId={(row) => `cab-row-${row.candidate.id}`}
              selected={(row) => focusId === row.candidate.id}
              columns={[
                {
                  key: "candidate",
                  header: "Candidate",
                  primary: true,
                  render: (row) => (
                    <>
                      <button
                        type="button"
                        className="cab-row-name item-title"
                        onClick={(event) => {
                          onFocus(row.candidate.id, event.currentTarget);
                        }}
                        aria-pressed={focusId === row.candidate.id}
                      >
                        {row.candidate.student_display_name}
                      </button>
                      <span className="cab-row-sub meta">
                        {row.candidate.student_wksa_id} · <CandidateRanks candidate={row.candidate} />
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
                        <span className="cab-counts item-title">
                          {overall.required_met} / {overall.required} met
                        </span>
                        <span className={overall.not_met > 0 ? "cab-flags meta cab-flags-shortfall item-title" : "cab-flags meta"}>
                          {overall.not_met > 0 ? `${overall.not_met} not met` : "no shortfalls"}
                        </span>
                      </>
                    ) : (
                      <span className="cab-flags meta">No assessment</span>
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
                      <span className="cab-flags meta">Awaiting proposal</span>
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
                          <span className="row row--inline row--1 meta">
                            <CheckIcon size={14} /> Recorded · {outcome.final_outcome_display}
                          </span>
                        ) : row.decidable && canDecide && outcome ? (
                          <div
                            className="outcome-segments"
                            role="group"
                            aria-label={`Final outcome for ${row.candidate.student_display_name}`}
                          >
                            {outcomes.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className={buttonClass({ small: true }, "outcome-segment")}
                                aria-pressed={decision?.outcome === option.value}
                                data-tone={decision?.outcome === option.value ? outcomeTone(option.value) : undefined}
                                disabled={!canStage}
                                onClick={() => onStage(row, option.value)}
                              >
                                {decision?.outcome === option.value && <CheckIcon size={14} />}
                                {option.label}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="cab-flags meta">Not open for decision</span>
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
  );
}
