import { useMutation, useQueryClient } from "@tanstack/react-query";

import { bulkLinkLegacyRecords, bulkUnlinkLegacyRecords } from "./api";

/**
 * Linking historical records to a student, and undoing it, as the results
 * page and the linking page both do, each all or nothing. Either way the lists
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
    // All or nothing on the server: a refusal unlinks none of them.
    mutationFn: (records: number[]) => bulkUnlinkLegacyRecords(records),
    onSettled: refresh,
  });
  return { link, undo, refresh };
}
