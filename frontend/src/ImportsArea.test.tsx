import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type AuthUser, type CreateDataImportBatchResponse } from "./api";
import { ADMINISTRATOR_CAPABILITIES, authUser } from "./appTestSupport";
import { ImportScreen } from "./ImportScreen";
import { batch, page, person, row } from "./importTestFixtures";
import { ImportStartScreen } from "./ImportStartScreen";
import { ImportsHubScreen } from "./ImportsHubScreen";

const api = vi.hoisted(() => ({
  getDataImportBatches: vi.fn(),
  getDataImportBatch: vi.fn(),
  getDataImportRows: vi.fn(),
  createDataImportBatch: vi.fn(),
  cancelDataImportBatch: vi.fn(),
  chooseDataImportSheet: vi.fn(),
  voidDataImportRecords: vi.fn(),
  getLegacyGradingRecords: vi.fn(),
  getLegacyPeople: vi.fn(),
  bulkLinkLegacyRecords: vi.fn(),
  unlinkLegacyGradingRecord: vi.fn(),
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
          <Route element={<ImportsHubScreen />} path="/imports" />
          <Route element={<ImportStartScreen />} path="/imports/new" />
          <Route element={<ImportScreen />} path="/imports/:id" />
          <Route element={<h1>Students reached</h1>} path="/students" />
          <Route element={<h1>Student page</h1>} path="/students/:id" />
          <Route element={<h1>Linking page</h1>} path="/imports/records" />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  auth.user = { ...authUser, ...ADMINISTRATOR_CAPABILITIES };
  api.getLegacyGradingRecords.mockResolvedValue(page([], 0));
});

describe("Imports hub", () => {
  it("puts unfinished imports first, with where each is up to", async () => {
    api.getDataImportBatches.mockImplementation((params: { status: string }) =>
      Promise.resolve(params.status === "UPLOADED" ? page([batch()]) : page([])),
    );

    renderAt("/imports");

    expect(await screen.findByRole("heading", { name: "Pick up where you left off" })).toBeInTheDocument();
    expect(screen.getByText("Step 3 of 5 · Review rows")).toBeInTheDocument();
    expect(screen.getByText("198 ready · 9 need attention · 5 already in KukGrade")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Resume spring-roster.xlsx" })).toHaveAttribute(
      "href",
      "/imports/7",
    );
    expect(await screen.findByText("No imports have finished yet.")).toBeInTheDocument();
  });

  it("leaves the unfinished list out when there is nothing to resume", async () => {
    api.getDataImportBatches.mockResolvedValue(page([]));

    renderAt("/imports");

    expect(await screen.findByText("No imports have finished yet.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pick up where you left off" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Import students" })).toHaveAttribute(
      "href",
      "/imports/new?kind=STUDENT_ROSTER",
    );
  });

  it("cancels an unfinished import only once it is confirmed", async () => {
    const user = userEvent.setup();
    api.getDataImportBatches.mockImplementation((params: { status: string }) =>
      Promise.resolve(params.status === "UPLOADED" ? page([batch()]) : page([])),
    );
    api.cancelDataImportBatch.mockResolvedValue(undefined);

    renderAt("/imports");
    await user.click(await screen.findByRole("button", { name: "Cancel spring-roster.xlsx" }));
    const dialog = screen.getByRole("dialog", { name: "Cancel spring-roster.xlsx?" });
    expect(api.cancelDataImportBatch).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel the import" }));

    await waitFor(() => expect(api.cancelDataImportBatch).toHaveBeenCalledWith(7));
  });

  it("lists past imports, filtered by kind and state, with their results", async () => {
    const user = userEvent.setup();
    const finished = batch({
      id: 3,
      original_filename: "members-september.csv",
      status: "COMMITTED",
      status_display: "Imported",
      committed_at: "2026-10-02T10:00:00Z",
      committed_by_name: "Sam Taylor",
      summary_json: { created: 186, skipped_existing: 4 },
    });
    api.getDataImportBatches.mockImplementation((params: { status: string }) =>
      Promise.resolve(params.status === "UPLOADED" ? page([]) : page([finished])),
    );

    renderAt("/imports");

    expect(await screen.findByText("186 students added · 4 already here")).toBeInTheDocument();
    expect(api.getDataImportBatches).toHaveBeenCalledWith(
      expect.objectContaining({ status: "COMMITTED,CANCELLED,EXPIRED", page: 1 }),
    );
    await user.selectOptions(screen.getByLabelText("What"), "LEGACY_GRADINGS");
    await user.selectOptions(screen.getByLabelText("State"), "CANCELLED");

    await waitFor(() =>
      expect(api.getDataImportBatches).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: "LEGACY_GRADINGS", status: "CANCELLED" }),
      ),
    );
  });

  it("says how many imported records still wait for a student", async () => {
    api.getDataImportBatches.mockResolvedValue(page([]));
    api.getLegacyGradingRecords.mockResolvedValue(page([], 48));

    renderAt("/imports");

    expect(await screen.findByText("48 imported records")).toBeInTheDocument();
    expect(api.getLegacyGradingRecords).toHaveBeenCalledWith({ awaiting_link: true, page_size: 1 });
    expect(screen.getByRole("link", { name: "Link records" })).toBeInTheDocument();
  });
});

