import { useQuery } from "@tanstack/react-query";

import {
  getAgeBands,
  getAllCandidateAssessmentItems,
  getAssessmentSummary,
  getRanks,
  getSiteSettings,
} from "./api";

export function useRanksQuery() {
  return useQuery({ queryKey: ["ranks"], queryFn: () => getRanks({ page_size: 100 }) });
}

export function useSiteSettingsQuery() {
  return useQuery({ queryKey: ["siteSettings"], queryFn: getSiteSettings });
}

export function useAgeBandsQuery() {
  return useQuery({ queryKey: ["ageBands"], queryFn: getAgeBands });
}

// One key per assessment, so every screen and a scoring PATCH share the cache.
export function useAssessmentSummaryQuery(assessmentId: number | undefined) {
  return useQuery({
    queryKey: ["candidateAssessmentSummary", assessmentId],
    queryFn: () => getAssessmentSummary(assessmentId!),
    enabled: assessmentId !== undefined,
  });
}

export function useAssessmentItemsQuery(assessmentId: number | undefined) {
  return useQuery({
    queryKey: ["candidateAssessmentItems", assessmentId],
    queryFn: () => getAllCandidateAssessmentItems({ assessment: assessmentId }),
    enabled: assessmentId !== undefined,
  });
}

/**
 * Whether the evidence an outcome decision rests on - the assessment's
 * served counts and its items - has loaded. A decision must not be made on
 * evidence that failed or is still on its way (KG-A16). True when there is no
 * assessment to load.
 */
export function useSealedEvidenceLoaded(assessmentId: number | undefined): boolean {
  const summary = useAssessmentSummaryQuery(assessmentId);
  const items = useAssessmentItemsQuery(assessmentId);
  return assessmentId === undefined || (summary.isSuccess && items.isSuccess);
}
