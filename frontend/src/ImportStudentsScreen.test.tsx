import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImportStudentsScreen } from "./ImportStudentsScreen";
import {
  ApiError,
  type CreateDataImportBatchResponse,
  type DataImportBatch,
  type StudentImportPreview,
} from "./api";

const mockCreateDataImportBatch = vi.fn();
const mockPreviewStudentImport = vi.fn();
const mockCommitStudentImport = vi.fn();
const mockCancelDataImportBatch = vi.fn();

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    createDataImportBatch: (...args: unknown[]) => mockCreateDataImportBatch(...args),
    previewStudentImport: (...args: unknown[]) => mockPreviewStudentImport(...args),
    commitStudentImport: (...args: unknown[]) => mockCommitStudentImport(...args),
    cancelDataImportBatch: (...args: unknown[]) => mockCancelDataImportBatch(...args),
  };
});

const batchResponse: CreateDataImportBatchResponse = {
  id: 42,
  already_imported_warning: false,
  detected_headers: ["WKSA ID", "First Name", "Last Name", "Date of Birth", "Current Rank", "Status"],
  suggested_mapping: {
    wksa_id: "WKSA ID",
    first_name: "First Name",
    last_name: "Last Name",
    date_of_birth: "Date of Birth",
    current_rank: "Current Rank",
    status: "Status",
  },
};

const readyPreview: StudentImportPreview = {
  total: 1,
  ready: 1,
  review_required: 0,
  skip_existing: 0,
  excluded: 0,
  rows: [
    {
      row_number: 2,
      outcome: "READY",
      wksa_id: "000123",
      first_name: "Alex",
      last_name: "Kim",
      date_of_birth_display: "2012-05-01",
      current_rank_text: "White",
      status: "ACTIVE",
      issues: [],
    },
  ],
};

const committedBatch: DataImportBatch = {
  id: 42,
  kind: "STUDENT_ROSTER",
  kind_display: "Student roster",
  status: "COMMITTED",
  status_display: "Imported",
  original_filename: "file.xlsx",
  file_size: 1024,
  uploaded_at: "2026-10-20T09:00:00Z",
  uploaded_by_name: "Admin",
  committed_at: "2026-10-20T09:05:00Z",
  committed_by_name: "Admin",
  cancelled_at: null,
  next_step: "CLOSED",
  detected_headers: [],
  column_mapping: {},
  defaults: {},
  extra_columns: [],
  sheet: "",
  sheet_names: [],
  grading_sheets: [],
  warnings: [],
  row_counts: { total: 1, ready: 1, review_required: 0, skip_existing: 0, excluded: 0 },
  summary_json: { total: 1, created: 1, skipped_existing: 0, review_required: 0 },
};

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/students/import"]}>
        <Routes>
          <Route path="/students/import" element={<ImportStudentsScreen />} />
          <Route path="/students" element={<h1>Students reached</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function makeFile(name = "roster.xlsx") {
  return new File(["dummy content"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("ImportStudentsScreen", () => {
  beforeEach(() => {
    mockCreateDataImportBatch.mockReset();
    mockPreviewStudentImport.mockReset();
    mockCommitStudentImport.mockReset();
    mockCancelDataImportBatch.mockReset();
  });

  it("completes the full upload, mapping, preview, and commit flow", async () => {
    const user = userEvent.setup();
    mockCreateDataImportBatch.mockResolvedValue(batchResponse);
    mockPreviewStudentImport.mockResolvedValue(readyPreview);
    mockCommitStudentImport.mockResolvedValue(committedBatch);

    renderScreen();

    const fileInput = screen.getByLabelText("Student roster file");
    await user.upload(fileInput, makeFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText(/Detected columns/)).toBeInTheDocument();
    expect(mockCreateDataImportBatch).toHaveBeenCalledWith(expect.any(File), "STUDENT_ROSTER");

    // The suggested mapping pre-fills every dropdown, so "Check file" is
    // immediately enabled without any manual selection.
    await user.click(screen.getByRole("button", { name: "Check file" }));

    await waitFor(() => {
      expect(mockPreviewStudentImport).toHaveBeenCalledWith(42, {
        column_mapping: batchResponse.suggested_mapping,
        corrections: {},
      });
    });
    expect(await screen.findByText("1 ready to create")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create 1 student" }));

    await waitFor(() => {
      expect(mockCommitStudentImport).toHaveBeenCalledWith(42, {
        column_mapping: batchResponse.suggested_mapping,
        corrections: {},
      });
    });
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.getByText(/1 student\(s\) created/)).toBeInTheDocument();
  });

  it("shows a review-required row's issues and lets the admin correct it", async () => {
    const user = userEvent.setup();
    mockCreateDataImportBatch.mockResolvedValue(batchResponse);
    mockPreviewStudentImport.mockResolvedValueOnce({
      total: 1,
      ready: 0,
      review_required: 1,
      skip_existing: 0,
      rows: [
        {
          row_number: 2,
          outcome: "REVIEW_REQUIRED",
          wksa_id: "000124",
          first_name: "",
          last_name: "Kim",
          date_of_birth_display: "2012-05-01",
          current_rank_text: "White",
          current_rank_code: "WHITE",
          status: "ACTIVE",
          issues: ["First name is required."],
          existing_student_id: null,
          existing_student_display: null,
        },
      ],
    });

    renderScreen();
    await user.upload(screen.getByLabelText("Student roster file"), makeFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await user.click(await screen.findByRole("button", { name: "Check file" }));

    expect(await screen.findByText("First name is required.")).toBeInTheDocument();
    // Nothing is ready, so committing is disabled until the row is fixed.
    expect(screen.queryByRole("button", { name: /Create \d+ student/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Fix" }));
    const firstNameInput = screen.getByLabelText("First name");
    await user.clear(firstNameInput);
    await user.type(firstNameInput, "Alex");

    // The shown count was checked without this edit, so it cannot be
    // committed until it is re-checked.
    expect(screen.getByRole("button", { name: "Re-check corrections first" })).toBeDisabled();

    mockPreviewStudentImport.mockResolvedValueOnce(readyPreview);
    await user.click(screen.getByRole("button", { name: "Re-check" }));

    await waitFor(() => {
      expect(mockPreviewStudentImport).toHaveBeenLastCalledWith(42, {
        column_mapping: batchResponse.suggested_mapping,
        corrections: { "2": { first_name: "Alex" } },
      });
    });
    expect(await screen.findByRole("button", { name: "Create 1 student" })).toBeEnabled();
  });

  it("surfaces an upload error from the API", async () => {
    const user = userEvent.setup();
    mockCreateDataImportBatch.mockRejectedValue(
      new ApiError("Unsupported file type .txt for STUDENT_ROSTER.", 400),
    );

    renderScreen();
    await user.upload(screen.getByLabelText("Student roster file"), makeFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(
      await screen.findByText("Unsupported file type .txt for STUDENT_ROSTER."),
    ).toBeInTheDocument();
  });

  it("cancels the import and returns to the upload step", async () => {
    const user = userEvent.setup();
    mockCreateDataImportBatch.mockResolvedValue(batchResponse);
    mockCancelDataImportBatch.mockResolvedValue(undefined);

    renderScreen();
    await user.upload(screen.getByLabelText("Student roster file"), makeFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await user.click(await screen.findByRole("button", { name: "Cancel import" }));

    await waitFor(() => {
      expect(mockCancelDataImportBatch).toHaveBeenCalledWith(42);
    });
    expect(await screen.findByRole("button", { name: "Upload" })).toBeInTheDocument();
    expect(screen.getByLabelText("Student roster file")).toBeInTheDocument();
  });
});
