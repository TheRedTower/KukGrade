import type { CandidateOutcomeOutcome } from "./api";
import "./OutcomeControls.css";

// The three grading outcomes in the order every outcome control offers them.
export const OUTCOME_CHOICES: { value: CandidateOutcomeOutcome; label: string }[] = [
  { value: "PASS", label: "Pass" },
  { value: "CONDITIONAL", label: "Conditional" },
  { value: "FAIL", label: "Fail" },
];
