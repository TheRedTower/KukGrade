import { useMutation, useQueryClient } from "@tanstack/react-query";

import { bulkLinkLegacyRecords, unlinkLegacyGradingRecord } from "./api";

/**
 * Linking historical records to a student, and undoing it, as the results
 * page and the linking page both do (FDR-054, FDR-059). Either way the lists
 * of records and names are read again.
 */
export function useLegacyLinking() {
  const queryClient = useQueryClient();

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["legacyRecords"] }),
      queryClient.invalidateQueries({ queryKey: ["legacyPeople"] }),
    ]);
  }

  const link = useMutation({
    mutationFn: (links: { record: number; student: number }[]) => bulkLinkLegacyRecords(links),
    onSuccess: refresh,
  });
  const undo = useMutation({
    mutationFn: (records: number[]) => Promise.all(records.map((id) => unlinkLegacyGradingRecord(id))),
    onSuccess: refresh,
  });
  return { link, undo, refresh };
}
