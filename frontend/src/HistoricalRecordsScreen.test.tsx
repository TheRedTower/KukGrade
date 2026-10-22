import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HistoricalRecordsScreen } from "./HistoricalRecordsScreen";
import { legacyRecord, page, RANKS } from "./importTestFixtures";

const api = vi.hoisted(() => ({
  getAllDataImportBatches: vi.fn(),
  getLegacyGradingRecords: vi.fn(),
  getLegacyGradingRecord: vi.fn(),
  getRanks: vi.fn(),
  getStudents: vi.fn(),
  linkLegacyGradingRecord: vi.fn(),
  unlinkLegacyGradingRecord: vi.fn(),
  resolveLegacyCurrentRank: vi.fn(),
  resolveLegacyTestingForRank: vi.fn(),
  voidLegacyGradingRecord: vi.fn(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, ...Object.fromEntries(Object.keys(api).map((name) => [name, (...args: unknown[]) => api[name as keyof typeof api](...args)])) };
});

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<HistoricalRecordsScreen />} path="/imports/history/:id?" />
        <Route element={<h1>Imports</h1>} path="/imports" />
        <Route element={<h1>Linking</h1>} path="/imports/records" />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>);
}

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.getAllDataImportBatches.mockResolvedValue(page([]));
  api.getLegacyGradingRecords.mockResolvedValue(page([legacyRecord()]));
  api.getLegacyGradingRecord.mockResolvedValue(legacyRecord());
  api.getRanks.mockResolvedValue(page(RANKS));
  api.getStudents.mockResolvedValue(page([{ id: 32, first_name: "Mia", last_name: "Reynolds", current_rank_name: "Blue", wksa_id: "206-2-032" }]));
});

describe("Historical record recovery", () => {
  it("opens a linked record after a direct load and confirms replacement", async () => {
    const user = userEvent.setup();
    api.getLegacyGradingRecord.mockResolvedValue(legacyRecord({ student: 31, student_display_name: "Wrong Student" }));
    api.linkLegacyGradingRecord.mockResolvedValue(legacyRecord({ student: 32, student_display_name: "Mia Reynolds" }));
    renderAt("/imports/history/101?filter=linked");

    expect(await screen.findByText(/Linked student:/)).toHaveTextContent("Wrong Student");
    expect(api.getLegacyGradingRecords).toHaveBeenCalledWith(expect.objectContaining({ linked: true, voided: false }));
    await user.type(screen.getByPlaceholderText("Search every student"), "Mia");
    await user.click(await screen.findByRole("button", { name: /Mia Reynolds · Blue/ }));
    await user.click(screen.getByRole("button", { name: "Change linked student" }));
    expect(api.linkLegacyGradingRecord).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Replace link" }));
    await waitFor(() => expect(api.linkLegacyGradingRecord).toHaveBeenCalledWith(101, 32, true));
  });

  it("can clear a mapped rank and unlink a record from its persistent detail", async () => {
    const user = userEvent.setup();
    api.getLegacyGradingRecord.mockResolvedValue(legacyRecord({ student: 31, student_display_name: "Wrong Student" }));
    api.resolveLegacyCurrentRank.mockResolvedValue(legacyRecord({ current_rank: null }));
    api.unlinkLegacyGradingRecord.mockResolvedValue(legacyRecord());
    renderAt("/imports/history/101");

    await user.selectOptions(await screen.findByLabelText(/Held rank/), "");
    await waitFor(() => expect(api.resolveLegacyCurrentRank).toHaveBeenCalledWith(101, null));
    await user.click(screen.getByRole("button", { name: "Unlink student…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Unlink student" }));
    await waitFor(() => expect(api.unlinkLegacyGradingRecord).toHaveBeenCalledWith(101));
  });

  it("shows a voided record and its reason after a direct load", async () => {
    api.getLegacyGradingRecord.mockResolvedValue(legacyRecord({ is_void: true, void_reason: "Duplicate row" }));
    renderAt("/imports/history/101?filter=voided");

    expect(await screen.findByText(/Voided: Duplicate row/)).toBeInTheDocument();
    expect(api.getLegacyGradingRecords).toHaveBeenCalledWith(expect.objectContaining({ voided: true }));
    expect(screen.queryByRole("button", { name: "Link to selected student" })).not.toBeInTheDocument();
  });
});
