import type { DataImportBatch, DataImportKind, DataImportRow } from "./api";
import { agreeing, counted } from "./plural";

// Everything that differs between the kinds of import, in one place, so a
// screen asks the kind rather than testing which one it is, and a new kind
// cannot be added without saying each of these.

type Summary = DataImportBatch["summary_json"];
type Found = { ok: boolean; title: string; detail: string };
type Guide = { lead: string; fields: { name: string; hint: string; needed: boolean }[]; foot: string; optional: string };
type Tab = { key: "all" | "READY" | "SKIP_EXISTING" | "EXCLUDED" | "corrected"; label: string; count?: number };

export type ImportKind = {
  title: string;
  /** What the file is matched on before review. */
  match: "columns" | "ranks";
  /** The file is read as one sheet of rows: the sheet can be chosen, and the row limit applies. */
  oneSheet: boolean;
  /** Each row becomes a student, so a template, row edits and a link to the student follow. */
  addsStudents: boolean;
  guide: Guide;
  /** The start screen's first line, before a file is chosen. */
  chooseLead: string;
  /** Refusing a file of the wrong type, given the types in a phrase. */
  wrongType: (types: string) => string;
  /** The kind's own lines of what KukGrade found in the file. */
  found: (batch: DataImportBatch) => Found[];
  alreadyImported: string;
  /** The rows of an opened import, under its file name. */
  fileCounts: (batch: DataImportBatch) => string;
  /** An unfinished import's rows so far, in a line. */
  unfinished: (batch: DataImportBatch) => string;
  /** What a finished import saved, in a line. */
  finished: (summary: Summary) => string;
  /** A row's person as the file names them. */
  rowName: (row: DataImportRow) => string;
  /** Where in the file a row came from. */
  where: (row: DataImportRow) => string;
  /** A row named in a sentence: leaving it out or bringing it back. */
  called: (row: DataImportRow) => string;
  /** A row under review, in a line: what it holds, as KukGrade will save it. */
  reviewDetail: (row: DataImportRow) => string;
  seal: {
    title: (count: number) => string;
    action: (count: number) => string;
    pending: string;
    line: (batch: DataImportBatch, unresolvedRanks: number) => (string | null)[];
    confirmTitle: (count: number) => string;
    confirmBody: string;
  };
  results: {
    headline: (summary: Summary) => string;
    banner: (summary: Summary) => (string | null)[];
  };
  ledger: {
    heading: string;
    search: string;
    whereHeader: string;
    stateHeader: string;
    /** Where in the file a saved row came from, under whereHeader. */
    place: (row: DataImportRow) => string | number;
    tabs: (summary: Summary, outcome: (value: "SKIP_EXISTING" | "EXCLUDED") => string) => Tab[];
    /** A saved row in a line. */
    detail: (row: DataImportRow, batch: DataImportBatch) => string;
    /** A saved row's state, once leaving out and skipping are ruled out. */
    saved: (row: DataImportRow) => string;
  };
};

const leftOut = (count: number | undefined, what: [string, string]) =>
  count ? `${counted(count, ...what)} you left out ${agreeing(count, "was", "were")} not imported.` : null;

