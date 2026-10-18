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
const summary: CandidateAssessmentSummary = { overall: counts, categories: [] };

function item(overrides: Partial<CandidateAssessmentItem>): CandidateAssessmentItem {
  return {
    id: 1,
    item_name: "Front kick",
    korean_name: "",
    category: "KICKING",
    category_display: "Kicking",
    category_is_core: true,
    position: 1,
    required: true,
    display_range: "",
    requirement_notes: "",
    notation: "",
    result: "MET",
    result_display: "Met",
    assessor_email: "reed@example.com",
    assessed_at: null,
    assessor_notes: "",
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
        item({ id: 1, result: "NOT_MET", result_display: "Not met", assessor_notes: "Chamber too low" }),
        item({ id: 2, item_name: "Stance", assessor_notes: "Crisp footwork" }),
      ],
    });

    renderEvidence();

    expect(await screen.findByText("3 / 4 required met · 1 not met")).toBeVisible();
    expect(screen.getByText("Chamber too low")).toBeVisible();
    expect(screen.getByText("Crisp footwork")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open the full assessment record" })).toHaveAttribute(
      "href",
      "/gradings/10/assessments/102/review",
    );
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
