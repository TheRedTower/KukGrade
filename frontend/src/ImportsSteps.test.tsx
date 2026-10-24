import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type AuthUser, type DataImportBatch, type DataImportRow } from "./api";
import { ADMINISTRATOR_CAPABILITIES, authUser } from "./appTestSupport";
import { ImportScreen } from "./ImportScreen";
import { batch, legacyRecord as record, page, person, RANKS, row } from "./importTestFixtures";
import { LinkRecordsScreen } from "./LinkRecordsScreen";

const api = vi.hoisted(() => ({
  getDataImportBatch: vi.fn(),
  getDataImportBatches: vi.fn(),
  getAllDataImportBatches: vi.fn(),
  getDataImportRows: vi.fn(),
  saveDataImportMapping: vi.fn(),
  correctDataImportRow: vi.fn(),
  setDataImportRowExcluded: vi.fn(),
  leaveOutDataImportRowsNeedingAttention: vi.fn(),
  commitDataImport: vi.fn(),
  previewLegacyGradingImport: vi.fn(),
  getRanks: vi.fn(),
  getStudents: vi.fn(),
  getLegacyGradingRecords: vi.fn(),
  getAllLegacyGradingRecords: vi.fn(),
  getLegacyPeople: vi.fn(),
  getLegacyPeopleSummary: vi.fn(),
  bulkLinkLegacyRecords: vi.fn(),
  unlinkLegacyGradingRecord: vi.fn(),
  resolveLegacyCurrentRank: vi.fn(),
  resolveLegacyTestingForRank: vi.fn(),
  voidLegacyGradingRecord: vi.fn(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  const mocked = Object.fromEntries(
    Object.keys(api).map((name) => [
      name,
      (...args: unknown[]) => api[name as keyof typeof api](...args),
    ]),
  );
  return { ...actual, ...mocked };
});

const auth = vi.hoisted(() => ({ user: null as AuthUser | null }));
vi.mock("./auth", () => ({
  useAuth: () => ({ user: auth.user, status: "authenticated" }),
}));

const MAPPING = {
  wksa_id: "WKSA No",
  first_name: "First",
  last_name: "Surname",
  date_of_birth: "DOB",
};

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ImportScreen />} path="/imports/:id" />
          <Route element={<LinkRecordsScreen />} path="/imports/records" />
          <Route element={<h1>Imports hub</h1>} path="/imports" />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  auth.user = { ...authUser, ...ADMINISTRATOR_CAPABILITIES };
  api.getRanks.mockResolvedValue(page(RANKS));
});

