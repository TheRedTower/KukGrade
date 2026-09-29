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
export function assessmentSummaryQuery(assessmentId: number) {
  return {
    queryKey: ["candidateAssessmentSummary", assessmentId],
    queryFn: () => getAssessmentSummary(assessmentId),
  };
}

export function useAssessmentSummaryQuery(assessmentId: number | undefined) {
  return useQuery({
    ...assessmentSummaryQuery(assessmentId ?? 0),
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
