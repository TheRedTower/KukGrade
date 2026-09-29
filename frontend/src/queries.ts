import { useQuery } from "@tanstack/react-query";

import { getAgeBands, getRanks, getSiteSettings } from "./api";

export function useRanksQuery() {
  return useQuery({ queryKey: ["ranks"], queryFn: () => getRanks({ page_size: 100 }) });
}

export function useSiteSettingsQuery() {
  return useQuery({ queryKey: ["siteSettings"], queryFn: getSiteSettings });
}

export function useAgeBandsQuery() {
  return useQuery({ queryKey: ["ageBands"], queryFn: getAgeBands });
}