describe("Matching a roster's columns", () => {
  const fresh = batch({ next_step: "MATCH_COLUMNS", suggested_mapping: MAPPING });
  const saved = batch({ next_step: "REVIEW", suggested_mapping: MAPPING, column_mapping: MAPPING });
  const rows = [
    row({
      row_number: 2,
      cells: { "WKSA No": "104-2-311", First: "Mia", Surname: "Reynolds", DOB: "14/03/2015", Belt: "Yellow", "Parent phone": "07700 900123", Joined: "Sep 2021" },
      values: { wksa_id: "104-2-311", first_name: "Mia", last_name: "Reynolds", date_of_birth: "14/03/2015", current_rank: "", status: "ACTIVE" },
      file_values: { date_of_birth: "14/03/2015" },
      outcome: "REVIEW_REQUIRED",
      issues: ["Current rank is required."],
      issue_fields: ["current_rank"],
    }),
    row({
      row_number: 4,
      cells: { "WKSA No": "104-2-318", First: "Priya", Surname: "Shah", DOB: "31/02/2010", Belt: "Red", "Parent phone": "", Joined: "" },
      values: { wksa_id: "104-2-318", first_name: "Priya", last_name: "Shah", date_of_birth: "31/02/2010", current_rank: "", status: "ACTIVE" },
      file_values: { date_of_birth: "31/02/2010" },
      outcome: "REVIEW_REQUIRED",
      issues: ["Date of birth '31/02/2010' could not be parsed."],
      issue_fields: ["date_of_birth", "current_rank"],
    }),
  ];

  it("saves the suggested columns straight away and reads the first rows with them", async () => {
    api.getDataImportBatch.mockResolvedValueOnce(fresh).mockResolvedValue(saved);
    api.saveDataImportMapping.mockResolvedValue(saved);
    api.getDataImportRows.mockResolvedValue(page(rows, 212));

    renderAt("/imports/7");

    expect(await screen.findByRole("heading", { name: "Match your columns" })).toBeInTheDocument();
    await waitFor(() =>
      expect(api.saveDataImportMapping).toHaveBeenCalledWith(7, {
        column_mapping: MAPPING,
        defaults: {},
        extra_columns: [],
      }),
    );
    expect(await screen.findByLabelText("Date of birth, row 4")).toHaveAttribute("aria-invalid", "true");
    expect(await screen.findByLabelText("Date of birth, row 2")).toHaveAttribute("aria-invalid", "false");
    expect(await screen.findAllByText("Needs attention", { selector: ".ix-pill" })).toHaveLength(2);
    expect(screen.getByText("Date of birth '31/02/2010' could not be parsed.")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Match columns");
  });

  it("keeps a field chosen for two columns from being saved, and says why", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(saved);
    api.saveDataImportMapping.mockResolvedValue(saved);
    api.getDataImportRows.mockResolvedValue(page(rows));

    renderAt("/imports/7?step=match");
    await user.selectOptions(await screen.findByLabelText("What “Joined” holds"), "first_name");

    expect(screen.getByText("First name is chosen for two columns.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to review/ })).toBeDisabled();
    expect(api.saveDataImportMapping).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("What “Joined” holds"), "extra");
    await waitFor(() =>
      expect(api.saveDataImportMapping).toHaveBeenCalledWith(7, {
        column_mapping: MAPPING,
        defaults: {},
        extra_columns: ["Joined"],
      }),
    );
  });

  it("offers one rank for everyone, or typing each in, when no column holds it", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(saved);
    api.saveDataImportMapping.mockResolvedValue(saved);
    api.getDataImportRows.mockResolvedValue(page(rows));

    renderAt("/imports/7?step=match");
    expect(await screen.findByText("No column holds rank.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Type each one in" }));
    expect(await screen.findByLabelText("Rank, row 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove this column" }));

    await user.selectOptions(screen.getByLabelText("Same for everyone"), "White");
    await waitFor(() =>
      expect(api.saveDataImportMapping).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ defaults: { current_rank: "White" } }),
      ),
    );
    expect(screen.getByText(/Rank for everyone:/)).toBeInTheDocument();
  });

  it("saves a typed fix when the cell is left, and undoes it", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(saved);
    api.getDataImportRows
      .mockResolvedValueOnce(page(rows))
      .mockResolvedValue(
        page([
          rows[0],
          { ...rows[1], values: { ...rows[1].values, date_of_birth: "13/02/2010" }, corrected_fields: ["date_of_birth"] },
        ]),
      );
    api.correctDataImportRow.mockResolvedValue(rows[1]);

    renderAt("/imports/7?step=match");
    const cell = await screen.findByLabelText("Date of birth, row 4");
    await user.clear(cell);
    await user.type(cell, "13/02/2010{Enter}");

    await waitFor(() =>
      expect(api.correctDataImportRow).toHaveBeenCalledWith(7, 4, { date_of_birth: "13/02/2010" }),
    );
    expect(await screen.findByText(/Your fix · file had “31\/02\/2010”/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo the fix to Date of birth, row 4" }));
    await waitFor(() => expect(api.correctDataImportRow).toHaveBeenLastCalledWith(7, 4, { date_of_birth: null }));
  });

  it("blocks review after a rejected mapping save and retries the visible choices", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(saved);
    api.getDataImportRows.mockResolvedValue(page(rows));
    api.saveDataImportMapping.mockRejectedValueOnce(new Error("Save failed")).mockResolvedValue(saved);

    renderAt("/imports/7?step=match");
    await user.selectOptions(await screen.findByLabelText("What “Joined” holds"), "extra");
    expect(await screen.findByRole("alert")).toHaveTextContent("The columns could not be saved");
    expect(screen.getByRole("button", { name: /Continue to review/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Retry saving columns" }));
    await waitFor(() => expect(api.saveDataImportMapping).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: /Continue to review/ })).toBeEnabled());
    expect(api.saveDataImportMapping).toHaveBeenLastCalledWith(7, {
      column_mapping: MAPPING, defaults: {}, extra_columns: ["Joined"],
    });
  });

  it("serializes a slow mapping save and keeps review closed until acknowledgement", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(saved);
    api.getDataImportRows.mockResolvedValue(page(rows));
    let acknowledge!: (value: DataImportBatch) => void;
    api.saveDataImportMapping.mockImplementation(() => new Promise<DataImportBatch>((resolve) => { acknowledge = resolve; }));

    renderAt("/imports/7?step=match");
    await user.selectOptions(await screen.findByLabelText("What “Joined” holds"), "extra");
    expect(screen.getByLabelText("What “First” holds")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Continue to review/ })).toBeDisabled();
    expect(api.saveDataImportMapping).toHaveBeenCalledTimes(1);
    acknowledge(saved);
    await waitFor(() => expect(screen.getByLabelText("What “First” holds")).toBeEnabled());
    expect(api.saveDataImportMapping).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Continue to review/ })).toBeEnabled();
  });

  it("reopens with the persisted extra-column choice and no duplicate save", async () => {
    api.getDataImportBatch.mockResolvedValue(batch({ ...saved, extra_columns: ["Joined"] }));
    api.getDataImportRows.mockResolvedValue(page(rows));

    renderAt("/imports/7?step=match");
    expect(await screen.findByLabelText("What “Joined” holds")).toHaveValue("extra");
    expect(screen.getByRole("button", { name: /Continue to review/ })).toBeEnabled();
    expect(api.saveDataImportMapping).not.toHaveBeenCalled();
  });

  it("blocks review while a corrected cell is unsaved or saving", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(saved);
    api.getDataImportRows.mockResolvedValue(page(rows));
    let acknowledge!: (value: DataImportRow) => void;
    api.correctDataImportRow.mockImplementation(() => new Promise<DataImportRow>((resolve) => { acknowledge = resolve; }));

    renderAt("/imports/7?step=match");
    const cell = await screen.findByLabelText("Date of birth, row 4");
    await user.clear(cell);
    await user.type(cell, "13/02/2010");
    expect(screen.getByRole("button", { name: /Continue to review/ })).toBeDisabled();
    await user.tab();
    expect(api.correctDataImportRow).toHaveBeenCalledWith(7, 4, { date_of_birth: "13/02/2010" });
    expect(screen.getByRole("button", { name: /Continue to review/ })).toBeDisabled();
    acknowledge(rows[1]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Continue to review/ })).toBeEnabled());
  });
});

