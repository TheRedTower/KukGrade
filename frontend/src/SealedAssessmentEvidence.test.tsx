import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import type { CandidateAssessmentItem, CandidateAssessmentSummary } from "./api";
import { SealedAssessmentEvidence } from "./SealedAssessmentEvidence";

const mockGetSummary = vi.fn();
const mockGetItems = vi.fn();

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getAssessmentSummary: (...args: unknown[]) => mockGetSummary(...args),
    getAllCandidateAssessmentItems: (...args: unknown[]) => mockGetItems(...args),
  };
});

const counts = {
  total: 4,
  required: 4,
  met: 3,
  not_met: 1,
  not_assessed: 0,
  required_met: 3,
  required_not_assessed: 0,
  all_required_assessed: true,
};
const summary: CandidateAssessmentSummary = { overall: counts, can_complete: false, categories: [] };

function item(overrides: Partial<CandidateAssessmentItem>): CandidateAssessmentItem {
  return {
    id: 1,
    item_name: "Front kick",
    korean_name: "",
    category: "KICKING",
    category_display: "Kicking",
    category_is_core: true,
    reason_required: true,
    can_clear: true,
    position: 1,
    required: true,
    display_range: "",
    requirement_notes: "",
    notation: "",
    result: "MET",
    result_display: "Met",
    assessor_email: "reed@example.com",
    assessed_at: null,
    comments: [],
    changes: [],
    ...overrides,
  };
}

function renderEvidence(assessmentId: number | null = 7) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SealedAssessmentEvidence
          assessmentId={assessmentId ?? undefined}
          sessionId={10}
          candidateId={102}
          className="test"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SealedAssessmentEvidence", () => {
  beforeEach(() => {
    mockGetSummary.mockReset();
    mockGetItems.mockReset();
  });

  it("shows the served counts, every recorded note and the review link", async () => {
    mockGetSummary.mockResolvedValue(summary);
    mockGetItems.mockResolvedValue({
      count: 2,
      next: null,
      previous: null,
      results: [
        item({ id: 1, result: "NOT_MET", result_display: "Not met", comments: [{ id: 1, author_name: "Casey Reed", body: "Chamber too low", created_at: "2026-09-18T10:20:00Z", after_lock: false }] }),
        item({ id: 2, item_name: "Stance", comments: [{ id: 2, author_name: "Lee Tan", body: "Crisp footwork", created_at: "2026-09-18T10:20:00Z", after_lock: false }] }),
      ],
    });

    renderEvidence();

    expect(await screen.findByText("3 / 4 required met · 1 not met")).toBeVisible();
    expect(screen.getByText("“Chamber too low”")).toBeVisible();
    expect(screen.getByText("“Crisp footwork”")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open the full assessment record" })).toHaveAttribute(
      "href",
      "/gradings/10/assessments/102/review",
    );
  });

  it("shows a correction made after the lock, with its reason and who made it", async () => {
    mockGetSummary.mockResolvedValue(summary);
    mockGetItems.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [
        item({
          id: 5,
          result: "NOT_MET",
          result_display: "Not met",
          changes: [
            { sequence: 1, from_result: "NOT_ASSESSED", from_result_display: "Not assessed", to_result: "MET", to_result_display: "Met", changed_by_name: "Casey Reed", changed_at: "2026-09-18T10:00:00Z", reason: "", after_lock: false },
            { sequence: 2, from_result: "MET", from_result_display: "Met", to_result: "NOT_MET", to_result_display: "Not met", changed_by_name: "Master Park", changed_at: "2026-09-19T09:30:00Z", reason: "Dropped the guard on review.", after_lock: true },
          ],
        }),
      ],
    });

    renderEvidence();

    const change = await screen.findByTestId("remark-change-5-2");
    expect(change).toHaveTextContent("Dropped the guard on review.");
    expect(change).toHaveTextContent("Master Park");
    expect(change).toHaveTextContent("after the lock");
    expect(screen.queryByTestId("remark-change-5-1")).toBeNull();
  });

  it("shows a first mark made after the lock, even on a met item with no comments", async () => {
    mockGetSummary.mockResolvedValue(summary);
    mockGetItems.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [
        item({
          id: 6,
          changes: [
            { sequence: 1, from_result: "NOT_ASSESSED", from_result_display: "Not assessed", to_result: "MET", to_result_display: "Met", changed_by_name: "Master Park", changed_at: "2026-09-19T09:30:00Z", reason: "Seen on the recording.", after_lock: true },
          ],
        }),
      ],
    });

    renderEvidence();

    const change = await screen.findByTestId("remark-change-6-1");
    expect(change).toHaveTextContent("Seen on the recording.");
    expect(change).toHaveTextContent("after the lock");
  });

  it("says so, and requests nothing, when the candidate has no assessment", () => {
    renderEvidence(null);

    expect(screen.getByText("No assessment recorded.")).toBeVisible();
    expect(mockGetSummary).not.toHaveBeenCalled();
    expect(mockGetItems).not.toHaveBeenCalled();
  });

  it("reports a failed load instead of loading forever, and recovers on retry", async () => {
    const user = userEvent.setup();
    mockGetSummary.mockRejectedValueOnce(new Error("network")).mockResolvedValue(summary);
    mockGetItems.mockResolvedValue({ count: 0, next: null, previous: null, results: [] });

    renderEvidence();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The sealed assessment could not be loaded.",
    );
    expect(screen.queryByText("Loading the assessment…")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("3 / 4 required met · 1 not met")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
