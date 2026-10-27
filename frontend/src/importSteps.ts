import type { DataImportBatch, DataImportKind, DataImportRow } from "./api";

// The wording the import screens share, so a step, a kind of import or a
// row is named the same way everywhere.

/** The five steps every import runs through, named for its kind. */
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

export function importKindLabel(kind: DataImportKind): string {
  return kind === "STUDENT_ROSTER" ? "Students" : "Past gradings";
}

/** A row's person as the file names them. */
export function importRowName(row: DataImportRow, kind: DataImportKind): string {
  const name =
    kind === "STUDENT_ROSTER"
      ? [row.values.first_name, row.values.last_name].filter(Boolean).join(" ")
      : row.values.name;
  return name || "(no name)";
}

/** "1 row", "3 rows". */
export function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
