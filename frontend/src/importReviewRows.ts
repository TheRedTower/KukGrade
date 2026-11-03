import { useMutation } from "@tanstack/react-query";
import { type DataImportBatch, type DataImportKind, type DataImportRow, setDataImportRowExcluded } from "./api";
import { usePagedRows } from "./useImportRows";
import { importRowName } from "./importSteps";

export const PAGE_SIZE = 20;

export const STATUSES = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "LEFT", label: "Left" },
];

export type RowParams = Parameters<typeof usePagedRows>[1];

export type Tile<View extends string> = { key: View; label: string; count: number; tone: string; mark: string };

export type Exclusion = ReturnType<typeof useRowExclusion>;

export function where(row: DataImportRow, kind: DataImportKind): string {
  return kind === "STUDENT_ROSTER" ? `Row ${row.row_number}` : row.source_locator.replaceAll("!", " · ");
}

/** A row in a line: what it holds, as KukGrade will save it. */
export function rowDetail(row: DataImportRow, kind: DataImportKind): string {
  const values = row.values;
  if (kind === "STUDENT_ROSTER") return [values.wksa_id, values.current_rank, values.date_of_birth].filter(Boolean).join(" · ");
  const ranks = [values.current_rank, values.testing_for_rank].filter(Boolean).join(" → ");
  const words = values.report || values.note;
  return [ranks, values.outcome, words ? `“${words}”` : ""].filter(Boolean).join(" · ");
}

/** Leaving a row out or bringing it back, said aloud once done. */
export function rowCalled(row: DataImportRow, kind: DataImportKind): string {
  return kind === "STUDENT_ROSTER" ? `row ${row.row_number}` : `the record for ${importRowName(row, kind)}`;
}

export function useRowExclusion(batch: DataImportBatch, onRefresh: () => Promise<void>, announce: (text: string) => void) {
  return useMutation({
    mutationFn: ({ row, excluded }: { row: DataImportRow; excluded: boolean }) =>
      setDataImportRowExcluded(batch.id, row.row_number, excluded),
    onSuccess: async (_changed, { row, excluded }) => {
      const what = rowCalled(row, batch.kind);
      announce(`${what.charAt(0).toUpperCase()}${what.slice(1)} is ${excluded ? "left out" : "back in"}.`);
      await onRefresh();
    },
  });
}
