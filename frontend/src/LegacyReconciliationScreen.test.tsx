import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LegacyReconciliationScreen } from "./LegacyReconciliationScreen";
import type { LegacyGradingRecord, Rank, StudentListItem } from "./api";

const mockGetLegacyGradingRecords = vi.fn();
const mockGetRanks = vi.fn();
const mockGetStudents = vi.fn();
const mockLinkLegacyGradingRecord = vi.fn();
const mockUnlinkLegacyGradingRecord = vi.fn();
const mockResolveLegacyCurrentRank = vi.fn();
const mockVoidLegacyGradingRecord = vi.fn();

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getLegacyGradingRecords: (...args: unknown[]) => mockGetLegacyGradingRecords(...args),
    getRanks: (...args: unknown[]) => mockGetRanks(...args),
    getStudents: (...args: unknown[]) => mockGetStudents(...args),
    linkLegacyGradingRecord: (...args: unknown[]) => mockLinkLegacyGradingRecord(...args),
    unlinkLegacyGradingRecord: (...args: unknown[]) => mockUnlinkLegacyGradingRecord(...args),
    resolveLegacyCurrentRank: (...args: unknown[]) => mockResolveLegacyCurrentRank(...args),
    resolveLegacyTestingForRank: vi.fn(),
    voidLegacyGradingRecord: (...args: unknown[]) => mockVoidLegacyGradingRecord(...args),
  };
});

const yellowRank: Rank = {
  id: 3,
  code: "YELLOW",
  name: "Yellow",
  order: 3,
  category: "COLOURED_BELT",
  category_display: "Coloured belt",
  belt_colour: "YELLOW",
  stripe_colour: "",
  stripe_count: 0,
  active: true,
  next_rank: null,
};

const unlinkedRecord: LegacyGradingRecord = {
  id: 55,
  student: null,
  student_display_name: null,
  student_wksa_id: null,
  source_batch: 7,
  record_kind: "GRADING_RESULT",
  record_kind_display: "Grading result",
  source_sheet: "06-2025",
  source_section: "",
  source_locator: "06-2025!R2",
  cycle_year: 2025,
  cycle_month: 6,
  grading_date: null,
  date_precision: "MONTH",
  date_precision_display: "Month",
  source_name: "A. Example",
  source_current_rank_text: "Yellow",
  current_rank: null,
  current_rank_code: null,
  source_testing_for_rank_text: "Blue Stripe",
  testing_for_rank: null,
  testing_for_rank_code: null,
  source_outcome_text: "Pass",
  outcome: "PASS",
  outcome_display: "Pass",
  attendance_status: "ATTENDED",
  attendance_status_display: "Attended",
  comments: "",
  admin_note: "",
  is_void: false,
  void_reason: "",
  voided_by: null,
  voided_by_email: null,
  voided_at: null,
  created_at: "2026-09-22T10:00:00Z",
  updated_at: "2026-09-22T10:00:00Z",
};

