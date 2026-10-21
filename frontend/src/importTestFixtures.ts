import type { DataImportBatch, DataImportRow, LegacyGradingRecord, LegacyPerson, Rank } from "./api";

// Invented data for the import screens' tests.

export function page<T>(results: T[], count = results.length) {
  return { count, next: null, previous: null, results };
}

export function batch(overrides: Partial<DataImportBatch> = {}): DataImportBatch {
  return {
    id: 7,
    kind: "STUDENT_ROSTER",
    kind_display: "Student roster",
    status: "UPLOADED",
    status_display: "Uploaded",
    original_filename: "spring-roster.xlsx",
    file_size: 219_136,
    uploaded_at: "2026-10-20T09:42:00Z",
    uploaded_by_name: "Sam Taylor",
    committed_at: null,
    committed_by_name: "",
    cancelled_at: null,
    next_step: "REVIEW",
    detected_headers: ["WKSA No", "First", "Surname", "DOB", "Belt", "Parent phone", "Joined"],
    column_mapping: {},
    defaults: {},
    extra_columns: [],
    sheet: "Members",
    sheet_names: ["Members"],
    suggested_mapping: {},
    target_fields: [
      { field: "wksa_id", name: "WKSA ID", needed: true, whole_file: false },
      { field: "first_name", name: "First name", needed: true, whole_file: false },
      { field: "last_name", name: "Last name", needed: true, whole_file: false },
      { field: "date_of_birth", name: "Date of birth", needed: true, whole_file: false },
      { field: "current_rank", name: "Rank", needed: true, whole_file: true },
      { field: "status", name: "Status", needed: false, whole_file: true },
    ],
    rank_mappings: {},
    grading_sheets: [],
    warnings: [],
    row_counts: { total: 212, ready: 198, review_required: 9, skip_existing: 5, excluded: 0 },
    summary_json: {},
    ...overrides,
  };
}

export function row(overrides: Partial<DataImportRow> = {}): DataImportRow {
  return {
    row_number: 2,
    source_locator: "R2",
    outcome: "READY",
    outcome_display: "Ready",
    excluded: false,
    values: { wksa_id: "104-2-311", first_name: "Mia", last_name: "Reynolds", current_rank: "Yellow" },
    issues: [],
    issue_fields: [],
    corrected_fields: [],
    extra: {},
    cells: {},
    file_values: {},
    created_id: "31",
    ...overrides,
  };
}

export function person(overrides: Partial<LegacyPerson> = {}): LegacyPerson {
  return {
    source_name: "Mia R",
    group_key: "mia r",
    record_ids: [101, 102, 103],
    records: 3,
    first_period: "2025-03",
    last_period: "2025-09",
    linked_student: null,
    shared: false,
    candidates: [
      {
        student: 31,
        full_name: "Mia Reynolds",
        wksa_id: "104-2-311",
        current_rank_name: "Yellow",
        status_display: "Active",
        score: 10,
        reasons: ["Same first name and initial"],
      },
    ],
    ...overrides,
  };
}

export function legacyRecord(overrides: Partial<LegacyGradingRecord> = {}): LegacyGradingRecord {
  return {
    id: 101,
    student: null,
    student_display_name: null,
    record_kind: "GRADING_RESULT",
    cycle_year: 2025,
    cycle_month: 3,
    source_batch: 7,
    source_section: "",
    source_name: "Mia R",
    source_current_rank_text: "White Belt",
    current_rank: 1,
    current_rank_code: "WHITE",
    current_rank_name: "White",
    source_testing_for_rank_text: "Yellow stripe",
    testing_for_rank: 2,
    testing_for_rank_code: "YELLOW_STRIPE",
    testing_for_rank_name: "Yellow stripe",
    outcome_display: "Pass",
    attendance_status_display: "Attended",
    report: "Ki Cho Hyung 1 clean.",
    note: "",
    is_void: false,
    void_reason: "",
    voided_by_email: null,
    ...overrides,
  };
}

export const RANKS: Rank[] = ["White", "Yellow stripe", "Yellow", "Blue stripe", "Blue", "Red stripe", "Red", "Brown stripe"].map(
  (name, index) => ({
    id: index + 1,
    code: name.toUpperCase().replace(" ", "_"),
    name,
    order: index + 1,
    belt_colour: "WHITE",
    stripe_colour: "",
    stripe_count: 0,
    next_rank: index + 2,
  }),
);