describe("Choosing the file", () => {
  const created: CreateDataImportBatchResponse = {
    id: 7,
    already_imported_warning: true,
    detected_headers: [],
    suggested_mapping: {},
  };

  function xlsx(name = "spring-roster.xlsx", size = 1000) {
    const file = new File(["x"], name);
    Object.defineProperty(file, "size", { value: size });
    return file;
  }

  it("shows the guide until a file is chosen, then what KukGrade found", async () => {
    const user = userEvent.setup();
    api.createDataImportBatch.mockResolvedValue(created);
    api.getDataImportBatch.mockResolvedValue(
      batch({ next_step: "MATCH_COLUMNS", sheet_names: ["Members", "Leavers"] }),
    );

    renderAt("/imports/new?kind=STUDENT_ROSTER");

    expect(screen.getByRole("heading", { name: "What KukGrade looks for" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to match columns" })).toBeDisabled();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Choose file");

    await user.upload(screen.getByLabelText("Choose a file"), xlsx());

    expect(await screen.findByText("212 rows of students")).toBeInTheDocument();
    expect(api.createDataImportBatch).toHaveBeenCalledWith(expect.any(File), "STUDENT_ROSTER");
    expect(screen.getByText("7 columns")).toBeInTheDocument();
    expect(screen.getByText("This exact file has been imported before")).toBeInTheDocument();
    // The guide folds away once the file is read.
    expect(screen.getByRole("button", { name: "What KukGrade looks for" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await user.click(screen.getByRole("button", { name: "Continue to match columns" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/imports/7");
  });

  it("refuses a file of the wrong type or size before sending it", async () => {
    const user = userEvent.setup({ applyAccept: false });

    renderAt("/imports/new?kind=LEGACY_GRADINGS");

    await user.upload(screen.getByLabelText("Choose a file"), xlsx("record.csv"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose the workbook as an Excel (.xlsx) file.",
    );
    await user.upload(screen.getByLabelText("Choose a file"), xlsx("record.xlsx", 6 * 1024 * 1024));
    expect(screen.getByRole("alert")).toHaveTextContent("The file is larger than 5 MB.");
    expect(api.createDataImportBatch).not.toHaveBeenCalled();
  });

  it("shows the server's reason when it cannot read the file", async () => {
    const user = userEvent.setup();
    api.createDataImportBatch.mockRejectedValue(
      new ApiError("Invalid", 400, "validation_error", { file: ["The file has no header row."] }),
    );

    renderAt("/imports/new?kind=STUDENT_ROSTER");
    await user.upload(screen.getByLabelText("Choose a file"), xlsx());

    expect(await screen.findByRole("alert")).toHaveTextContent("The file has no header row.");
  });

  it("reads another sheet of a workbook when one is chosen", async () => {
    const user = userEvent.setup();
    api.createDataImportBatch.mockResolvedValue({ ...created, already_imported_warning: false });
    api.getDataImportBatch.mockResolvedValue(batch({ sheet_names: ["Members", "Leavers"] }));
    api.chooseDataImportSheet.mockResolvedValue(
      batch({ sheet: "Leavers", sheet_names: ["Members", "Leavers"], row_counts: { total: 2, ready: 2, review_required: 0, skip_existing: 0, excluded: 0 } }),
    );

    renderAt("/imports/new?kind=STUDENT_ROSTER");
    await user.upload(screen.getByLabelText("Choose a file"), xlsx());
    await user.selectOptions(await screen.findByLabelText(/Sheet to read/), "Leavers");

    expect(await screen.findByText("2 rows of students")).toBeInTheDocument();
    expect(api.chooseDataImportSheet).toHaveBeenCalledWith(7, "Leavers");
  });

  it("removes the upload when a different file is chosen", async () => {
    const user = userEvent.setup();
    api.createDataImportBatch.mockResolvedValue(created);
    api.getDataImportBatch.mockResolvedValue(batch());
    api.cancelDataImportBatch.mockResolvedValue(undefined);

    renderAt("/imports/new?kind=STUDENT_ROSTER");
    await user.upload(screen.getByLabelText("Choose a file"), xlsx());
    await user.click(await screen.findByRole("button", { name: "Choose a different file" }));

    expect(api.cancelDataImportBatch).toHaveBeenCalledWith(7);
    expect(await screen.findByRole("heading", { name: "Choose your file" })).toBeInTheDocument();
  });

  it("names the grading sheets a historical workbook has", async () => {
    const user = userEvent.setup();
    api.createDataImportBatch.mockResolvedValue({ ...created, already_imported_warning: false });
    api.getDataImportBatch.mockResolvedValue(
      batch({
        kind: "LEGACY_GRADINGS",
        original_filename: "grading-record-2025.xlsx",
        grading_sheets: ["03-2025", "06-2025"],
        warnings: ["Unknown sheet 'Notes' was not imported."],
        row_counts: { total: 99, ready: 99, review_required: 0, skip_existing: 0, excluded: 0 },
      }),
    );

    renderAt("/imports/new?kind=LEGACY_GRADINGS");
    await user.upload(screen.getByLabelText("Choose a file"), xlsx("grading-record-2025.xlsx"));

    expect(await screen.findByText("2 grading sheets")).toBeInTheDocument();
    expect(screen.getByText("Each sheet holds one grading: 03-2025, 06-2025.")).toBeInTheDocument();
    expect(screen.getByText("99 records")).toBeInTheDocument();
    expect(screen.getByText("Unknown sheet 'Notes' was not imported.")).toBeInTheDocument();
  });
});

describe("An import's results", () => {
  const roster = batch({
    status: "COMMITTED",
    status_display: "Imported",
    next_step: "CLOSED",
    committed_at: "2026-10-20T10:18:00Z",
    committed_by_name: "Sam Taylor",
    defaults: { status: "ACTIVE" },
    extra_columns: ["Parent phone"],
    summary_json: { total: 212, created: 203, skipped_existing: 5, review_required: 0, excluded: 4 },
  });

  it("shows what a roster import did, with a second look and every row", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(roster);
    api.getDataImportRows.mockImplementation((_id: number, params: { corrected?: boolean }) =>
      Promise.resolve(
        params.corrected
          ? page([row({ row_number: 4, corrected_fields: ["date_of_birth"] })], 5)
          : page([row(), row({ row_number: 12, outcome: "SKIP_EXISTING", created_id: "" })]),
      ),
    );

    renderAt("/imports/7");

    expect(await screen.findByText("203 students added")).toBeInTheDocument();
    expect(
      screen.getByText(/5 students already in KukGrade were skipped and not changed\. 4 rows you left out were not imported\./),
    ).toBeInTheDocument();
    expect(await screen.findByText("5 students with your fixes")).toBeInTheDocument();
    expect(screen.getByText("“Parent phone” kept")).toBeInTheDocument();
    expect(await screen.findByText("2 students given the status Active")).toBeInTheDocument();
    expect(api.getDataImportRows).toHaveBeenCalledWith(7, { outcome: "READY", filled: "status", page_size: 1 });
    expect(screen.getByRole("link", { name: "Open Mia Reynolds" })).toHaveAttribute("href", "/students/31");
    expect(screen.getByText("Already in KukGrade", { selector: ".ix-pill" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Students" })).toHaveAttribute(
      "href",
      "/students?source_import=7",
    );

    await user.click(screen.getByRole("button", { name: "See the 5" }));
    await waitFor(() =>
      expect(api.getDataImportRows).toHaveBeenLastCalledWith(
        7,
        expect.objectContaining({ corrected: true, page_size: 50 }),
      ),
    );
    expect(screen.getByRole("button", { name: "Your fixes" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says when the row-by-row list has been cleared", async () => {
    api.getDataImportBatch.mockResolvedValue(roster);
    api.getDataImportRows.mockResolvedValue(page([], 0));

    renderAt("/imports/7");

    expect(await screen.findByText(/this one’s has been cleared/)).toBeInTheDocument();
  });

  describe("of past gradings", () => {
    const gradings = batch({
      kind: "LEGACY_GRADINGS",
      original_filename: "grading-record-2025.xlsx",
      status: "COMMITTED",
      status_display: "Imported",
      next_step: "CLOSED",
      committed_at: "2026-10-20T10:24:00Z",
      committed_by_name: "Sam Taylor",
      summary_json: { total: 229, excluded: 2, unresolved_current_rank: 1, unresolved_testing_for_rank: 2 },
    });

    beforeEach(() => {
      api.getDataImportBatch.mockResolvedValue(gradings);
      api.getDataImportRows.mockResolvedValue(page([]));
      api.getLegacyGradingRecords.mockResolvedValue(page([], 196));
    });

    it("links a name's records to the suggested student, and can undo it", async () => {
      const user = userEvent.setup();
      api.getLegacyPeople.mockResolvedValue(page([person()], 61));
      api.bulkLinkLegacyRecords.mockResolvedValue([]);
      api.unlinkLegacyGradingRecord.mockResolvedValue({});

      renderAt("/imports/7");

      expect(await screen.findByText("229 historical records imported")).toBeInTheDocument();
      expect(await screen.findByText("“Mia R” · 3 records")).toBeInTheDocument();
      expect(screen.getByText("Mia Reynolds · Yellow")).toBeInTheDocument();
      expect(api.getLegacyPeople).toHaveBeenCalledWith({ batch: 7, linked: false, page_size: 4 });
      await user.click(screen.getByRole("button", { name: "Link all 3: “Mia R” to Mia Reynolds" }));

      await waitFor(() =>
        expect(api.bulkLinkLegacyRecords).toHaveBeenCalledWith([
          { record: 101, student: 31 },
          { record: 102, student: 31 },
          { record: 103, student: 31 },
        ]),
      );
      expect(await screen.findByText("✓ Linked to Mia Reynolds")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Undo linking “Mia R”" }));
      await waitFor(() => expect(api.unlinkLegacyGradingRecord).toHaveBeenCalledTimes(3));
    });

    it("asks a person to choose where students share a name", async () => {
      const user = userEvent.setup();
      const theo = person({
        source_name: "Theo",
        record_ids: [201],
        records: 1,
        shared: true,
        candidates: [
          { ...person().candidates[0], student: 40, full_name: "Theo Barker", current_rank_name: "Blue stripe" },
          { ...person().candidates[0], student: 41, full_name: "Theo Lane", current_rank_name: "White" },
        ],
      });
      api.getLegacyPeople.mockResolvedValue(page([theo]));
      api.bulkLinkLegacyRecords.mockResolvedValue([]);

      renderAt("/imports/7");
      await user.click(await screen.findByRole("button", { name: "Theo Lane · White" }));

      await waitFor(() =>
        expect(api.bulkLinkLegacyRecords).toHaveBeenCalledWith([{ record: 201, student: 41 }]),
      );
    });

    it("voids a wrong workbook only with a reason", async () => {
      const user = userEvent.setup();
      api.getLegacyPeople.mockResolvedValue(page([]));
      api.voidDataImportRecords.mockResolvedValue({ voided: 229 });

      renderAt("/imports/7");
      await user.click(await screen.findByRole("button", { name: "Void this import" }));
      const dialog = screen.getByRole("dialog");
      const confirm = within(dialog).getByRole("button", { name: "Void every record" });
      expect(confirm).toBeDisabled();
      await user.type(within(dialog).getByLabelText("Why"), "The wrong year's workbook");
      await user.click(confirm);

      await waitFor(() =>
        expect(api.voidDataImportRecords).toHaveBeenCalledWith(7, "The wrong year's workbook"),
      );
    });

    it("leaves linking to administrators", async () => {
      auth.user = { ...authUser, can_import_data: true };

      renderAt("/imports/7");

      expect(await screen.findByText("An administrator links these records to students.")).toBeInTheDocument();
      expect(api.getLegacyPeople).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Void this import" })).not.toBeInTheDocument();
    });
  });

  it("says plainly that a cancelled import saved nothing", async () => {
    api.getDataImportBatch.mockResolvedValue(
      batch({ status: "CANCELLED", status_display: "Cancelled", next_step: "CLOSED" }),
    );

    renderAt("/imports/7");

    expect(await screen.findByText("This import was cancelled. Nothing was saved.")).toBeInTheDocument();
  });

  it("says when an import is not there", async () => {
    api.getDataImportBatch.mockRejectedValue(new ApiError("Not found", 404));

    renderAt("/imports/7");

    expect(await screen.findByRole("heading", { name: "Import not found" })).toBeInTheDocument();
  });
});
