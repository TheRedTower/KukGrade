import type {
  CandidateAssessment,
  CandidateOutcome,
  CandidateOutcomeOutcome,
  GradingCandidateRoster,
  StagedDecision as ApiStagedDecision,
} from "./api";

/** A decision on its way to being recorded: staged on the board, and kept on the server. */
export type StagedDecision = {
  outcome: CandidateOutcomeOutcome;
  notes: string;
  conditionalRequirements: string;
};

/** A candidate with their assessment and outcome, and whether the Master may decide now. */
export type BoardRow = {
  candidate: GradingCandidateRoster;
  assessment?: CandidateAssessment;
  outcome?: CandidateOutcome;
  decidable: boolean;
};

export function fromServer(rows: ApiStagedDecision[]): Record<number, StagedDecision> {
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

export function without<T>(map: Record<number, T>, key: number): Record<number, T> {
  const next = { ...map };
  delete next[key];
  return next;
}

export function missingRequirements(decision: StagedDecision): boolean {
  return decision.outcome === "CONDITIONAL" && !decision.conditionalRequirements.trim();
}

/** The board's rows: every candidate still in the session, open for decision once the server says so. */
export function buildRows(candidates: GradingCandidateRoster[]): BoardRow[] {
  return candidates.map((candidate) => ({
    candidate,
    assessment: candidate.assessment ?? undefined,
    outcome: candidate.outcome ?? undefined,
    decidable: candidate.can_be_finalised,
  }));
}
