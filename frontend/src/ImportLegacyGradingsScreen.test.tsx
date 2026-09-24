import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImportLegacyGradingsScreen } from "./ImportLegacyGradingsScreen";
import {
  ApiError,
  type DataImportBatch,
  type LegacyImportPreview,
} from "./api";

const mockCreateDataImportBatch = vi.fn();
const mockPreviewLegacyGradingImport = vi.fn();
const mockCommitLegacyGradingImport = vi.fn();
const mockCancelDataImportBatch = vi.fn();
const mockGetRanks = vi.fn();

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    createDataImportBatch: (...args: unknown[]) => mockCreateDataImportBatch(...args),
    previewLegacyGradingImport: (...args: unknown[]) => mockPreviewLegacyGradingImport(...args),
    commitLegacyGradingImport: (...args: unknown[]) => mockCommitLegacyGradingImport(...args),
    cancelDataImportBatch: (...args: unknown[]) => mockCancelDataImportBatch(...args),
    getRanks: (...args: unknown[]) => mockGetRanks(...args),
  };
});

const batchResponse: DataImportBatch = {
  id: 7,
  kind: "LEGACY_GRADINGS",
  kind_display: "Legacy grading records",
  status: "UPLOADED",
  status_display: "Uploaded",
  original_filename: "workbook.xlsx",
  sha256: "abc",
  file_size: 2048,
  uploaded_by_email: "admin@example.com",
  uploaded_at: "2026-09-22T10:00:00Z",
  committed_by_email: null,
  committed_at: null,
  cancelled_at: null,
  summary_json: {},
  configuration_json: {},
  error_summary: "",
  created_at: "2026-09-22T10:00:00Z",
  updated_at: "2026-09-22T10:00:00Z",
};

const initialPreview: LegacyImportPreview = {
  total: 2,
  grading_result: 1,
  auxiliary_note: 0,
  did_not_attend: 1,
  unresolved_current_rank: 1,
  unresolved_testing_for_rank: 0,
  unresolved_outcome: 0,
  warnings: [],
  rank_suggestions: [
    { source_text: "Yellow", suggested_rank_id: 3, suggested_rank_code: "YELLOW" },
  ],
  rows: [],
};

const committedBatch: DataImportBatch = {
  ...batchResponse,
  status: "COMMITTED",
  summary_json: {
    total: 2,
    grading_result: 1,
    did_not_attend: 1,
    auxiliary_note: 0,
    unresolved_current_rank: 0,
    unresolved_testing_for_rank: 0,
  },
};

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/gradings/import-legacy"]}>
        <Routes>
          <Route path="/gradings/import-legacy" element={<ImportLegacyGradingsScreen />} />
          <Route path="/gradings" element={<h1>Gradings reached</h1>} />
          <Route path="/gradings/legacy-records" element={<h1>Records reached</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function makeFile(name = "workbook.xlsx") {
  return new File(["dummy"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("ImportLegacyGradingsScreen", () => {
  beforeEach(() => {
    mockCreateDataImportBatch.mockReset();
    mockPreviewLegacyGradingImport.mockReset();
    mockCommitLegacyGradingImport.mockReset();
    mockCancelDataImportBatch.mockReset();
    mockGetRanks.mockReset();
    mockGetRanks.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [{ id: 3, code: "YELLOW", name: "Yellow", order: 3, category: "COLOURED_BELT", active: true, category_display: "Coloured belt" }],
    });
  });

  it("uploads, pre-fills the suggested rank mapping, and commits", async () => {
    const user = userEvent.setup();
    mockCreateDataImportBatch.mockResolvedValue(batchResponse);
    mockPreviewLegacyGradingImport.mockResolvedValue(initialPreview);
    mockCommitLegacyGradingImport.mockResolvedValue(committedBatch);

    renderScreen();

    await user.upload(
      screen.getByLabelText("Historical grading workbook file"),
      makeFile(),
    );
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("2 row(s) found")).toBeInTheDocument();
    expect(mockCreateDataImportBatch).toHaveBeenCalledWith(expect.any(File), "LEGACY_GRADINGS");

    // The suggested mapping pre-fills the select for "Yellow".
    const select = screen.getByLabelText("Rank for Yellow") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("YELLOW"));

    await user.click(screen.getByRole("button", { name: "Create 2 historical record(s)" }));

    await waitFor(() => {
      expect(mockCommitLegacyGradingImport).toHaveBeenCalledWith(7, {
        rank_mappings: { Yellow: "YELLOW" },
      });
    });
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
  });

  it("surfaces an upload error from the API", async () => {
    const user = userEvent.setup();
    mockCreateDataImportBatch.mockRejectedValue(
      new ApiError("Unsupported file type .csv for LEGACY_GRADINGS.", 400),
    );

    renderScreen();
    await user.upload(
      screen.getByLabelText("Historical grading workbook file"),
      makeFile(),
    );
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(
      await screen.findByText("Unsupported file type .csv for LEGACY_GRADINGS."),
    ).toBeInTheDocument();
  });

  it("cancels the import and returns to the upload step", async () => {
    const user = userEvent.setup();
    mockCreateDataImportBatch.mockResolvedValue(batchResponse);
    mockPreviewLegacyGradingImport.mockResolvedValue(initialPreview);
    mockCancelDataImportBatch.mockResolvedValue(undefined);

    renderScreen();
    await user.upload(
      screen.getByLabelText("Historical grading workbook file"),
      makeFile(),
    );
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await user.click(await screen.findByRole("button", { name: "Cancel import" }));

    await waitFor(() => {
      expect(mockCancelDataImportBatch).toHaveBeenCalledWith(7);
    });
    expect(await screen.findByRole("button", { name: "Upload" })).toBeInTheDocument();
  });
});
