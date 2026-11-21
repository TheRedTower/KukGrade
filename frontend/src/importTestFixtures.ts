import type {
  DataImportBatch,
  DataImportRow,
  HistoricalPersonDetail,
  LegacyGradingRecord,
  LegacyGradingRecordDetail,
  Rank,
} from "./api";

// Invented data for the import screens' tests.

export function batch(overrides: Partial<DataImportBatch> = {}): DataImportBatch {
  return {
    id: 7,
    kind: "STUDENT_ROSTER",
    kind_display: "Students",
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
    review_step: "REVIEW",
    detected_headers: ["WKSA No", "First", "Surname", "DOB", "Belt", "Parent phone", "Joined"],
    column_mapping: {},
    defaults: {},
    extra_columns: [],
    sheet: "Members",
    sheet_names: ["Members"],
    sheet_error: "",
    suggested_mapping: {},
    uncovered_fields: [],
    target_fields: [
      { field: "wksa_id", name: "WKSA ID", needed: true, whole_file: false },
      { field: "first_name", name: "First name", needed: true, whole_file: false },
      { field: "last_name", name: "Last name", needed: true, whole_file: false },
      { field: "date_of_birth", name: "Date of birth", needed: true, whole_file: false },
      { field: "current_rank", name: "Rank", needed: true, whole_file: true },
      { field: "status", name: "Status", needed: false, whole_file: true },
    ],
    grading_sheets: [],
    warnings: [],
    row_counts: { total: 212, ready: 198, review_required: 9, skip_existing: 5, excluded: 0, sheet_left_out: 0 },
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

export function person(overrides: Partial<HistoricalPersonDetail> = {}): HistoricalPersonDetail {
  return {
    id: 201,
    name: "Mia Reyes",
    spellings: ["Mia R", "Mia Reyes"],
    state: "PROPOSED",
    state_display: "Proposed",
    queue: "READY",
    queue_display: "Ready to confirm",
    confidence: "HIGH",
    confidence_display: "Sure these are one person",
    reasons: ["Passed to Blue stripe, then held it on the next sheet"],
    record_count: 2,
    first_period: "2025-03",
    last_period: "2025-09",
    awaiting_confirmation: 0,
    decisions: ["LINK", "NOT_A_STUDENT", "LATER"],
    student: null,
    student_name: null,
    suggestion: "clear",
    candidates: [
      {
        student: 31,
        full_name: "Mia Reyes",
        wksa_id: "104-2-311",
        current_rank_name: "Blue stripe",
        status_display: "Active",
        score: 10,
        reasons: ["Same first name", "Rank fits: Blue stripe now, Blue stripe then"],
      },
    ],
    version: 4,
    not_a_student_reason: "",
    not_a_student_reason_display: "",
    note: "",
    decided_by_name: "",
    decided_at: null,
    records: [
      legacyRecord({ id: 101, source_name: "Mia R", cycle_month: 3, source_testing_for_rank_text: "Blue stripe" }),
      legacyRecord({ id: 102, source_name: "Mia Reyes", cycle_month: 9, source_current_rank_text: "Blue stripe" }),
    ],
    ...overrides,
  };
}

export function legacyRecord(overrides: Partial<LegacyGradingRecord> = {}): LegacyGradingRecord {
  return {
    id: 101,
    person: 201,
    student: null,
    student_display_name: null,
    record_kind: "GRADING_RESULT",
    record_kind_display: "Grading result",
    cycle_year: 2025,
    cycle_month: 3,
    source_section: "",
    source_name: "Mia R",
    source_current_rank_text: "White Belt",
    current_rank: 1,
    current_rank_code: "WHITE",
    current_rank_name: "White",
    source_testing_for_rank_text: "Yellow stripe",
    testing_for_rank: 2,
    testing_for_rank_name: "Yellow stripe",
    outcome_display: "Recommended: Pass",
    attendance_status_display: "Attended",
    report: "Ki Cho Hyung 1 clean.",
    note: "",
    is_void: false,
    void_reason: "",
    voided_by_name: "",
    ...overrides,
  };
}

/** A record as its own page reads it: with its workbook's key. */
export function legacyRecordPage(overrides: Partial<LegacyGradingRecordDetail> = {}): LegacyGradingRecordDetail {
  return { ...legacyRecord(overrides), workbook_key: [], ...overrides };
}

export const RANKS: Rank[] = [
  "White",
  "Yellow stripe",
  "Yellow",
  "Blue stripe",
  "Blue",
  "Red stripe",
  "Red",
  "Brown stripe",
].map((name, index) => ({
  id: index + 1,
  code: name.toUpperCase().replace(" ", "_"),
  name,
  order: index + 1,
  belt_colour: "WHITE",
  stripe_colour: "",
  stripe_count: 0,
  next_rank: index + 2,
  has_syllabus: true,
}));
