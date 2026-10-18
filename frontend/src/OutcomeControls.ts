import type { CandidateOutcomeOutcome } from "./api";
import "./OutcomeControls.css";

// The three grading outcomes in the order every outcome control offers them.
export const OUTCOME_CHOICES: { value: CandidateOutcomeOutcome; label: string }[] = [
  { value: "PASS", label: "Pass" },
  { value: "CONDITIONAL", label: "Conditional" },
  { value: "FAIL", label: "Fail" },
];

// The label for each outcome, wherever one is shown on its own.
export const OUTCOME_LABELS: Record<CandidateOutcomeOutcome, string> = Object.fromEntries(
  OUTCOME_CHOICES.map((choice) => [choice.value, choice.label]),
) as Record<CandidateOutcomeOutcome, string>;
