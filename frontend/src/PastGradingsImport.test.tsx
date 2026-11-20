import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type AuthUser, type LegacyCheck, type LegacySheet } from "./api";
import { ADMINISTRATOR_CAPABILITIES, authUser, CHOICES, page, SITE } from "./appTestSupport";
import { ImportScreen } from "./ImportScreen";
import { ImportStartScreen } from "./ImportStartScreen";
import { batch, RANKS, row } from "./importTestFixtures";

// Invented workbooks and people throughout.

const api = vi.hoisted(() => ({
  getDataImportBatch: vi.fn(),
  getLegacySheets: vi.fn(),
  chooseLegacySheets: vi.fn(),
  cancelDataImportBatch: vi.fn(),
  getLegacyChecksSummary: vi.fn(),
  getAllLegacyChecks: vi.fn(),
  resolveLegacyCheck: vi.fn(),
  getDataImportRows: vi.fn(),
  setDataImportRowExcluded: vi.fn(),
  commitDataImport: vi.fn(),
  getImportStarts: vi.fn(),
  createDataImportBatch: vi.fn(),
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

const workbook = batch({
  kind: "LEGACY_GRADINGS",
  kind_display: "Past gradings",
  next_step: "MATCH",
  review_step: "CONFIRM",
  original_filename: "riverside-gradings.xlsx",
  grading_sheets: ["03-2024", "06-2024", "11-2022"],
  row_counts: { total: 12, ready: 7, review_required: 0, skip_existing: 2, excluded: 1, sheet_left_out: 2 },
});

function sheet(overrides: Partial<LegacySheet>): LegacySheet {
  return {
    name: "03-2024",
    cycle_year: 2024,
    cycle_month: 3,
    records: 5,
    included: true,
    state: "NEW",
    state_display: "New",
    held_by: [],
    added: [],
    removed: [],
    added_count: 0,
    removed_count: 0,
    ...overrides,
  };
}

const SHEETS = [
  sheet({}),
  sheet({ name: "06-2024", cycle_month: 6, records: 2 }),
  sheet({
    name: "11-2022",
    cycle_year: 2022,
    cycle_month: 11,
    records: 3,
    included: false,
    state: "CHANGED",
    state_display: "Changed since imported",
    held_by: [3],
    added: [{ name: "Nina Holt", current_rank: "White", testing_for_rank: "Yellow stripe", outcome: "Pass" }],
    added_count: 1,
  }),
];

const owen = row({
  row_number: 3,
  source_locator: "03-2024!R3",
  values: { name: "Owen Pratt", current_rank: "Bown Stripe", testing_for_rank: "Brown", outcome: "Pass" },
});
const tess = [4, 5].map((number) =>
  row({
    row_number: number,
    source_locator: `03-2024!R${number + 1}`,
    values: { name: "Tess Dale", current_rank: "Yellow", testing_for_rank: "Blue stripe", outcome: "Pass" },
  }),
);

function check(overrides: Partial<LegacyCheck>): LegacyCheck {
  return {
    key: "RANK:bown stripe",
    kind: "RANK",
    kind_display: "Rank to read",
    message: "KukGrade cannot read the rank “Bown Stripe”.",
    text: "Bown Stripe",
    suggested_rank_code: null,
    is_open: true,
    decision: null,
    decision_display: null,
    rank_code: null,
    outcome: null,
    row_count: 1,
    rows: [owen],
    rows_to_leave_out: [],
    decisions: [
      { value: "RANK", label: "Rank chosen" },
      { value: "KEEP", label: "Kept as written" },
    ],
    ...overrides,
  };
}

const SUMMARY = {
  checks: 3,
  open: 2,
  kinds: [
    { kind: "RANK" as const, kind_display: "Rank to read", checks: 2, open: 1 },
    { kind: "OUTCOME" as const, kind_display: "Outcome to read", checks: 0, open: 0 },
    { kind: "WRITTEN_TWICE" as const, kind_display: "On one sheet twice", checks: 1, open: 1 },
  ],
  warnings: ["Unknown sheet 'Scratch notes' was not imported."],
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
          <Route element={<ImportStartScreen />} path="/imports/new" />
          <Route element={<ImportScreen />} path="/imports/:id" />
          <Route element={<h1>Imports hub</h1>} path="/imports" />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const where = () => screen.getByTestId("where").textContent;

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  auth.user = { ...authUser, ...ADMINISTRATOR_CAPABILITIES };
  api.getRanks.mockResolvedValue(page(RANKS));
  api.getChoices.mockResolvedValue(CHOICES);
  api.getSiteSettings.mockResolvedValue(SITE);
  api.getDataImportBatch.mockResolvedValue(workbook);
  api.getLegacySheets.mockResolvedValue(SHEETS);
  api.getLegacyChecksSummary.mockResolvedValue(SUMMARY);
  api.getImportStarts.mockResolvedValue([
    { kind: "STUDENT_ROSTER", why_not: null },
    { kind: "LEGACY_GRADINGS", why_not: null },
  ]);
});

describe("Starting an import of past gradings", () => {
  it("asks for the students first while there are none", async () => {
    api.getImportStarts.mockResolvedValue([
      { kind: "STUDENT_ROSTER", why_not: null },
      { kind: "LEGACY_GRADINGS", why_not: "Import your students first." },
    ]);

    renderAt("/imports/new?kind=LEGACY_GRADINGS");

    expect(await screen.findByRole("heading", { name: "Before you start" })).toBeVisible();
    expect(screen.getByText("Import your students first.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Import students" })).toHaveAttribute(
      "href",
      "/imports/new?kind=STUDENT_ROSTER",
    );
    expect(screen.queryByRole("button", { name: "Choose a file" })).toBeNull();
  });

  it("goes straight on to what KukGrade found once the workbook is read", async () => {
    const user = userEvent.setup();
    api.createDataImportBatch.mockResolvedValue({ ...workbook, already_imported_warning: true });

    renderAt("/imports/new?kind=LEGACY_GRADINGS");
    await screen.findByRole("button", { name: "Choose a file" });
    const file = new File(["x"], "riverside-gradings.xlsx");
    await user.upload(screen.getByLabelText("Choose a file"), file);

    await waitFor(() => expect(where()).toBe("/imports/7"));
    expect(await screen.findByText("This exact file has been imported before")).toBeVisible();
  });
});

describe("Choosing the sheets", () => {
  it("ticks the new sheets, says what a changed one holds, and chooses another", async () => {
    const user = userEvent.setup();
    api.chooseLegacySheets.mockResolvedValue(SHEETS.map((each) => ({ ...each, included: true })));

    renderAt("/imports/7");

    const changed = await screen.findByRole("checkbox", { name: /11-2022/ });
    expect(screen.getByRole("checkbox", { name: /03-2024/ })).toBeChecked();
    expect(changed).not.toBeChecked();
    expect(screen.getByText("Changed since imported")).toBeVisible();
    await user.click(screen.getByText(/What differs: 1 new/));
    expect(screen.getByText("New: Nina Holt · White → Yellow stripe · Pass")).toBeVisible();
    expect(screen.getByText("7 records from 2 sheets will come in")).toBeVisible();

    await user.click(changed);
    expect(api.chooseLegacySheets).toHaveBeenCalledWith(7, ["03-2024", "06-2024", "11-2022"]);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(where()).toBe("/imports/7?step=checks");
  });
});

describe("The things to check", () => {
  it("shows a queue for each kind there is, how many are sorted, and what could not be read", async () => {
    const user = userEvent.setup();
    renderAt("/imports/7?step=checks");

    expect(await screen.findByText("1 of 3 sorted")).toBeVisible();
    const queues = screen.getByRole("list", { name: "Things to check" });
    expect(
      within(queues)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Rank to read1 of 2 sorted1", "On one sheet twice0 of 1 sorted1"]);
    expect(screen.getByText("Unknown sheet 'Scratch notes' was not imported.")).toBeVisible();
    expect(screen.getByText("2 things still open")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Continue to save" }));
    expect(where()).toBe("/imports/7?step=save");
  });

  it("says so when there is nothing to check", async () => {
    api.getLegacyChecksSummary.mockResolvedValue({ checks: 0, open: 0, kinds: [], warnings: [] });

    renderAt("/imports/7?step=checks");

    expect(await screen.findByText("Nothing to check: KukGrade reads every record.")).toBeVisible();
  });
});

describe("One thing to check", () => {
  it("chooses a rank for a spelling, keeps one as written, and goes on to the next", async () => {
    const user = userEvent.setup();
    const second = check({ key: "RANK:red stripe?", text: "Red stripe?", suggested_rank_code: "RED_STRIPE" });
    api.getAllLegacyChecks.mockResolvedValue(page([check({}), second]));
    api.resolveLegacyCheck.mockResolvedValue(check({ is_open: false, decision: "RANK", rank_code: "BROWN_STRIPE" }));

    renderAt("/imports/7?step=check&kind=RANK");

    expect(await screen.findByRole("heading", { name: "KukGrade cannot read the rank “Bown Stripe”." })).toBeVisible();
    expect(api.getAllLegacyChecks).toHaveBeenCalledWith(7, "RANK");
    expect(screen.getByText("Owen Pratt", { exact: false })).toBeVisible();
    expect(screen.getByText("Not decided yet: saved as written")).toBeVisible();

    const ranks = screen.getByRole("group", { name: "The rank “Bown Stripe” means" });
    await user.click(await within(ranks).findByRole("button", { name: "Brown stripe" }));
    expect(api.resolveLegacyCheck).toHaveBeenCalledWith(7, {
      key: "RANK:bown stripe",
      decision: "RANK",
      rank_code: "BROWN_STRIPE",
    });
    await user.click(screen.getByRole("button", { name: "Keep as written" }));
    expect(api.resolveLegacyCheck).toHaveBeenLastCalledWith(7, { key: "RANK:bown stripe", decision: "KEEP" });

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(where()).toBe("/imports/7?step=check&kind=RANK&key=RANK%3Ared+stripe%3F");
    expect(await screen.findByRole("button", { name: "Red stripe (as it reads)" })).toBeVisible();
  });

  it("leaves out one of two rows written twice", async () => {
    const user = userEvent.setup();
    api.getAllLegacyChecks.mockResolvedValue(
      page([
        check({
          key: "WRITTEN_TWICE:abc",
          kind: "WRITTEN_TWICE",
          kind_display: "On one sheet twice",
          message: "Tess Dale is written twice on 03-2024.",
          text: "",
          rows: tess,
          row_count: 2,
          rows_to_leave_out: [4, 5],
          decisions: [
            { value: "LEAVE_OUT", label: "Row left out" },
            { value: "KEEP", label: "Kept as written" },
          ],
        }),
      ]),
    );
    api.resolveLegacyCheck.mockResolvedValue(undefined);

    renderAt("/imports/7?step=check&kind=WRITTEN_TWICE");

    await user.click(await screen.findByRole("button", { name: "Leave out 03-2024 · R6" }));
    expect(api.resolveLegacyCheck).toHaveBeenCalledWith(7, {
      key: "WRITTEN_TWICE:abc",
      decision: "LEAVE_OUT",
      row_number: 5,
    });
    // The last one of its kind: the bar goes back to the list.
    await user.click(screen.getByRole("button", { name: "Back to things to check" }));
    expect(where()).toBe("/imports/7?step=checks");
  });
});

describe("Every record", () => {
  it("opens a sheet's records as written and leaves one out", async () => {
    const user = userEvent.setup();
    api.getDataImportRows.mockResolvedValue(page([owen]));
    api.setDataImportRowExcluded.mockResolvedValue({ ...owen, excluded: true });

    renderAt("/imports/7?step=records");

    await user.click(await screen.findByText("03-2024 · 5 records"));
    expect(await screen.findByText("03-2024 · R3 · Owen Pratt")).toBeVisible();
    expect(api.getDataImportRows).toHaveBeenCalledWith(7, { sheet: "03-2024", page: 1, page_size: 20 });
    // A sheet not chosen is not listed.
    expect(screen.queryByText(/11-2022/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Leave out the record for Owen Pratt" }));
    expect(api.setDataImportRowExcluded).toHaveBeenCalledWith(7, 3, true);
  });
});

describe("Saving", () => {
  it("says how many records from how many sheets, what stays out, and saves them", async () => {
    const user = userEvent.setup();
    api.commitDataImport.mockResolvedValue({ ...workbook, status: "COMMITTED" });

    renderAt("/imports/7?step=save");

    expect(await screen.findByRole("heading", { name: "Save 7 records from 2 sheets" })).toBeVisible();
    expect(screen.getByText("1 record you left out")).toBeVisible();
    expect(screen.getByText("2 records already in KukGrade are not added again")).toBeVisible();
    expect(await screen.findByText("2 things to check are saved as written")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Save records" }));
    expect(api.commitDataImport).toHaveBeenCalledWith(7);
    await waitFor(() => expect(where()).toBe("/imports/7"));
  });

  it("says nothing was saved when saving is refused", async () => {
    const user = userEvent.setup();
    api.commitDataImport.mockRejectedValue(new ApiError("Nothing to import.", 400));

    renderAt("/imports/7?step=save");
    await user.click(await screen.findByRole("button", { name: "Save records" }));

    expect(await screen.findByText("Nothing was saved.")).toBeVisible();
    expect(screen.getByText("Nothing to import.")).toBeVisible();
  });
});
