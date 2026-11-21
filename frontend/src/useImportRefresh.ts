import { useQueryClient } from "@tanstack/react-query";

import { keys } from "./queryKeys";

/** Everything that changes when a sheet is chosen, a row left out or a check decided. */
export function useImportRefresh(batchId: number): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all(
      [
        keys.imports.batch(batchId),
        keys.imports.rows(batchId),
        keys.imports.sheets(batchId),
        keys.imports.checks(batchId),
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  };
}
