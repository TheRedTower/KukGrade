import { useMutation, useQuery } from "@tanstack/react-query";

import { getHistoricalPeopleSummary, getHistoricalPerson } from "./api";
import { keys } from "./queryKeys";
import { useLegacyRefresh } from "./useLegacyRefresh";

/** One person of the imported history, as their pages read them. */
export function usePerson(id: number | null) {
  return useQuery({
    queryKey: keys.legacyPeople.detail(id ?? 0),
    queryFn: () => getHistoricalPerson(id!),
    enabled: id !== null,
  });
}

/**
 * A decision about a person. Whatever the answer, the people and records are
 * read again: a refusal is most often someone else's change since, and the
 * page then shows the person as they are now.
 */
export function useDecision<Result>(onDone?: (result: Result) => void) {
  const refresh = useLegacyRefresh();
  return useMutation({
    mutationFn: (decide: () => Promise<Result>) => decide(),
    onSuccess: (result) => onDone?.(result),
    onSettled: refresh,
  });
}

/** How many people there are and how many are sorted: every import's, or one's. */
export function usePeopleSummary(batch: number | undefined, enabled = true) {
  return useQuery({
    enabled,
    queryKey: batch ? keys.legacyPeople.summary(batch) : keys.legacyPeople.summary(),
    queryFn: () => getHistoricalPeopleSummary(batch ? { batch } : undefined),
  });
}
