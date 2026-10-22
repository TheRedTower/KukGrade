import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type AuthUser, type DataImportBatch, type DataImportRow } from "./api";
import { ADMINISTRATOR_CAPABILITIES, authUser } from "./appTestSupport";
import { ImportScreen } from "./ImportScreen";
import { ImportReview } from "./ImportReview";
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

  it("keeps roster confirmation closed until a row correction is saved", async () => {
    const user = userEvent.setup();
    const seventh = row({ row_number: 7, values: { wksa_id: "104-2-307", first_name: "Miaa", last_name: "Reynolds", current_rank: "Yellow" } });
    const corrected = { ...seventh, values: { ...seventh.values, first_name: "Mia" }, corrected_fields: ["first_name"] };
    let acknowledge!: (value: DataImportRow) => void;
    let saved = false;
    api.getDataImportBatch.mockResolvedValue(sorted);
    api.getDataImportRows.mockImplementation(() => Promise.resolve(page([saved ? corrected : seventh])));
    api.correctDataImportRow.mockImplementation(() => new Promise<DataImportRow>((resolve) => { acknowledge = resolve; }));

    renderAt("/imports/7?step=review");
    await user.click(await screen.findByRole("button", { name: "Edit row 7" }));
    const input = screen.getByLabelText("First name, row 7");
    await user.clear(input);
    await user.type(input, "Mia");
    expect(screen.getByRole("button", { name: "Add 203 students" })).toBeDisabled();
    await user.tab();
    expect(api.correctDataImportRow).toHaveBeenCalledWith(7, 7, { first_name: "Mia" });
    expect(screen.getByRole("button", { name: "Add 203 students" })).toBeDisabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    saved = true;
    await act(async () => acknowledge(corrected));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add 203 students" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Add 203 students" }));
    expect(screen.getByRole("dialog", { name: "Add 203 students to KukGrade?" })).toBeInTheDocument();
  });

  it("keeps roster confirmation closed after a failed row correction until retry succeeds", async () => {
    const user = userEvent.setup();
    const seventh = row({ row_number: 7, values: { wksa_id: "104-2-307", first_name: "Miaa", last_name: "Reynolds", current_rank: "Yellow" } });
    api.getDataImportBatch.mockResolvedValue(sorted);
    api.getDataImportRows.mockResolvedValue(page([seventh]));
    api.correctDataImportRow.mockRejectedValueOnce(new Error("Save failed")).mockResolvedValue(seventh);

    renderAt("/imports/7?step=review");
    await user.click(await screen.findByRole("button", { name: "Edit row 7" }));
    const input = screen.getByLabelText("First name, row 7");
    await user.clear(input);
    await user.type(input, "Mia");
    await user.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent("That fix could not be saved.");
    expect(screen.getByRole("button", { name: "Add 203 students" })).toBeDisabled();

    await user.click(input);
    await user.tab();
    await waitFor(() => expect(api.correctDataImportRow).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add 203 students" })).toBeEnabled());
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

  it("returns to the first page when an import filter is revisited", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(sorted);
    api.getDataImportRows.mockImplementation((_id: number, params: { outcome: string; page: number }) =>
      Promise.resolve(params.outcome === "READY" ? page([row({ row_number: params.page })], 60) : page([])),
    );

    renderAt("/imports/7?step=review");
    await screen.findByRole("button", { name: "Next" });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.getDataImportRows).toHaveBeenLastCalledWith(7, expect.objectContaining({ outcome: "READY", page: 3 })));

    await user.click(screen.getByRole("button", { name: /Already in KukGrade/ }));
    await waitFor(() => expect(api.getDataImportRows).toHaveBeenLastCalledWith(7, expect.objectContaining({ outcome: "SKIP_EXISTING", page: 1 })));
    await user.click(screen.getByRole("button", { name: /Ready to add/ }));
    await waitFor(() => expect(api.getDataImportRows).toHaveBeenLastCalledWith(7, expect.objectContaining({ outcome: "READY", page: 1 })));
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

  it("does not refetch a historical preview after the batch is committed", async () => {
    const user = userEvent.setup();
    const gradings = batch({ kind: "LEGACY_GRADINGS", row_counts: { total: 1, ready: 1, review_required: 0, skip_existing: 0, excluded: 0 } });
    const committed = { ...gradings, status: "COMMITTED" as const, next_step: "CLOSED" as const };
    const onCommitted = vi.fn();
    api.getDataImportRows.mockResolvedValue(page([row({ values: { name: "Theo" } })]));
    api.previewLegacyGradingImport.mockResolvedValue({ total: 1, grading_result: 1, auxiliary_note: 0, did_not_attend: 0, unresolved_current_rank: 0, unresolved_testing_for_rank: 0, unresolved_outcome: 0, excluded: 0, warnings: [], rank_suggestions: [] });
    api.commitDataImport.mockResolvedValue(committed);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <ImportReview batch={gradings} onCommitted={onCommitted} onMatch={vi.fn()} />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "Ready to import 1 historical record" });
    await waitFor(() => expect(api.previewLegacyGradingImport).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Import 1 record" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Import 1 record" }));

    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
    expect(api.previewLegacyGradingImport).toHaveBeenCalledTimes(1);
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
  const mia = person({ record_ids: [101, 102] , records: 2 });
  const theo = person({
    source_name: "Theo",
    group_key: "theo",
    record_ids: [201],
    records: 1,
    shared: true,
    candidates: [
      { ...mia.candidates[0], student: 40, full_name: "Theo Barker", reasons: ["Ranks fit"] },
      { ...mia.candidates[0], student: 41, full_name: "Theo Lane", reasons: ["Still a White belt"] },
    ],
  });

  beforeEach(() => {
    api.getDataImportBatches.mockResolvedValue(page([]));
    api.getAllDataImportBatches.mockResolvedValue(page([]));
    api.getLegacyPeople.mockResolvedValue(page([mia, theo]));
    api.getAllLegacyGradingRecords.mockImplementation((params: { group_key: string }) =>
      Promise.resolve(
        params.group_key === "mia r"
          ? page([record(), record({ id: 102, cycle_month: 6, source_testing_for_rank_text: "Brn stripe", testing_for_rank: null })])
          : page([record({ id: 201, source_name: "Theo" })]),
      ),
    );
  });

  it("links a name's ticked records to the student chosen, then moves on", async () => {
    const user = userEvent.setup();
    api.bulkLinkLegacyRecords.mockResolvedValue([record({ id: 102 })]);
    api.unlinkLegacyGradingRecord.mockResolvedValue(record());

    renderAt("/imports/records");

    expect(await screen.findByRole("heading", { name: "“Mia R” in the workbook" })).toBeInTheDocument();
    expect(api.getAllLegacyGradingRecords).toHaveBeenCalledWith({ group_key: "mia r", batch: undefined, linked: false, voided: false });
    expect((await screen.findAllByText("Ki Cho Hyung 1 clean.", { exact: false })).length).toBeGreaterThan(0);
    expect(screen.getByRole("radio", { name: /Mia Reynolds/ })).toBeChecked();
    await user.click(screen.getAllByRole("checkbox")[0]);
    await user.click(screen.getByRole("button", { name: "Link 1 of 2 to Mia Reynolds" }));

    await waitFor(() => expect(api.bulkLinkLegacyRecords).toHaveBeenCalledWith([{ record: 102, student: 31 }]));
    expect(await screen.findByRole("heading", { name: "“Theo” in the workbook" })).toBeInTheDocument();
    expect(screen.getByText("Linked to Mia Reynolds")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo linking “Mia R”" }));
    await waitFor(() => expect(api.unlinkLegacyGradingRecord).toHaveBeenCalledWith(102));
    expect(api.unlinkLegacyGradingRecord).toHaveBeenCalledTimes(1);
  });

  it("retries only the remaining linked records after a partial undo failure", async () => {
    const user = userEvent.setup();
    let failOnce = true;
    api.getLegacyPeople.mockResolvedValue(page([person({ record_ids: [101, 102], records: 2 })]));
    api.bulkLinkLegacyRecords.mockResolvedValue([record(), record({ id: 102 })]);
    api.unlinkLegacyGradingRecord.mockImplementation((id: number) => {
      if (id === 102 && failOnce) {
        failOnce = false;
        return Promise.reject(new Error("temporary failure"));
      }
      return Promise.resolve(record({ id }));
    });

    renderAt("/imports/records");
    await user.click(await screen.findByRole("button", { name: "Link all 2 to Mia Reynolds" }));
    await user.click(await screen.findByRole("button", { name: "Undo linking “Mia R”" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Some records were unlinked. Try Undo again for the rest.");
    await waitFor(() => expect(api.unlinkLegacyGradingRecord).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole("button", { name: "Undo linking “Mia R”" }));
    await waitFor(() => expect(api.unlinkLegacyGradingRecord).toHaveBeenCalledTimes(3));
    expect(api.unlinkLegacyGradingRecord.mock.calls.map(([id]) => id)).toEqual([101, 102, 102]);
    expect(api.getLegacyPeople).toHaveBeenCalledTimes(4);
  });

  it("keeps an unlinked record visible after linking only part of a group", async () => {
    const user = userEvent.setup();
    let secondLinked = false;
    api.getLegacyPeople.mockImplementation(() => Promise.resolve(page([
      person({ record_ids: secondLinked ? [101] : [101, 102], records: secondLinked ? 1 : 2 }),
    ])));
    api.getAllLegacyGradingRecords.mockImplementation(() => Promise.resolve(page(
      secondLinked ? [record()] : [record(), record({ id: 102, cycle_month: 6 })],
    )));
    api.bulkLinkLegacyRecords.mockImplementation(() => {
      secondLinked = true;
      return Promise.resolve([record({ id: 102, student: 31 })]);
    });

    renderAt("/imports/records");
    await screen.findByRole("button", { name: "Link all 2 to Mia Reynolds" });
    await user.click(screen.getAllByRole("checkbox")[0]);
    await user.click(screen.getByRole("button", { name: "Link 1 of 2 to Mia Reynolds" }));

    expect(await screen.findByRole("button", { name: "Link it to Mia Reynolds" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "“Mia R” in the workbook" })).toBeInTheDocument();
    expect(screen.queryByText("✓ Every imported record is linked to a student.")).not.toBeInTheDocument();
  });

  it("advances past fifty names left for later", async () => {
    const user = userEvent.setup();
    const first = Array.from({ length: 50 }, (_, index) => person({
      source_name: `Person ${String(index).padStart(2, "0")}`,
      group_key: `person ${String(index).padStart(2, "0")}`,
      record_ids: [index + 1],
      records: 1,
    }));
    const last = person({ source_name: "Person 50", group_key: "person 50", record_ids: [51], records: 1 });
    api.getLegacyPeople.mockImplementation(({ page: requested }: { page: number }) => Promise.resolve(
      requested === 1
        ? { ...page(first, 51), next: "?page=2" }
        : page([last], 51),
    ));
    api.getAllLegacyGradingRecords.mockResolvedValue(page([record()]));

    renderAt("/imports/records");
    for (let index = 0; index < 50; index += 1) {
      await user.click(await screen.findByRole("button", { name: "Leave for now" }));
    }

    expect(await screen.findByRole("heading", { name: "“Person 50” in the workbook" })).toBeInTheDocument();
    expect(api.getLegacyPeople).toHaveBeenCalledWith({ batch: undefined, linked: false, page: 2, page_size: 50 });
  }, 15_000);

  it("offers import filters beyond the first page", async () => {
    const user = userEvent.setup();
    api.getAllDataImportBatches.mockResolvedValue(page(Array.from({ length: 51 }, (_, index) =>
      batch({ id: index + 1, kind: "LEGACY_GRADINGS", original_filename: `History ${index + 1}.xlsx` }),
    )));

    renderAt("/imports/records");
    await screen.findByRole("option", { name: "History 51.xlsx" });
    await user.selectOptions(screen.getByLabelText("Import"), "51");

    expect(api.getLegacyPeople).toHaveBeenCalledWith({ batch: 51, linked: false, page: 1, page_size: 50 });
  });

  it("asks for a choice where students share a name, or another student by search", async () => {
    const user = userEvent.setup();
    api.getStudents.mockResolvedValue(page([{ id: 77, wksa_id: "104-2-777", first_name: "Theo", last_name: "Pratt", current_rank_name: "Blue" }]));
    api.bulkLinkLegacyRecords.mockResolvedValue([record({ id: 201 })]);

    renderAt("/imports/records");
    await user.click(await screen.findByRole("button", { name: /“Theo” · 1/ }));

    expect(await screen.findByText("Students share this name: choose one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose a student first" })).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Search every student"), "Pratt");
    await user.click(await screen.findByRole("button", { name: "Theo Pratt · Blue · 104-2-777" }));
    await user.click(screen.getByRole("button", { name: "Link it to Theo Pratt" }));

    await waitFor(() => expect(api.bulkLinkLegacyRecords).toHaveBeenCalledWith([{ record: 201, student: 77 }]));
  });

  it("matches a rank still as written, and voids a record only with a reason", async () => {
    const user = userEvent.setup();
    api.resolveLegacyTestingForRank.mockResolvedValue(record());
    api.voidLegacyGradingRecord.mockResolvedValue(record({ is_void: true }));

    renderAt("/imports/records");
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

  it("says when every record is linked", async () => {
    api.getLegacyPeople.mockResolvedValue(page([]));

    renderAt("/imports/records");

    expect(await screen.findByText("✓ Every imported record is linked to a student.")).toBeInTheDocument();
  });
});