describe("Typing into a roster's rows", () => {
  const saved = batch({ next_step: "REVIEW", suggested_mapping: MAPPING, column_mapping: MAPPING });
  const typedIn = row({
    row_number: 2,
    cells: { "WKSA No": "104-2-311", First: "Mia", Surname: "Reynolds", DOB: "14/03/2015" },
    values: { wksa_id: "104-2-311", first_name: "Mia", last_name: "Reynolds", date_of_birth: "14/03/2015", current_rank: "Yellow", status: "ACTIVE" },
    file_values: { date_of_birth: "14/03/2015" },
    corrected_fields: ["current_rank"],
  });

  it("brings back a typed-in column after a reload, with its fixes", async () => {
    api.getDataImportBatch.mockResolvedValue(saved);
    api.getDataImportRows.mockResolvedValue(page([typedIn]));

    renderAt("/imports/7?step=match");

    expect(await screen.findByLabelText("Rank, row 2")).toHaveValue("Yellow");
    expect(screen.queryByText("No column holds rank.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove this column" })).not.toBeInTheDocument();
  });

  it("keeps what was typed when a fix cannot be saved, and says why", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(saved);
    api.getDataImportRows.mockResolvedValue(page([typedIn]));
    api.correctDataImportRow.mockRejectedValue(new Error("offline"));

    renderAt("/imports/7?step=match");
    const cell = await screen.findByLabelText("First name, row 2");
    await user.clear(cell);
    await user.type(cell, "Maya{Enter}");

    expect(await screen.findByText("That fix could not be saved.")).toBeInTheDocument();
    expect(cell).toHaveValue("Maya");
  });
});

