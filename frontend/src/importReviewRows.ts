import { useMutation } from "@tanstack/react-query";
import { type DataImportBatch, type DataImportRow, setDataImportRowExcluded } from "./api";
import { usePagedRows } from "./useImportRows";
import { importKinds } from "./importKinds";

export const PAGE_SIZE = 20;

export type RowParams = Parameters<typeof usePagedRows>[1];

export type Tile<View extends string> = { key: View; label: string; count: number; tone: string; mark: string };

export type Exclusion = ReturnType<typeof useRowExclusion>;

export function useRowExclusion(
  batch: DataImportBatch,
  onRefresh: () => Promise<void>,
  announce: (text: string) => void,
) {
  return useMutation({
    mutationFn: ({ row, excluded }: { row: DataImportRow; excluded: boolean }) =>
      setDataImportRowExcluded(batch.id, row.row_number, excluded),
    onSuccess: async (_changed, { row, excluded }) => {
      const what = importKinds[batch.kind].called(row);
      announce(`${what.charAt(0).toUpperCase()}${what.slice(1)} is ${excluded ? "left out" : "back in"}.`);
      await onRefresh();
    },
  });
}