export const importKinds: Record<DataImportKind, ImportKind> = {
  STUDENT_ROSTER: {
    title: "Import students",
    match: "columns",
    oneSheet: true,
    addsStudents: true,
    guide: {
      lead:
        "One student per row, with a heading on each column. The headings do not need to match: you pair them up next.",
      fields: [
        { name: "WKSA ID", hint: "Such as 123-4-567, or A-12345 for a black belt", needed: true },
        { name: "First name", hint: "", needed: true },
        { name: "Last name", hint: "", needed: true },
        { name: "Date of birth", hint: "Such as 14/03/2015", needed: true },
        { name: "Rank", hint: "Can be set once for the whole file", needed: true },
        { name: "Status", hint: "Active, Inactive or Left. Active if not given", needed: false },
      ],
      foot:
        "Anything missing can be typed in before importing, and any other column can be kept as extra information on the student.",
      optional: "Optional",
    },
    chooseLead: "A spreadsheet of students, one per row. Nothing is saved until the last step.",
    wrongType: (types) => `Choose a file saved as ${types}.`,
    found: (batch) => [
      {
        ok: batch.row_counts.total > 0,
        title: counted(batch.row_counts.total, "row of students", "rows of students"),
        detail: batch.sheet ? `Read from the sheet “${batch.sheet}”. Blank rows are left out.` : "Blank rows are left out.",
      },
      {
        ok: true,
        title: counted(batch.detected_headers.length, "column", "columns"),
        detail: "You match them to KukGrade in the next step.",
      },
    ],
    alreadyImported: "Anyone already in KukGrade is skipped, so nobody is added twice.",
    fileCounts: (batch) => `${batch.row_counts.total} rows`,
    unfinished: (batch) => {
      const counts = batch.row_counts;
      if (batch.next_step === "MATCH") return `${counted(counts.total, "row", "rows")} read · columns still to match`;
      return [
        `${counts.ready} ready`,
        counts.review_required ? `${counts.review_required} need attention` : null,
        counts.skip_existing ? `${counts.skip_existing} already in KukGrade` : null,
        counts.excluded ? `${counts.excluded} left out` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    },
    finished: (summary) => {
      const parts = [counted(summary.created ?? 0, "student added", "students added")];
      if (summary.skipped_existing) parts.push(`${summary.skipped_existing} already here`);
      return parts.join(" · ");
    },
    rowName: (row) => [row.values.first_name, row.values.last_name].filter(Boolean).join(" ") || "(no name)",
    where: (row) => `Row ${row.row_number}`,
    called: (row) => `row ${row.row_number}`,
    reviewDetail: (row) =>
      [row.values.wksa_id, row.values.current_rank, row.values.date_of_birth].filter(Boolean).join(" · "),
    seal: {
      title: (count) => `Everything is sorted · ready to add ${counted(count, "student", "students")}`,
      action: (count) => `Add ${counted(count, "student", "students")}`,
      pending: "Adding…",
      line: (batch) => {
        const counts = batch.row_counts;
        return [
          counts.skip_existing
            ? `${counts.skip_existing} already in KukGrade ${agreeing(counts.skip_existing, "is", "are")} skipped`
            : null,
          counts.excluded ? `${counts.excluded} you left out` : null,
          batch.extra_columns.length
            ? `${batch.extra_columns.map((column) => `“${column}”`).join(", ")} kept as extra information`
            : null,
          "all are added together, or none are",
        ];
      },
      confirmTitle: (count) => `Add ${counted(count, "student", "students")} to KukGrade?`,
      confirmBody:
        "They are saved together, so either all are added or none are. You can edit or remove any of them afterwards.",
    },
    results: {
      headline: (summary) => `${counted(summary.created ?? 0, "student", "students")} added`,
      banner: (summary) => [
        summary.skipped_existing
          ? `${counted(summary.skipped_existing, "student", "students")} already in KukGrade ${agreeing(summary.skipped_existing, "was", "were")} skipped and not changed.`
          : null,
        leftOut(summary.excluded, ["row", "rows"]),
      ],
    },
    ledger: {
      heading: "Every row",
      search: "Name or WKSA ID",
      whereHeader: "Row",
      stateHeader: "What happened",
      place: (row) => row.row_number,
      tabs: (summary, outcome) => [
        { key: "all", label: "All rows", count: summary.total },
        { key: "READY", label: "Added", count: summary.created },
        { key: "SKIP_EXISTING", label: outcome("SKIP_EXISTING"), count: summary.skipped_existing },
        { key: "EXCLUDED", label: outcome("EXCLUDED"), count: summary.excluded },
        { key: "corrected", label: "Your fixes" },
      ],
      detail: (row, batch) => {
        const names = row.corrected_fields.map(
          (field) => batch.target_fields.find((target) => target.field === field)?.name ?? field,
        );
        const fixes = names.length ? `your fix: ${names.join(", ")}` : "";
        return [row.values.wksa_id, row.values.current_rank, fixes].filter(Boolean).join(" · ");
      },
      saved: (row) => (row.corrected_fields.length ? "Added, your fix" : "Added"),
    },
  },
  LEGACY_GRADINGS: {
    title: "Import past gradings",
    match: "ranks",
    oneSheet: false,
    addsStudents: false,
    guide: {
      lead: "The grading record workbook, one sheet per grading. In Google Sheets, use File, Download, Microsoft Excel.",
      fields: [
        { name: "Name", hint: "As written in the sheet, often a first name only", needed: true },
        { name: "Outcome", hint: "Pass, Fail, Conditional or Did not attend", needed: false },
        { name: "Rank held", hint: "Such as Yellow Belt or DBN", needed: false },
        { name: "Rank tested for", hint: "A “?” is kept as doubtful", needed: false },
        { name: "Comments", hint: "Kept in full as the grading report", needed: false },
      ],
      foot: "Side tables such as Did not attend, and notes anywhere on a sheet, are kept too.",
      optional: "If present",
    },
    chooseLead:
      "The grading record workbook, downloaded from Google Sheets as Excel. Nothing is saved until the last step.",
    wrongType: (types) => `Choose the workbook saved as ${types}.`,
    found: (batch) => [
      {
        ok: batch.grading_sheets.length > 0,
        title: counted(batch.grading_sheets.length, "grading sheet", "grading sheets"),
        detail: batch.grading_sheets.length
          ? `Each sheet holds one grading: ${batch.grading_sheets.join(", ")}.`
          : "No sheet named for a grading was found.",
      },
      {
        ok: batch.row_counts.total > 0,
        title: counted(batch.row_counts.total, "record", "records"),
        detail: "Including side tables such as Did not attend, and sheet notes.",
      },
      ...batch.warnings.map((warning) => ({ ok: false, title: "Something was left out", detail: warning })),
    ],
    alreadyImported: "Its records would be imported a second time. Check before you go on.",
    fileCounts: (batch) => `${batch.grading_sheets.length} grading sheets, ${batch.row_counts.total} records`,
    unfinished: (batch) => `${counted(batch.row_counts.total, "record", "records")} found`,
    finished: (summary) => counted(summary.total ?? 0, "record", "records"),
    rowName: (row) => row.values.name || "(no name)",
    where: (row) => row.source_locator.replaceAll("!", " · "),
    called: (row) => `the record for ${row.values.name || "(no name)"}`,
    reviewDetail: (row) => {
      const values = row.values;
      const ranks = [values.current_rank, values.testing_for_rank].filter(Boolean).join(" → ");
      const words = values.report || values.note;
      return [ranks, values.outcome, words ? `“${words}”` : ""].filter(Boolean).join(" · ");
    },
    seal: {
      title: (count) => `Ready to import ${counted(count, "historical record", "historical records")}`,
      action: (count) => `Import ${counted(count, "record", "records")}`,
      pending: "Importing…",
      line: (batch, unresolvedRanks) => [
        batch.row_counts.excluded ? `${batch.row_counts.excluded} you left out` : null,
        unresolvedRanks ? `${counted(unresolvedRanks, "rank", "ranks")} not matched stay as written` : null,
        "next, KukGrade suggests who each record belongs to",
      ],
      confirmTitle: (count) => `Import ${counted(count, "historical record", "historical records")}?`,
      confirmBody: "They are saved together, exactly as the workbook has them. Next you link them to students.",
    },
    results: {
      headline: (summary) => `${counted(summary.total ?? 0, "historical record", "historical records")} imported`,
      banner: (summary) => [leftOut(summary.excluded, ["record", "records"])],
    },
    ledger: {
      heading: "Every record",
      search: "Name or comment",
      whereHeader: "Sheet · row",
      stateHeader: "Now",
      place: (row) => row.source_locator.replaceAll("!", " · "),
      tabs: (summary, outcome) => [
        { key: "all", label: "All records" },
        { key: "READY", label: "Imported", count: summary.total },
        { key: "EXCLUDED", label: outcome("EXCLUDED"), count: summary.excluded },
      ],
      detail: (row) => {
        const values = row.values;
        if (values.note && !values.current_rank && !values.testing_for_rank) return `“${values.note}”`;
        const ranks = [values.current_rank, values.testing_for_rank].filter(Boolean).join(" → ");
        return [ranks, values.outcome].filter(Boolean).join(" · ") || values.report || "";
      },
      saved: () => "Imported",
    },
  },
};
