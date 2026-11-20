import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import { page } from "./appTestSupport";
import { HistoricalRecordScreen } from "./HistoricalRecordScreen";
import { HistoricalRecordsScreen } from "./HistoricalRecordsScreen";
import { legacyRecord, RANKS } from "./importTestFixtures";

// Made-up names throughout.

const api = vi.hoisted(() => ({
  getAllDataImportBatches: vi.fn(),
  getLegacyGradingRecords: vi.fn(),
  getLegacyGradingRecord: vi.fn(),
  getRanks: vi.fn(),
  resolveLegacyRank: vi.fn(),
  voidLegacyGradingRecord: vi.fn(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    ...Object.fromEntries(
      Object.keys(api).map((name) => [name, (...args: unknown[]) => api[name as keyof typeof api](...args)]),
    ),
  };
});

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
          <Route element={<HistoricalRecordsScreen />} path="/imports/history" />
          <Route element={<HistoricalRecordScreen />} path="/imports/history/:id" />
          <Route element={<h1>People</h1>} path="/imports/people" />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const where = () => screen.getByTestId("where").textContent;

const linked = legacyRecord({
  id: 101,
  student: 31,
  student_display_name: "Mia Reyes",
  current_rank: 3,
  current_rank_name: "Yellow",
  report: "Good stances.\nKeep the guard up.",
});

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.getAllDataImportBatches.mockResolvedValue(page([]));
  api.getLegacyGradingRecords.mockResolvedValue(page([linked]));
  api.getLegacyGradingRecord.mockResolvedValue(linked);
  api.getRanks.mockResolvedValue(page(RANKS));
});

describe("Historical records", () => {
  it("lists each record as a card that opens its own page, keeping the filters", async () => {
    const user = userEvent.setup();
    renderAt("/imports/history?filter=linked&search=mia");

    const records = await screen.findByRole("list", { name: "Records" });
    const card = within(records).getByRole("link");
    expect(card).toHaveTextContent("Mia Reyes · Yellow");
    expect(api.getLegacyGradingRecords).toHaveBeenCalledWith(
      expect.objectContaining({ search: "mia", linked: true, voided: false, page: 1 }),
    );
    await user.click(card);
    expect(where()).toBe("/imports/history/101?filter=linked&search=mia");
  });

  it("says when nothing matches", async () => {
    api.getLegacyGradingRecords.mockResolvedValue(page([]));
    renderAt("/imports/history");

    expect(await screen.findByText("No records match these filters.")).toBeVisible();
  });
});

describe("A historical record", () => {
  it("shows the workbook's text in full, the ranks read, and who it is about", async () => {
    renderAt("/imports/history/101?filter=linked");

    expect(await screen.findByRole("heading", { name: /Mia R/ })).toBeVisible();
    expect(screen.getByText(/Good stances\.\s+Keep the guard up\./)).toBeVisible();
    expect(screen.getByRole("link", { name: "Mia Reyes" })).toHaveAttribute("href", "/students/31");
    expect(screen.getByRole("link", { name: "Open their person" })).toHaveAttribute("href", "/imports/people/201");
    expect(screen.getByRole("link", { name: /Historical records/ })).toHaveAttribute(
      "href",
      "/imports/history?filter=linked",
    );
  });

  it("corrects a rank from the belts, or clears it", async () => {
    const user = userEvent.setup();
    api.resolveLegacyRank.mockResolvedValue(linked);
    renderAt("/imports/history/101");

    await user.click(await screen.findByText("Correct the ranks"));
    const held = screen.getByRole("group", { name: /Rank held/ });
    expect(within(held).getByRole("button", { name: "Yellow" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(held).getByRole("button", { name: "Blue" }));
    expect(api.resolveLegacyRank).toHaveBeenCalledWith(101, "current_rank", 5);
    await user.click(within(held).getByRole("button", { name: "No rank" }));
    await waitFor(() => expect(api.resolveLegacyRank).toHaveBeenLastCalledWith(101, "current_rank", null));
  });

  it("voids a record only with a reason", async () => {
    const user = userEvent.setup();
    api.voidLegacyGradingRecord.mockResolvedValue({ ...linked, is_void: true });
    renderAt("/imports/history/101");

    await user.click(await screen.findByRole("button", { name: "Void this record" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Void the record" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Why"), "Entered twice");
    await user.click(confirm);

    expect(api.voidLegacyGradingRecord).toHaveBeenCalledWith(101, "Entered twice");
  });

  it("shows a voided record and why, with nothing left to correct", async () => {
    api.getLegacyGradingRecord.mockResolvedValue(
      legacyRecord({ is_void: true, void_reason: "Entered twice", voided_by_name: "Sam Taylor" }),
    );
    renderAt("/imports/history/101");

    expect(await screen.findByText("Entered twice · Sam Taylor")).toBeVisible();
    expect(screen.queryByText("Correct the ranks")).toBeNull();
    expect(screen.queryByRole("button", { name: "Void this record" })).toBeNull();
  });

  it("says when the record is not there", async () => {
    api.getLegacyGradingRecord.mockRejectedValue(new ApiError("Not found.", 404));
    renderAt("/imports/history/999");

    expect(await screen.findByText("Record not found")).toBeVisible();
  });
});