const studentResult: StudentListItem = {
  id: 42,
  wksa_id: "UK-1234",
  first_name: "Alex",
  last_name: "Kim",
  current_rank: 3,
  current_rank_code: "YELLOW",
  current_rank_name: "Yellow",
  status: "ACTIVE",
  can_be_graded: true,
  status_display: "Active",
  age_band: "AGE_9_TO_12",
  age_band_display: "9-12",
};

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/gradings/legacy-records"]}>
        <Routes>
          <Route path="/gradings/legacy-records" element={<LegacyReconciliationScreen />} />
          <Route path="/gradings" element={<h1>Gradings reached</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LegacyReconciliationScreen", () => {
  beforeEach(() => {
    mockGetLegacyGradingRecords.mockReset();
    mockGetRanks.mockReset();
    mockGetStudents.mockReset();
    mockLinkLegacyGradingRecord.mockReset();
    mockUnlinkLegacyGradingRecord.mockReset();
    mockResolveLegacyCurrentRank.mockReset();
    mockVoidLegacyGradingRecord.mockReset();

    mockGetRanks.mockResolvedValue({ count: 1, next: null, previous: null, results: [yellowRank] });
    mockGetLegacyGradingRecords.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [unlinkedRecord],
    });
  });

  it("lists historical records and shows their source data", async () => {
    renderScreen();

    expect(await screen.findByText("A. Example")).toBeInTheDocument();
    expect(screen.getByText("— unlinked —")).toBeInTheDocument();
  });

  it("links a record to a searched student", async () => {
    const user = userEvent.setup();
    mockGetStudents.mockResolvedValue({ count: 1, next: null, previous: null, results: [studentResult] });
    mockLinkLegacyGradingRecord.mockResolvedValue({ ...unlinkedRecord, student: 42, student_display_name: "Alex Kim (UK-1234)" });

    renderScreen();
    await screen.findByText("A. Example");

    await user.click(screen.getByRole("button", { name: "Manage" }));
    await user.click(screen.getByRole("button", { name: "Link to student" }));
    await user.type(screen.getByLabelText("Search by name or WKSA ID"), "Alex");

    const result = await screen.findByRole("button", { name: /Alex Kim \(UK-1234\)/ });
    await user.click(result);

    await waitFor(() => {
      expect(mockLinkLegacyGradingRecord).toHaveBeenCalledWith(55, 42);
    });
  });

  it("unlinks an already-linked record", async () => {
    const user = userEvent.setup();
    const linked = { ...unlinkedRecord, student: 42, student_display_name: "Alex Kim (UK-1234)" };
    mockGetLegacyGradingRecords.mockResolvedValue({ count: 1, next: null, previous: null, results: [linked] });
    mockUnlinkLegacyGradingRecord.mockResolvedValue(unlinkedRecord);

    renderScreen();
    await screen.findByText("Alex Kim (UK-1234)");

    await user.click(screen.getByRole("button", { name: "Manage" }));
    await user.click(screen.getByRole("button", { name: /Unlink from Alex Kim/ }));

    await waitFor(() => {
      expect(mockUnlinkLegacyGradingRecord).toHaveBeenCalledWith(55);
    });
  });

  it("resolves a current rank mapping", async () => {
    const user = userEvent.setup();
    mockResolveLegacyCurrentRank.mockResolvedValue({ ...unlinkedRecord, current_rank: 3, current_rank_code: "YELLOW" });

    renderScreen();
    await screen.findByText("A. Example");
    await user.click(screen.getByRole("button", { name: "Manage" }));

    const select = screen.getByLabelText("Resolve current rank");
    await user.selectOptions(select, "3");

    await waitFor(() => {
      expect(mockResolveLegacyCurrentRank).toHaveBeenCalledWith(55, 3);
    });
  });

  it("voids a record with a required reason", async () => {
    const user = userEvent.setup();
    mockVoidLegacyGradingRecord.mockResolvedValue({ ...unlinkedRecord, is_void: true, void_reason: "Duplicate" });

    renderScreen();
    await screen.findByText("A. Example");
    await user.click(screen.getByRole("button", { name: "Manage" }));

    const panel = screen.getByText("Void this record").closest(".lr-action-group") as HTMLElement;
    await user.click(within(panel).getByRole("button", { name: "Void" }));
    expect(await screen.findByText("A reason is required to void a record.")).toBeInTheDocument();
    expect(mockVoidLegacyGradingRecord).not.toHaveBeenCalled();

    await user.type(within(panel).getByLabelText("Reason"), "Duplicate row");
    await user.click(within(panel).getByRole("button", { name: "Void" }));

    await waitFor(() => {
      expect(mockVoidLegacyGradingRecord).toHaveBeenCalledWith(55, "Duplicate row");
    });
  });

  it("filters by link status", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("A. Example");

    await user.selectOptions(screen.getByLabelText("Link status"), "linked");

    await waitFor(() => {
      expect(mockGetLegacyGradingRecords).toHaveBeenLastCalledWith(
        expect.objectContaining({ linked: true }),
      );
    });
  });
});
