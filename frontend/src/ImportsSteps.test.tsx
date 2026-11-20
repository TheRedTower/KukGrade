import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type AuthUser, type DataImportBatch, type DataImportRow } from "./api";
import { ADMINISTRATOR_CAPABILITIES, authUser, CHOICES, page, SITE } from "./appTestSupport";
import { ImportScreen } from "./ImportScreen";
import { batch, RANKS, row } from "./importTestFixtures";

const api = vi.hoisted(() => ({
  getDataImportBatch: vi.fn(),
  getDataImportBatches: vi.fn(),
  getAllDataImportBatches: vi.fn(),
  getDataImportRows: vi.fn(),
  getDataImportRow: vi.fn(),
  saveDataImportMapping: vi.fn(),
  correctDataImportRow: vi.fn(),
  setDataImportRowExcluded: vi.fn(),
  leaveOutDataImportRowsNeedingAttention: vi.fn(),
  commitDataImport: vi.fn(),
  getRanks: vi.fn(),
  getChoices: vi.fn(),
  getSiteSettings: vi.fn(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  const mocked = Object.fromEntries(
    Object.keys(api).map((name) => [name, (...args: unknown[]) => api[name as keyof typeof api](...args)]),
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
  api.getChoices.mockResolvedValue(CHOICES);
  api.getSiteSettings.mockResolvedValue(SITE);
});

describe("Matching a roster's columns", () => {
  const fresh = batch({ next_step: "MATCH", suggested_mapping: MAPPING });
  const saved = batch({
    next_step: "REVIEW",
    suggested_mapping: MAPPING,
    column_mapping: MAPPING,
    uncovered_fields: ["current_rank"],
  });
  const rows = [
    row({
      row_number: 2,
      cells: {
        "WKSA No": "104-2-311",
        First: "Mia",
        Surname: "Reynolds",
        DOB: "14/03/2015",
        Belt: "Yellow",
        "Parent phone": "07700 900123",
        Joined: "Sep 2021",
      },
      values: {
        wksa_id: "104-2-311",
        first_name: "Mia",
        last_name: "Reynolds",
        date_of_birth: "14/03/2015",
        current_rank: "",
        status: "ACTIVE",
      },
      file_values: { date_of_birth: "14/03/2015" },
      outcome: "REVIEW_REQUIRED",
      outcome_display: "Needs attention",
      issues: ["Current rank is required."],
      issue_fields: ["current_rank"],
    }),
    row({
      row_number: 4,
      cells: {
        "WKSA No": "104-2-318",
        First: "Priya",
        Surname: "Shah",
        DOB: "31/02/2010",
        Belt: "Red",
        "Parent phone": "",
        Joined: "",
      },
      values: {
        wksa_id: "104-2-318",
        first_name: "Priya",
        last_name: "Shah",
        date_of_birth: "31/02/2010",
        current_rank: "",
        status: "ACTIVE",
      },
      file_values: { date_of_birth: "31/02/2010" },
      outcome: "REVIEW_REQUIRED",
      outcome_display: "Needs attention",
      issues: ["Date of birth '31/02/2010' is not a valid date."],
      issue_fields: ["date_of_birth", "current_rank"],
    }),
  ];

  it("saves the suggested columns straight away and reads the first rows with them", async () => {
    api.getDataImportBatch.mockResolvedValueOnce(fresh).mockResolvedValue(saved);
    api.saveDataImportMapping.mockResolvedValue(saved);
    api.getDataImportRows.mockResolvedValue(page(rows, 212));

    renderAt("/imports/7?step=match");

    expect(await screen.findByRole("heading", { name: "Match your columns" })).toBeInTheDocument();
    await waitFor(() =>
      expect(api.saveDataImportMapping).toHaveBeenCalledWith(7, {
        column_mapping: MAPPING,
        defaults: {},
        extra_columns: [],
      }),
    );
    const columns = await screen.findByRole("list", { name: "Your file's columns" });
    expect(await within(columns).findByText("104-2-311, 104-2-318")).toBeInTheDocument();
    expect(within(columns).getByLabelText("What “DOB” holds")).toHaveValue("date_of_birth");
    expect(screen.getByText(/of 212 rows ready/)).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Things to check");
  });

  it("keeps a field chosen for two columns from being saved, and says why", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(saved);
    api.saveDataImportMapping.mockResolvedValue(saved);
    api.getDataImportRows.mockResolvedValue(page(rows));

    renderAt("/imports/7?step=match");
    await user.selectOptions(await screen.findByLabelText("What “Joined” holds"), "first_name");

    expect(screen.getByText("First name is chosen for two columns.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
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

  it("offers one rank for everyone when no column holds it", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(saved);
    api.saveDataImportMapping.mockResolvedValue(saved);
    api.getDataImportRows.mockResolvedValue(page(rows));

    renderAt("/imports/7?step=match");
    expect(await screen.findByText("No column holds rank.")).toBeInTheDocument();
    await screen.findByRole("option", { name: "White" });
    await user.selectOptions(screen.getByLabelText("Same for everyone"), "White");
    await waitFor(() =>
      expect(api.saveDataImportMapping).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ defaults: { current_rank: "White" } }),
      ),
    );
    expect(screen.getByText(/Rank for everyone:/)).toBeInTheDocument();
  });

  it("blocks review after a rejected mapping save and retries the visible choices", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(saved);
    api.getDataImportRows.mockResolvedValue(page(rows));
    api.saveDataImportMapping.mockRejectedValueOnce(new Error("Save failed")).mockResolvedValue(saved);

    renderAt("/imports/7?step=match");
    await user.selectOptions(await screen.findByLabelText("What “Joined” holds"), "extra");
    expect(await screen.findByRole("alert")).toHaveTextContent("The columns could not be saved");
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Retry saving columns" }));
    await waitFor(() => expect(api.saveDataImportMapping).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
    expect(api.saveDataImportMapping).toHaveBeenLastCalledWith(7, {
      column_mapping: MAPPING,
      defaults: {},
      extra_columns: ["Joined"],
    });
  });

  it("serializes a slow mapping save and keeps review closed until acknowledgement", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(saved);
    api.getDataImportRows.mockResolvedValue(page(rows));
    let acknowledge!: (value: DataImportBatch) => void;
    api.saveDataImportMapping.mockImplementation(
      () =>
        new Promise<DataImportBatch>((resolve) => {
          acknowledge = resolve;
        }),
    );

    renderAt("/imports/7?step=match");
    await user.selectOptions(await screen.findByLabelText("What “Joined” holds"), "extra");
    expect(screen.getByLabelText("What “First” holds")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
    expect(api.saveDataImportMapping).toHaveBeenCalledTimes(1);
    acknowledge(saved);
    await waitFor(() => expect(screen.getByLabelText("What “First” holds")).toBeEnabled());
    expect(api.saveDataImportMapping).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  });

  it("reopens with the persisted extra-column choice and no duplicate save", async () => {
    api.getDataImportBatch.mockResolvedValue(batch({ ...saved, extra_columns: ["Joined"] }));
    api.getDataImportRows.mockResolvedValue(page(rows));

    renderAt("/imports/7?step=match");
    expect(await screen.findByLabelText("What “Joined” holds")).toHaveValue("extra");
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
    expect(api.saveDataImportMapping).not.toHaveBeenCalled();
  });
});

describe("Checking, fixing and saving a roster", () => {
  const needing = batch({
    next_step: "REVIEW",
    column_mapping: { ...MAPPING, current_rank: "Belt" },
    row_counts: { total: 212, ready: 198, review_required: 2, skip_existing: 5, excluded: 7, sheet_left_out: 0 },
  });
  const sorted = batch({
    ...needing,
    row_counts: { total: 212, ready: 203, review_required: 0, skip_existing: 5, excluded: 4, sheet_left_out: 0 },
    next_step: "CONFIRM",
    review_step: "CONFIRM",
    extra_columns: ["Parent phone"],
  });
  const attention = row({
    row_number: 6,
    outcome: "REVIEW_REQUIRED",
    outcome_display: "Needs attention",
    values: {
      wksa_id: "",
      first_name: "Ella",
      last_name: "Moss",
      date_of_birth: "30/05/2016",
      current_rank: "Purple",
      status: "ACTIVE",
    },
    issues: ["WKSA ID: This field cannot be blank.", "Rank 'Purple' is not a rank KukGrade recognises."],
    issue_fields: ["current_rank", "wksa_id"],
  });
  const later = row({
    ...attention,
    row_number: 9,
    values: { ...attention.values, first_name: "Noah", last_name: "Finch" },
  });

  function rowsNeedingAFix(...list: DataImportRow[]) {
    api.getDataImportRows.mockImplementation((_id: number, params: { outcome?: string }) =>
      Promise.resolve(params.outcome === "REVIEW_REQUIRED" ? page(list) : page([])),
    );
    api.getDataImportRow.mockImplementation((_id: number, number: number) =>
      Promise.resolve(list.find((item) => item.row_number === number) ?? attention),
    );
  }

  it("lists the columns to match and the rows to fix, each opening its own page", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(needing);
    rowsNeedingAFix(attention, later);

    renderAt("/imports/7");

    const checks = await screen.findByRole("list", { name: "Things to check" });
    expect(within(checks).getByRole("link", { name: /Match the columns/ })).toHaveTextContent("5 columns matched");
    expect(within(checks).getByRole("link", { name: /Rows to fix/ })).toHaveTextContent("2 rows need a fix");
    expect(screen.getByText("210 of 212 rows sorted")).toBeInTheDocument();
    await user.click(within(checks).getByRole("link", { name: /Rows to fix/ }));
    // The first row to fix is pinned into the address, so fixing it never moves the page on.
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/imports/7?step=row&row=6"));
  });

  it("fixes a row on its own page, then goes on to the next", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(needing);
    rowsNeedingAFix(attention, later);
    api.correctDataImportRow.mockResolvedValue({ ...attention, outcome: "READY" });

    renderAt("/imports/7?step=row&row=6");

    expect(await screen.findByRole("heading", { name: "Row 6 · Ella Moss" })).toBeInTheDocument();
    expect(screen.getByLabelText("WKSA ID, row 6")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("option", { name: "Purple (not recognised)" })).toBeInTheDocument();
    await screen.findByRole("option", { name: "White" });
    await user.selectOptions(screen.getByLabelText("Rank, row 6"), "White");
    await waitFor(() => expect(api.correctDataImportRow).toHaveBeenCalledWith(7, 6, { current_rank: "White" }));

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/imports/7?step=row&row=9");
    expect(await screen.findByRole("heading", { name: "Row 9 · Noah Finch" })).toBeInTheDocument();
  });

  it("holds Next back while a fix is unsaved or saving", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(needing);
    rowsNeedingAFix(attention, later);
    let acknowledge!: (value: DataImportRow) => void;
    api.correctDataImportRow.mockImplementation(
      () =>
        new Promise<DataImportRow>((resolve) => {
          acknowledge = resolve;
        }),
    );

    renderAt("/imports/7?step=row&row=6");
    const input = await screen.findByLabelText("First name, row 6");
    await user.clear(input);
    await user.type(input, "Elle");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.tab();
    expect(api.correctDataImportRow).toHaveBeenCalledWith(7, 6, { first_name: "Elle" });
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await act(async () => acknowledge(attention));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
  });

  it("leaves a row out from its page, and says when none is left to fix", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(needing);
    rowsNeedingAFix(attention);
    api.setDataImportRowExcluded.mockResolvedValue({ ...attention, excluded: true, outcome: "EXCLUDED" });

    renderAt("/imports/7?step=row&row=6");
    await user.click(await screen.findByRole("button", { name: "Leave this row out, row 6" }));
    await waitFor(() => expect(api.setDataImportRowExcluded).toHaveBeenCalledWith(7, 6, true));
    expect(screen.getByRole("button", { name: "Back to things to check" })).toBeInTheDocument();

    rowsNeedingAFix();
    renderAt("/imports/7?step=row");
    expect(await screen.findByText("Nothing left to fix.")).toBeInTheDocument();
  });

  it("finds every row by what it will be, each opening its page and back with the filters kept", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(sorted);
    const ready = row({ row_number: 4, values: { ...attention.values, first_name: "Priya", last_name: "Shah" } });
    api.getDataImportRows.mockResolvedValue(page([ready]));
    api.getDataImportRow.mockResolvedValue(ready);

    renderAt("/imports/7?step=rows");
    await user.click(await screen.findByRole("button", { name: /Already in KukGrade/ }));
    await waitFor(() =>
      expect(api.getDataImportRows).toHaveBeenLastCalledWith(
        7,
        expect.objectContaining({ outcome: "SKIP_EXISTING", page: 1 }),
      ),
    );
    await user.click(await screen.findByRole("link", { name: /Row 4 · Priya Shah/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/imports/7?step=row&show=SKIP_EXISTING&row=4&from=rows");
    expect(await screen.findByLabelText("First name, row 4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Every row/ })).toHaveAttribute(
      "href",
      "/imports/7?step=rows&show=SKIP_EXISTING",
    );
  });

  it("holds the save until every row is fixed or left out", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(needing);
    api.leaveOutDataImportRowsNeedingAttention.mockResolvedValue(sorted);

    renderAt("/imports/7?step=save");

    expect(await screen.findByText("2 rows still need a fix")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add 198 students" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Leave out the 2 left" }));
    await waitFor(() => expect(api.leaveOutDataImportRowsNeedingAttention).toHaveBeenCalledWith(7));
    await user.click(screen.getByRole("button", { name: "Fix them" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/imports/7?step=row");
  });

  it("adds the students in one go and shows what the import did", async () => {
    const user = userEvent.setup();
    const committed: DataImportBatch = {
      ...sorted,
      status: "COMMITTED",
      status_display: "Imported",
      next_step: "RESULTS",
      committed_by_name: "Sam Taylor",
      committed_at: "2026-10-20T10:18:00Z",
      summary_json: { total: 212, created: 203, skipped_existing: 5, excluded: 4, sheet_left_out: 0 },
    };
    api.getDataImportBatch.mockResolvedValueOnce(sorted).mockResolvedValue(committed);
    api.getDataImportRows.mockResolvedValue(page([]));
    api.commitDataImport.mockResolvedValue(committed);

    renderAt("/imports/7?step=save");

    expect(await screen.findByRole("heading", { name: "Add 203 students" })).toBeInTheDocument();
    expect(screen.getByText("5 rows already in KukGrade are skipped")).toBeInTheDocument();
    expect(screen.getByText("4 rows you left out")).toBeInTheDocument();
    expect(screen.getByText("“Parent phone” kept as extra information")).toBeInTheDocument();
    expect(await screen.findByRole("listitem", { current: "step" })).toHaveTextContent("Save");
    await user.click(screen.getByRole("button", { name: "Add 203 students" }));

    await waitFor(() => expect(api.commitDataImport).toHaveBeenCalledWith(7));
    expect(await screen.findByText("203 students added")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/imports\/7$/);
  });

  it("says nothing was saved when the import is refused", async () => {
    const user = userEvent.setup();
    api.getDataImportBatch.mockResolvedValue(sorted);
    api.commitDataImport.mockRejectedValue(
      new ApiError("Invalid", 400, "validation_error", {
        non_field_errors: ["Row 5: the WKSA ID 104-2-205 was taken since the check."],
      }),
    );

    renderAt("/imports/7?step=save");
    await user.click(await screen.findByRole("button", { name: "Add 203 students" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nothing was saved. Row 5: the WKSA ID 104-2-205 was taken since the check.",
    );
  });
});
