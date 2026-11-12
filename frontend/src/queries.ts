import { useQuery } from "@tanstack/react-query";
import { keys } from "./queryKeys";

import { setClubTimeZone } from "./dates";
import {
  getAbout,
  getAboutDocument,
  getAgeBands,
  getAllCandidateAssessmentItems,
  getAssessmentSummary,
  getChoices,
  getCredits,
  getPledge,
  getRanks,
  getSiteSettings,
  LARGEST_PAGE,
} from "./api";

export function useRanksQuery() {
  return useQuery({ queryKey: keys.ranks(), queryFn: () => getRanks({ page_size: LARGEST_PAGE }) });
}

// The club's time zone is applied as the settings arrive, before anything
// that shows a time renders from them (dates.ts).
export function useSiteSettingsQuery() {
  return useQuery({
    queryKey: keys.siteSettings(),
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

// Every list of choices the screens offer, with their names. They change only
// with a release, so one read serves the whole visit. The shell waits for it
// (App.tsx); a failed read leaves the lists empty, and mounting another
// consumer must not restart it, or the shell would fall back to loading.
export function useChoicesQuery() {
  return useQuery({ queryKey: keys.choices(), queryFn: getChoices, staleTime: Infinity, retryOnMount: false });
}

export function useAboutQuery() {
  return useQuery({ queryKey: keys.about(), queryFn: getAbout });
}

export function useAboutDocumentQuery(slug: string) {
  return useQuery({ queryKey: keys.aboutDocument(slug), queryFn: () => getAboutDocument(slug) });
}

export function usePledgeQuery() {
  return useQuery({ queryKey: keys.pledge(), queryFn: getPledge });
}

export function useCreditsQuery() {
  return useQuery({ queryKey: keys.credits(), queryFn: getCredits });
}

export function useAgeBandsQuery() {
  return useQuery({ queryKey: keys.ageBands(), queryFn: getAgeBands });
}

// One key per assessment, so every screen and a scoring PATCH share the cache.
export function useAssessmentSummaryQuery(assessmentId: number | undefined) {
  return useQuery({
    queryKey: keys.candidateAssessmentSummary(assessmentId),
    queryFn: () => getAssessmentSummary(assessmentId!),
    enabled: assessmentId !== undefined,
  });
}

export function useAssessmentItemsQuery(assessmentId: number | undefined) {
  return useQuery({
    queryKey: keys.candidateAssessmentItems(assessmentId),
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