describe("Matching a historical workbook's ranks", () => {
  const gradings = batch({ kind: "LEGACY_GRADINGS", original_filename: "grading-record-2025.xlsx", grading_sheets: ["03-2025"], rank_mappings: { "white belt": "WHITE" } });
  const preview = {
    total: 3,
    grading_result: 3,
    auxiliary_note: 0,
    did_not_attend: 0,
    unresolved_current_rank: 1,
    unresolved_testing_for_rank: 0,
    unresolved_outcome: 0,
    excluded: 0,
    warnings: [],
    rank_suggestions: [
      { source_text: "White Belt", suggested_rank_code: "WHITE", doubtful: false, rows: 42 },
      { source_text: "Brn stripe", suggested_rank_code: null, doubtful: false, rows: 2 },
      { source_text: "Blue stripe?", suggested_rank_code: "BLUE_STRIPE", doubtful: true, rows: 3 },
    ],
  };

  it("shows each spelling with the records that use it, and saves a choice for every spelling", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(gradings);
    api.previewLegacyGradingImport.mockResolvedValue(preview);
    api.getDataImportRows.mockResolvedValue(
      page([row({ source_locator: "06-2025!R14", values: { name: "Leo", current_rank: "Red Belt", testing_for_rank: "Brn stripe", outcome: "Pass" } })]),
    );

    renderAt("/imports/7");

    expect(await screen.findByRole("heading", { name: "Match the ranks" })).toBeInTheDocument();
    expect(api.previewLegacyGradingImport).toHaveBeenCalledWith(7, {});
    // The first spelling with no rank yet is the one in focus.
    expect(await screen.findByText("Records using “Brn stripe”")).toBeInTheDocument();
    expect(api.getDataImportRows).toHaveBeenCalledWith(7, { rank_text: "Brn stripe", page_size: 5 });
    expect(await screen.findByText("Red Belt → Brn stripe")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 matched · Continue")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("“Brn stripe” means"), "BROWN_STRIPE");
    await waitFor(() =>
      expect(api.previewLegacyGradingImport).toHaveBeenLastCalledWith(7, {
        rank_mappings: { "White Belt": "WHITE", "Brn stripe": "BROWN_STRIPE", "Blue stripe?": null },
      }),
    );

    await user.click(screen.getByRole("button", { name: /“Blue stripe\?”/ }));
    expect(await screen.findByText(/The workbook marks this with “\?”/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use suggestion: Blue stripe" }));
    await waitFor(() =>
      expect(api.previewLegacyGradingImport).toHaveBeenLastCalledWith(7, {
        rank_mappings: { "White Belt": "WHITE", "Brn stripe": null, "Blue stripe?": "BLUE_STRIPE" },
      }),
    );
  });
});

describe("Reviewing and confirming a roster", () => {
  const needing = batch({
    next_step: "REVIEW",
    column_mapping: { ...MAPPING, current_rank: "Belt" },
    row_counts: { total: 212, ready: 198, review_required: 1, skip_existing: 5, excluded: 0 },
  });
  const sorted = batch({
    ...needing,
    row_counts: { total: 212, ready: 203, review_required: 0, skip_existing: 5, excluded: 4 },
    extra_columns: ["Parent phone"],
  });
  const attention = row({
    row_number: 6,
    outcome: "REVIEW_REQUIRED",
    values: { wksa_id: "", first_name: "Ella", last_name: "Moss", date_of_birth: "30/05/2016", current_rank: "Purple", status: "ACTIVE" },
    issues: ["WKSA ID: This field cannot be blank.", "Rank 'Purple' is not a rank KukGrade recognises."],
    issue_fields: ["current_rank", "wksa_id"],
  });

  it("opens on the rows that need attention, each fixable in place", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(needing);
    api.getDataImportRows.mockResolvedValue(page([attention]));
    api.correctDataImportRow.mockResolvedValue({ ...attention, outcome: "READY" });

    renderAt("/imports/7");

    expect(await screen.findByText("Row 6 · Ella Moss")).toBeInTheDocument();
    expect(api.getDataImportRows).toHaveBeenCalledWith(7, expect.objectContaining({ outcome: "REVIEW_REQUIRED", page: 1 }));
    expect(screen.getByLabelText("WKSA ID, row 6")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("First name, row 6")).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByRole("option", { name: "Purple (not recognised)" })).toBeInTheDocument();
    expect(screen.getByText("Fix or leave out the 1 row that needs attention first.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();

    await screen.findByRole("option", { name: "White" });
    await user.selectOptions(screen.getByLabelText("Rank, row 6"), "White");
    await waitFor(() => expect(api.correctDataImportRow).toHaveBeenCalledWith(7, 6, { current_rank: "White" }));
    await user.type(screen.getByLabelText("WKSA ID, row 6"), "104-2-322");
    await user.tab();
    await waitFor(() => expect(api.correctDataImportRow).toHaveBeenLastCalledWith(7, 6, { wksa_id: "104-2-322" }));
  });

  it("leaves one row out, or every row still needing attention", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(needing);
    api.getDataImportRows.mockResolvedValue(page([attention]));
    api.setDataImportRowExcluded.mockResolvedValue({ ...attention, outcome: "EXCLUDED" });
    api.leaveOutDataImportRowsNeedingAttention.mockResolvedValue(sorted);

    renderAt("/imports/7");
    await user.click(await screen.findByRole("button", { name: "Leave this row out, row 6" }));
    await waitFor(() => expect(api.setDataImportRowExcluded).toHaveBeenCalledWith(7, 6, true));

    await user.click(screen.getByRole("button", { name: "Leave out the 1 left" }));
    await waitFor(() => expect(api.leaveOutDataImportRowsNeedingAttention).toHaveBeenCalledWith(7));
  });

  it("shows exactly what will be imported for a last look", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(needing);
    api.getDataImportRows.mockImplementation((_id: number, params: { outcome?: string }) =>
      Promise.resolve(
        params.outcome === "READY"
          ? page([row({ row_number: 4, values: { wksa_id: "104-2-318", first_name: "Priya", last_name: "Shah", date_of_birth: "13/02/2010", current_rank: "Red", status: "ACTIVE" }, corrected_fields: ["date_of_birth"] })])
          : page([attention]),
      ),
    );

    renderAt("/imports/7");
    await user.click(await screen.findByRole("button", { name: "Look over all 198 new students" }));

    expect(await screen.findByRole("heading", { name: "198 students will be added" })).toBeInTheDocument();
    expect(screen.getByText("13/02/2010")).toBeInTheDocument();
    expect(screen.getByText("Your fix")).toBeInTheDocument();
  });

  it("corrects a valid seventh row in the last look and reopens the saved fix", async () => {
    const user = userEvent.setup();
    let savedFix = false;
    const seventh = row({ row_number: 7, values: { wksa_id: "104-2-307", first_name: "Miaa", last_name: "Reynolds", date_of_birth: "14/03/2015", current_rank: "Yellow", status: "ACTIVE" }, file_values: { first_name: "Miaa" } });
    api.getDataImportBatch.mockResolvedValue(sorted);
    api.getDataImportRows.mockImplementation(() => Promise.resolve(page([savedFix ? { ...seventh, values: { ...seventh.values, first_name: "Mia" }, corrected_fields: ["first_name"] } : seventh])));
    api.correctDataImportRow.mockImplementation(() => {
      savedFix = true;
      return Promise.resolve({ ...seventh, values: { ...seventh.values, first_name: "Mia" }, corrected_fields: ["first_name"] });
    });

    const first = renderAt("/imports/7?step=review");
    await user.click(await screen.findByRole("button", { name: "Edit row 7" }));
    const name = screen.getByLabelText("First name, row 7");
    await user.clear(name);
    await user.type(name, "Mia{Enter}");
    await waitFor(() => expect(api.correctDataImportRow).toHaveBeenCalledWith(7, 7, { first_name: "Mia" }));
    first.unmount();

    renderAt("/imports/7?step=review");
    await user.click(await screen.findByRole("button", { name: "Edit row 7" }));
    expect(screen.getByLabelText("First name, row 7")).toHaveValue("Mia");
    expect(screen.getByText("File had “Miaa”")).toBeInTheDocument();
  });

  it("offers the same correction editor on a later review page", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(sorted);
    api.getDataImportRows.mockImplementation((_id: number, params: { page: number }) => Promise.resolve(
      params.page === 1 ? { ...page([row({ row_number: 2 })], 21), next: "?page=2" } : page([row({ row_number: 27 })], 21),
    ));

    renderAt("/imports/7?step=review");
    await user.click(await screen.findByRole("button", { name: "Next" }));
    await user.click(await screen.findByRole("button", { name: "Edit row 27" }));
    expect(screen.getByLabelText("First name, row 27")).toBeInTheDocument();
  });

  it("confirms the import on the same page once every row is sorted", async () => {
    const user = userEvent.setup();
    const committed: DataImportBatch = { ...sorted, status: "COMMITTED", status_display: "Imported", next_step: "CLOSED", committed_by_name: "Sam Taylor", committed_at: "2026-10-20T10:18:00Z", summary_json: { total: 212, created: 203, skipped_existing: 5, excluded: 4 } };
    api.getDataImportBatch.mockResolvedValueOnce(sorted).mockResolvedValue(committed);
    api.getDataImportRows.mockResolvedValue(page([]));
    api.commitDataImport.mockResolvedValue(committed);

    renderAt("/imports/7?step=review");

    expect(await screen.findByRole("heading", { name: "Everything is sorted · ready to add 203 students" })).toBeInTheDocument();
    expect(screen.getByText(/5 already in KukGrade are skipped, 4 you left out, “Parent phone” kept as extra information/)).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Confirm");
    await user.click(screen.getByRole("button", { name: "Add 203 students" }));
    const dialog = screen.getByRole("dialog", { name: "Add 203 students to KukGrade?" });
    expect(api.commitDataImport).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Add 203 students" }));

    await waitFor(() => expect(api.commitDataImport).toHaveBeenCalledWith(7));
    expect(await screen.findByText("203 students added")).toBeInTheDocument();
  });

  it("says nothing was saved when the import is refused", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(sorted);
    api.getDataImportRows.mockResolvedValue(page([]));
    api.commitDataImport.mockRejectedValue(
      new ApiError("Invalid", 400, "validation_error", {
        non_field_errors: ["Row 5: the WKSA ID 104-2-205 was taken since the check."],
      }),
    );

    renderAt("/imports/7?step=review");
    await user.click(await screen.findByRole("button", { name: "Add 203 students" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add 203 students" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nothing was saved. Row 5: the WKSA ID 104-2-205 was taken since the check.",
    );
  });

  it("lets a historical workbook be imported whatever is still unmatched", async () => {
    const gradings = batch({ kind: "LEGACY_GRADINGS", original_filename: "grading-record-2025.xlsx", row_counts: { total: 231, ready: 229, review_required: 0, skip_existing: 0, excluded: 2 } });
    api.getDataImportBatch.mockResolvedValue(gradings);
    api.getDataImportRows.mockResolvedValue(page([row({ source_locator: "06-2025!R3", values: { name: "Theo", current_rank: "Yellow Belt", testing_for_rank: "Blue stripe?", outcome: "Pass.", report: "Needs work on falls." } })]));
    api.previewLegacyGradingImport.mockResolvedValue({ total: 229, grading_result: 190, auxiliary_note: 33, did_not_attend: 6, unresolved_current_rank: 1, unresolved_testing_for_rank: 2, unresolved_outcome: 0, excluded: 2, warnings: [], rank_suggestions: [] });

    renderAt("/imports/7?step=review");

    expect(await screen.findByRole("heading", { name: "Ready to import 229 historical records" })).toBeInTheDocument();
    expect(await screen.findByText(/2 you left out, 3 ranks not matched stay as written/)).toBeInTheDocument();
    expect(await screen.findByText("Needs work on falls.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "229 records will be imported" })).toBeInTheDocument();
  });

  it("opens a workbook's review on the records worth a look, saying why", async () => {
    const user = userEvent.setup();
    const gradings = batch({ kind: "LEGACY_GRADINGS", row_counts: { total: 231, ready: 231, review_required: 0, skip_existing: 0, excluded: 0 } });
    const theo = row({
      row_number: 9,
      source_locator: "03-2025!R9",
      values: { name: "Theo", current_rank: "Yellow Belt", testing_for_rank: "Blue stripe?", outcome: "Pass." },
      issues: ["The workbook marks rank 'Blue stripe?' as uncertain."],
    });
    api.getDataImportBatch.mockResolvedValue(gradings);
    api.getDataImportRows.mockResolvedValue(page([theo]));
    api.setDataImportRowExcluded.mockResolvedValue({ ...theo, excluded: true, outcome: "EXCLUDED" });
    api.previewLegacyGradingImport.mockResolvedValue({ total: 231, grading_result: 196, auxiliary_note: 4, did_not_attend: 31, unresolved_current_rank: 0, unresolved_testing_for_rank: 0, unresolved_outcome: 0, excluded: 0, worth_a_look: 1, warnings: [], rank_suggestions: [] });

    renderAt("/imports/7?step=review");

    expect(await screen.findByRole("heading", { name: "Records worth a look" })).toBeInTheDocument();
    expect(api.getDataImportRows).toHaveBeenLastCalledWith(7, { worth_a_look: true, page: 1, page_size: 20 });
    expect(await screen.findByText("The workbook marks rank 'Blue stripe?' as uncertain.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Did not attend and notes/ })).toHaveTextContent("35");
    await user.click(screen.getByRole("button", { name: "Leave out the record for Theo" }));
    await waitFor(() => expect(api.setDataImportRowExcluded).toHaveBeenCalledWith(7, 9, true));

    await user.click(screen.getByRole("button", { name: /Grading results/ }));
    await waitFor(() =>
      expect(api.getDataImportRows).toHaveBeenLastCalledWith(7, { record_kind: "GRADING_RESULT", outcome: "READY", page: 1, page_size: 20 }),
    );
  });
});

describe("Linking historical records", () => {
  const candidate = person().candidates[0];
  const mia = person({ record_ids: [101, 102], records: 2 });
  const zac = person({
    source_name: "Zac W",
    group_key: "zac w",
    record_ids: [301],
    records: 1,
    ranks: ["Yellow → Yellow stripe"],
    candidates: [{ ...candidate, student: 50, full_name: "Zac Whitfield", current_rank_name: "Yellow stripe", reasons: ["Same first name"] }],
  });
  const miaAgain = person({ source_name: "Mia", group_key: "mia", record_ids: [401], records: 1 });
  const theo = person({
    source_name: "Theo",
    group_key: "theo",
    record_ids: [201],
    records: 1,
    shared: true,
    suggestion: "choose",
    candidates: [
      { ...candidate, student: 40, full_name: "Theo Barker", reasons: ["Ranks fit"] },
      { ...candidate, student: 41, full_name: "Theo Lane", reasons: ["Still a White belt"] },
    ],
  });
  const noah = person({
    source_name: "Noah",
    group_key: "noah",
    record_ids: [501],
    records: 1,
    suggestion: "none",
    needs_rank: true,
    ranks: ["Purple"],
    candidates: [],
  });
  let waiting = [mia, zac, theo, noah];

  function names(params: { exclude_group_keys?: string; group_keys?: string; suggestion?: string; search?: string; linked?: boolean }) {
    const left = (params.group_keys ?? "").split(",");
    const out = (params.exclude_group_keys ?? "").split(",");
    return waiting
      .filter((item) => !params.group_keys || left.includes(item.group_key))
      .filter((item) => !params.exclude_group_keys || !out.includes(item.group_key))
      .filter((item) => !params.suggestion || item.suggestion === params.suggestion)
      .filter((item) => !params.search || item.source_name.toLowerCase().includes(params.search.toLowerCase()));
  }

  beforeEach(() => {
    window.localStorage.clear();
    waiting = [mia, zac, theo, noah];
    api.getDataImportBatches.mockResolvedValue(page([]));
    api.getAllDataImportBatches.mockResolvedValue(page([]));
    api.getLegacyPeopleSummary.mockResolvedValue({ names: 4, clear: 2, choose: 1, none: 1 });
    api.getLegacyPeople.mockImplementation((params: Parameters<typeof names>[0]) =>
      Promise.resolve(params.linked ? page([], 5) : page(names(params))),
    );
    api.getAllLegacyGradingRecords.mockImplementation((params: { group_key: string }) =>
      Promise.resolve(
        params.group_key === "mia r"
          ? page([record(), record({ id: 102, cycle_month: 6, source_testing_for_rank_text: "Brn stripe", testing_for_rank: null })])
          : page([record({ id: 201, source_name: "Theo" })]),
      ),
    );
    api.bulkLinkLegacyRecords.mockResolvedValue([]);
  });

  it("shows every name with its suggestion, the counts and the progress", async () => {
    renderAt("/imports/records");

    expect(await screen.findByText("“Mia R”")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "5 of 9 names linked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^To link\s*4$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Clear suggestion\s*2$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Linked\s*5$/ })).toBeInTheDocument();
    expect(screen.getByText("Mia Reynolds")).toBeInTheDocument();
    expect(screen.getAllByText("Clear suggestion").length).toBeGreaterThan(0);
    expect(screen.getByText("2 students could be this person")).toBeInTheDocument();
    expect(screen.getByText("A rank is not matched yet")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select “Theo”" })).toBeDisabled();
    expect(api.getLegacyPeople).toHaveBeenCalledWith({ batch: undefined, linked: false, page: 1, page_size: 50 });
  });

  it("links every ticked clear suggestion in one go, each name to its own student", async () => {
    const user = userEvent.setup();
    renderAt("/imports/records");

    await user.click(await screen.findByRole("button", { name: "Select the 2 clear suggestions" }));
    await user.click(screen.getByRole("button", { name: "Link 2 names to their students" }));

    await waitFor(() =>
      expect(api.bulkLinkLegacyRecords).toHaveBeenCalledWith([
        { record: 101, student: 31 },
        { record: 102, student: 31 },
        { record: 301, student: 50 },
      ]),
    );
    expect(await screen.findByText("Linked 2 names to their students.")).toBeInTheDocument();
  });

  it("links one name from its own row, and says when another is the same student", async () => {
    const user = userEvent.setup();
    waiting = [...waiting, miaAgain];
    renderAt("/imports/records");

    await user.click(await screen.findByRole("button", { name: "Link “Mia R” to Mia Reynolds" }));

    await waitFor(() =>
      expect(api.bulkLinkLegacyRecords).toHaveBeenCalledWith([
        { record: 101, student: 31 },
        { record: 102, student: 31 },
      ]),
    );
    expect(await screen.findByText("Linked “Mia R” to Mia Reynolds.")).toBeInTheDocument();
    expect(await screen.findByText("Same student as “Mia R”, just linked")).toBeInTheDocument();
  });

  it("opens a row to link only the records ticked", async () => {
    const user = userEvent.setup();
    renderAt("/imports/records");

    await user.click(await screen.findByRole("button", { name: "Review “Mia R”" }));
    expect((await screen.findAllByText("Ki Cho Hyung 1 clean.", { exact: false })).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Mia Reynolds/, pressed: true })).toBeInTheDocument();
    await user.click(screen.getAllByRole("checkbox", { name: /^Link the / })[0]);
    await user.click(screen.getByRole("button", { name: "Link 1 of 2 to Mia Reynolds" }));

    await waitFor(() => expect(api.bulkLinkLegacyRecords).toHaveBeenCalledWith([{ record: 102, student: 31 }]));
  });

  it("asks for a choice where students share a name", async () => {
    const user = userEvent.setup();
    renderAt("/imports/records");

    await user.click(await screen.findByRole("button", { name: "Choose a student for “Theo”" }));

    expect(screen.getByRole("button", { name: "Choose a student first" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Theo Lane/ }));
    await user.click(screen.getByRole("button", { name: "Link it to Theo Lane" }));

    await waitFor(() => expect(api.bulkLinkLegacyRecords).toHaveBeenCalledWith([{ record: 201, student: 41 }]));
  });

  it("finds a student by search for a name nobody was suggested for", async () => {
    const user = userEvent.setup();
    api.getStudents.mockResolvedValue(
      page([{ id: 77, wksa_id: "104-2-777", first_name: "Noah", last_name: "Eze", current_rank_name: "Yellow", age_band_display: "9–12", status_display: "Active" }]),
    );
    renderAt("/imports/records");

    await user.click(await screen.findByRole("button", { name: "Choose a student for “Noah”" }));
    expect(screen.getByText("No student looks like this. Search every student below.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search every student"), "Noah");
    await user.click(await screen.findByRole("button", { name: /Noah Eze Yellow now · 9–12 · Active · 104-2-777/ }));
    await user.click(screen.getByRole("button", { name: "Link it to Noah Eze" }));

    await waitFor(() => expect(api.bulkLinkLegacyRecords).toHaveBeenCalledWith([{ record: 501, student: 77 }]));
  });

  it("filters by how clear the suggestion is, by name, and by import", async () => {
    const user = userEvent.setup();
    api.getAllDataImportBatches.mockResolvedValue(
      page(Array.from({ length: 51 }, (_, index) => batch({ id: index + 1, kind: "LEGACY_GRADINGS", original_filename: `History ${index + 1}.xlsx` }))),
    );
    renderAt("/imports/records");

    await user.click(await screen.findByRole("button", { name: /^Choose between/ }));
    await waitFor(() =>
      expect(api.getLegacyPeople).toHaveBeenCalledWith({ batch: undefined, linked: false, page: 1, page_size: 50, suggestion: "choose" }),
    );
    expect(await screen.findByText("“Theo”")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^To link/ }));
    await user.type(screen.getByLabelText("Find a name"), "zac");
    await waitFor(() =>
      expect(api.getLegacyPeople).toHaveBeenCalledWith({ batch: undefined, linked: false, page: 1, page_size: 50, search: "zac" }),
    );
    await user.selectOptions(await screen.findByLabelText("Import"), await screen.findByRole("option", { name: "History 51.xlsx" }));
    await waitFor(() => expect(api.getLegacyPeopleSummary).toHaveBeenCalledWith({ batch: 51, exclude_group_keys: undefined }));
  });

  it("puts a name aside, remembers it in this browser, and puts it back", async () => {
    const user = userEvent.setup();
    renderAt("/imports/records");

    await user.click(await screen.findByRole("button", { name: "Review “Mia R”" }));
    await user.click(screen.getByRole("button", { name: "Leave for now" }));

    await waitFor(() => expect(screen.queryByText("“Mia R”")).not.toBeInTheDocument());
    expect(window.localStorage.getItem("kukgrade-left-names")).toBe('["mia r"]');
    expect(api.getLegacyPeopleSummary).toHaveBeenLastCalledWith({ batch: undefined, exclude_group_keys: "mia r" });
    await user.click(screen.getByRole("button", { name: /^Left for now/ }));
    expect(await screen.findByText("“Mia R”")).toBeInTheDocument();
    expect(api.getLegacyPeople).toHaveBeenCalledWith(expect.objectContaining({ group_keys: "mia r", linked: false }));
    await user.click(screen.getByRole("button", { name: "Put “Mia R” back" }));
    expect(window.localStorage.getItem("kukgrade-left-names")).toBe("[]");
  });

  it("lists names already linked, and can undo one", async () => {
    const user = userEvent.setup();
    const linked = person({ record_ids: [101, 102], records: 2, linked_student: 31, linked_student_name: "Mia Reynolds" });
    api.getLegacyPeople.mockImplementation((params: { linked?: boolean }) =>
      Promise.resolve(params.linked ? page([linked], 5) : page([])),
    );
    api.unlinkLegacyGradingRecord.mockResolvedValue(record());
    renderAt("/imports/records");

    await user.click(await screen.findByRole("button", { name: /^Linked/ }));
    expect(await screen.findByRole("link", { name: "Mia Reynolds" })).toHaveAttribute("href", "/students/31");
    await user.click(screen.getByRole("button", { name: "Undo linking “Mia R”" }));

    await waitFor(() => expect(api.unlinkLegacyGradingRecord).toHaveBeenCalledTimes(2));
    expect(api.unlinkLegacyGradingRecord).toHaveBeenCalledWith(101);
  });

  it("matches a rank still as written, and voids a record only with a reason", async () => {
    const user = userEvent.setup();
    api.resolveLegacyTestingForRank.mockResolvedValue(record());
    api.voidLegacyGradingRecord.mockResolvedValue(record({ is_void: true }));
    renderAt("/imports/records");

    await user.click(await screen.findByRole("button", { name: "Review “Mia R”" }));
    await screen.findAllByRole("option", { name: "Brown stripe" });
    await user.selectOptions(await screen.findByLabelText(/“Brn stripe” is not matched/), "8");
    await waitFor(() => expect(api.resolveLegacyTestingForRank).toHaveBeenCalledWith(102, 8));

    await user.click(screen.getByRole("button", { name: "Void the Mar 2025 record" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Void the record" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Why"), "Entered twice");
    await user.click(within(dialog).getByRole("button", { name: "Void the record" }));
    await waitFor(() => expect(api.voidLegacyGradingRecord).toHaveBeenCalledWith(101, "Entered twice"));
  });

  it("pages through the names fifty at a time", async () => {
    const user = userEvent.setup();
    api.getLegacyPeople.mockImplementation((params: { linked?: boolean; page?: number }) =>
      Promise.resolve(params.linked ? page([], 0) : params.page === 2 ? page([noah], 51) : page(waiting, 51)),
    );
    renderAt("/imports/records");

    await screen.findByText("“Mia R”");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("“Noah”")).toBeInTheDocument();
    expect(api.getLegacyPeople).toHaveBeenCalledWith({ batch: undefined, linked: false, page: 2, page_size: 50 });
  });

  it("says when every record is linked", async () => {
    api.getLegacyPeopleSummary.mockResolvedValue({ names: 0, clear: 0, choose: 0, none: 0 });
    api.getLegacyPeople.mockResolvedValue(page([]));

    renderAt("/imports/records");

    expect(await screen.findByText("✓ Every imported record is linked to a student.")).toBeInTheDocument();
  });

  it("shows what could not be linked and keeps the names", async () => {
    const user = userEvent.setup();
    api.bulkLinkLegacyRecords.mockRejectedValue(new ApiError("That record is already linked.", 400));
    renderAt("/imports/records");

    await user.click(await screen.findByRole("button", { name: "Link “Zac W” to Zac Whitfield" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That record is already linked.");
    expect(screen.getByText("“Zac W”")).toBeInTheDocument();
  });
});
