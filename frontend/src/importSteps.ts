import type { DataImportBatch, DataImportKind } from "./api";

/** The five steps every import runs through, named for its kind (FDR-050). */
export function importStepNames(kind: DataImportKind): string[] {
  return kind === "STUDENT_ROSTER"
    ? ["Choose file", "Match columns", "Review rows", "Confirm", "Results"]
    : ["Choose file", "Match ranks", "Review records", "Confirm", "Results"];
}

/** Where an unfinished import is up to, as a step index (0-4). */
export function importStepIndex(batch: DataImportBatch): number {
  if (batch.status !== "UPLOADED") return 4;
  if (batch.kind === "STUDENT_ROSTER" && batch.next_step === "MATCH_COLUMNS") return 1;
  return batch.kind === "STUDENT_ROSTER" ? 2 : 1;
}

export function importKindTitle(kind: DataImportKind): string {
  return kind === "STUDENT_ROSTER" ? "Import students" : "Import past gradings";
}
