import { useQuery } from "@tanstack/react-query";

import { setClubTimeZone } from "./dates";
import {
  getAbout,
  getAboutDocument,
  getAgeBands,
  getAllCandidateAssessmentItems,
  getAssessmentSummary,
  getCredits,
  getPledge,
  getRanks,
  getSiteSettings,
} from "./api";

export function useRanksQuery() {
  return useQuery({ queryKey: ["ranks"], queryFn: () => getRanks({ page_size: 100 }) });
}

// The club's time zone is applied as the settings arrive, before anything
// that shows a time renders from them (dates.ts).
export function useSiteSettingsQuery() {
  return useQuery({
    queryKey: ["siteSettings"],
    // A failed first load falls back to the browser's clock. Mounting another
    // consumer must not repeatedly restart that failed request.
    retryOnMount: false,
    queryFn: async () => {
      const site = await getSiteSettings();
      setClubTimeZone(site.time_zone);
      return site;
    },
  });
}

export function useAboutQuery() {
  return useQuery({ queryKey: ["about"], queryFn: getAbout });
}

export function useAboutDocumentQuery(slug: string) {
  return useQuery({ queryKey: ["aboutDocument", slug], queryFn: () => getAboutDocument(slug) });
}

export function usePledgeQuery() {
  return useQuery({ queryKey: ["pledge"], queryFn: getPledge });
}

export function useCreditsQuery() {
  return useQuery({ queryKey: ["credits"], queryFn: getCredits });
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
 * evidence that failed or is still on its way. True when there is no
 * assessment to load.
 */
export function useSealedEvidenceLoaded(assessmentId: number | undefined): boolean {
  const summary = useAssessmentSummaryQuery(assessmentId);
  const items = useAssessmentItemsQuery(assessmentId);
  return assessmentId === undefined || (summary.isSuccess && items.isSuccess);
}
