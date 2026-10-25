import { useMutation, useQueryClient } from "@tanstack/react-query";

import { bulkLinkLegacyRecords, unlinkLegacyGradingRecord } from "./api";

export class PartialUnlinkError extends Error {
  constructor(readonly unlinkedIds: number[]) {
    super(unlinkedIds.length
      ? "Some records were unlinked. Try Undo again for the rest."
      : "Those records could not be unlinked.");
  }
}

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
    mutationFn: (links: Parameters<typeof bulkLinkLegacyRecords>[0]) => bulkLinkLegacyRecords(links),
    onSuccess: refresh,
  });
  const undo = useMutation({
    mutationFn: async (records: number[]) => {
      const results = await Promise.allSettled(records.map((id) => unlinkLegacyGradingRecord(id)));
      const unlinkedIds = records.filter((_, index) => results[index].status === "fulfilled");
      if (unlinkedIds.length !== records.length) throw new PartialUnlinkError(unlinkedIds);
      return unlinkedIds;
    },
    onSettled: refresh,
  });
  return { link, undo, refresh };
}
