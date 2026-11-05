import type { CandidateAssessmentItemResult } from "./api";

/** An item's mark in running text ("Changed from Met to not assessed"). */
export const RESULT_WORDS: Record<CandidateAssessmentItemResult, string> = {
  MET: "Met",
  NOT_MET: "Not met",
  NOT_ASSESSED: "not assessed",
};
