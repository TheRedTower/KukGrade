import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type {
  AuthUser,
  CandidateAssessment,
  CandidateAssessmentItem,
  CandidateAssessmentSummary,
  CandidateOutcome,
  GradingCandidate,
  GradingSession,
} from "./api";
import { ApiError } from "./api";
import { CohortAdjudicationScreen } from "./CohortAdjudicationScreen";

const masterUser: AuthUser = {
  id: "uuid-master",
  email: "master@example.com",
  first_name: "Lee",
  last_name: "Tan",
  full_name: "Lee Tan",
  role_display: "Instructor",
  can_make_final_grading_decision: true,
  can_promote_student: true,
  can_override_locked_session: false,
  can_view_grading_audit_log: false,
  can_manage_users: false,
  can_import_data: false,
  can_reconcile_imported_history: false,
  can_delete_students: false,
  can_delete_assessments: false,
  can_delete_any_session: false,
  can_read_audit_log: true,
  must_change_password: false,
};

let mockCurrentUser: AuthUser = masterUser;

vi.mock("./auth", () => ({
  useAuth: () => ({ user: mockCurrentUser, status: "authenticated" }),
}));

const mockGetGradingSession = vi.fn();
const mockGetCandidates = vi.fn();
const mockGetAssessments = vi.fn();
const mockGetOutcomes = vi.fn();
const mockGetSummary = vi.fn();
const mockGetItems = vi.fn();
const mockFinalise = vi.fn();

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getGradingSession: (...args: unknown[]) => mockGetGradingSession(...args),
    getAllGradingCandidates: (...args: unknown[]) => mockGetCandidates(...args),
    getAllCandidateAssessments: (...args: unknown[]) => mockGetAssessments(...args),
    getAllCandidateOutcomes: (...args: unknown[]) => mockGetOutcomes(...args),
    getAssessmentSummary: (...args: unknown[]) => mockGetSummary(...args),
    getAllCandidateAssessmentItems: (...args: unknown[]) => mockGetItems(...args),
    finaliseCandidateOutcome: (...args: unknown[]) => mockFinalise(...args),
  };
});

function page<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

const lockedSession: GradingSession = {
  id: 10,
  title: "Autumn Grading",
  status: "LOCKED",
  status_display: "Locked",
  grading_date: "2026-11-12",
  location: "Colchester",
  notes: "",
};

function candidate(id: number, name: string, overrides: Partial<GradingCandidate> = {}): GradingCandidate {
  return {
    id,
    session: 10,
    student: id + 100,
    student_display_name: name,
    student_wksa_id: `KG-${id}`,
    from_rank: 2,
    from_rank_name: "Yellow Stripe",
    testing_for_rank: 3,
    testing_for_rank_name: "Yellow",
    age_band_display: "9-12",
    status: "COMPLETED",
    notes: "",
    withdrawal_reason: "",
    withdrawal_reason_display: "",
    can_be_moved: false,
    can_be_removed: false,
    withdrawal_note: "",
    ...overrides,
  };
}

function assessment(
  id: number,
  candidateId: number,
  overall: CandidateAssessment["overall"],
): CandidateAssessment {
  return {
    id,
    candidate: candidateId,
    candidate_student_name: "",
    status: "COMPLETED",
    status_display: "Completed",
    generated_by_email: "master@example.com",
    overall,
    generated_at: "2026-11-12T09:00:00Z",
    started_at: "2026-11-12T09:05:00Z",
    completed_at: "2026-11-12T11:00:00Z",
    notes: "",
  };
}

function outcome(id: number, candidateId: number, overrides: Partial<CandidateOutcome> = {}): CandidateOutcome {
  return {
    id,
    candidate: candidateId,
    status: "PROPOSED",
    proposed_outcome: "PASS",
    proposed_outcome_display: "Pass",
    proposed_by_name: "Morgan Reed",
    proposed_at: "2026-11-12T15:00:00Z",
    proposal_notes: "Clean grading throughout.",
    final_outcome: null,
    final_outcome_display: "",
    decided_by_name: "",
    decided_at: null,
    decision_notes: "",
    conditional_requirements: "",
    ...overrides,
  };
}

function summary(required: number, met: number, notMet: number): CandidateAssessmentSummary {
  const counts = {
    total: required,
    required,
    met,
    not_met: notMet,
    not_assessed: 0,
    required_met: met,
    required_not_assessed: 0,
    all_required_assessed: true,
  };
  return { overall: counts, categories: [] };
}

function item(id: number, overrides: Partial<CandidateAssessmentItem>): CandidateAssessmentItem {
  return {
    id,
    item_name: `Item ${id}`,
    korean_name: "",
    category: "KICKING",
    category_display: "Kicking",
    requirement_sequence: id,
    required: true,
    display_range: "",
    requirement_notes: "",
    result: "MET",
    result_display: "Met",
    assessor_email: "reed@example.com",
    assessed_at: "2026-11-12T10:00:00Z",
    assessor_notes: "",
    ...overrides,
  };
}

// Mia is proposed Pass, Alex is proposed Conditional with a shortfall, Tom is
// already finalised, and Sam withdrew.
const cohort = [
  candidate(1, "Mia Okafor"),
  candidate(2, "Alex Carter"),
  candidate(3, "Tom Ashby"),
  candidate(4, "Sam Withdrawn", { status: "WITHDRAWN", }),
] satisfies GradingCandidate[];
const outcomes = [
  outcome(11, 1),
  outcome(12, 2, {
    proposed_outcome: "CONDITIONAL",
    proposed_outcome_display: "Conditional",
    proposal_notes: "Back kick needs a re-test.",
  }),
  outcome(13, 3, {
    status: "FINALISED",
    final_outcome: "FAIL",
    final_outcome_display: "Fail",
    decided_by_name: "Lee Tan",
    decided_at: "2026-11-12T16:00:00Z",
  }),
] satisfies CandidateOutcome[];

function renderBoard(path = "/gradings/10/decisions") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/gradings/:id/decisions" element={<CohortAdjudicationScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CohortAdjudicationScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentUser = masterUser;
    mockGetGradingSession.mockResolvedValue(lockedSession);
    mockGetCandidates.mockResolvedValue(page(cohort));
    mockGetAssessments.mockResolvedValue(
      page([
        assessment(1001, 1, summary(18, 18, 0).overall),
        assessment(1002, 2, summary(24, 22, 2).overall),
        assessment(1003, 3, summary(18, 18, 0).overall),
      ]),
    );
    mockGetOutcomes.mockResolvedValue(page(outcomes));
    // Only the row in focus fetches its full summary, for the evidence pane.
    mockGetSummary.mockImplementation(async (assessmentId: number) =>
      assessmentId === 1002 ? summary(24, 22, 2) : summary(18, 18, 0),
    );
    mockGetItems.mockResolvedValue(
      page([
        item(1, { result: "NOT_MET", result_display: "Not met", item_name: "Dwi Cha Gi", assessor_notes: "Guard dropped on the turn." }),
        item(2, { item_name: "Ap Cha Gi", assessor_notes: "Excellent chamber." }),
        item(3, { item_name: "Yup Cha Gi" }),
      ]),
    );
    mockFinalise.mockImplementation(async (outcomeId: number) => ({
      ...outcomes.find((o) => o.id === outcomeId)!,
      status: "FINALISED",
    }));
  });

  it("lists the non-withdrawn cohort with served counts, proposals and recorded decisions", async () => {
    renderBoard();

    const alex = await screen.findByTestId("cab-row-2");
    await waitFor(() => expect(within(alex).getByText("22 / 24 met")).toBeVisible());
    expect(within(alex).getByText("2 not met")).toBeVisible();
    expect(within(alex).getByText("Conditional", { selector: ".cab-pill" })).toBeVisible();
    expect(within(screen.getByTestId("cab-row-3")).getByText("Recorded · Fail")).toBeVisible();
    expect(screen.queryByTestId("cab-row-4")).toBeNull();
    expect(screen.getByText("1 withdrawn candidate is not shown.")).toBeVisible();
    expect(screen.getByText("finalised", { exact: false })).toHaveTextContent("1 / 3 finalised");
    // Row counts come with the assessment list; only the row in focus asks
    // for its full summary, for the evidence pane.
    await waitFor(() => expect(mockGetSummary).toHaveBeenCalledTimes(1));
    expect(mockGetSummary).toHaveBeenCalledWith(1001);
  });

  it("stages decisions, then records each one on its own", async () => {
    const user = userEvent.setup();
    renderBoard();

    const mia = await screen.findByTestId("cab-row-1");
    await user.click(within(mia).getByRole("button", { name: "Pass" }));
    const alex = screen.getByTestId("cab-row-2");
    await user.click(within(alex).getByRole("button", { name: "Conditional" }));

    // A Conditional decision cannot be recorded without re-test requirements.
    const recordAll = screen.getByTestId("cab-record-staged");
    expect(recordAll).toHaveTextContent("Record 2 staged decisions");
    expect(recordAll).toBeDisabled();
    await user.type(screen.getByLabelText("Re-test requirements (required)"), "Re-test Dwi Cha Gi.");
    expect(recordAll).toBeEnabled();

    await user.click(recordAll);

    await waitFor(() => expect(mockFinalise).toHaveBeenCalledTimes(2));
    expect(mockFinalise).toHaveBeenNthCalledWith(1, 11, {
      final_outcome: "PASS",
      decision_notes: "",
      conditional_requirements: "",
    });
    expect(mockFinalise).toHaveBeenNthCalledWith(2, 12, {
      final_outcome: "CONDITIONAL",
      decision_notes: "",
      conditional_requirements: "Re-test Dwi Cha Gi.",
    });
    expect(await screen.findByText("2 decisions recorded.")).toBeVisible();
    // The record button is disabled once nothing is staged, so focus moves to
    // the result rather than dropping to the page.
    expect(screen.getByText("2 decisions recorded.")).toHaveFocus();
  });

  it("keeps a failed row staged and retries only that row", async () => {
    const user = userEvent.setup();
    mockFinalise.mockImplementation(async (outcomeId: number) => {
      if (outcomeId === 12) throw new ApiError("Session changed.", 400);
      return { ...outcomes[0], status: "FINALISED" };
    });
    renderBoard();

    await user.click(within(await screen.findByTestId("cab-row-1")).getByRole("button", { name: "Pass" }));
    await user.click(within(screen.getByTestId("cab-row-2")).getByRole("button", { name: "Fail" }));
    await user.click(screen.getByTestId("cab-record-staged"));

    expect(await screen.findByText("1 recorded, 1 could not be recorded and remains staged.")).toBeVisible();
    expect(within(screen.getByTestId("cab-row-2")).getByRole("alert")).toHaveTextContent("Session changed.");

    mockFinalise.mockClear();
    await user.click(screen.getByRole("button", { name: "Retry 1 failed" }));
    await waitFor(() => expect(mockFinalise).toHaveBeenCalledTimes(1));
    expect(mockFinalise).toHaveBeenCalledWith(12, expect.objectContaining({ final_outcome: "FAIL" }));
  });

  it.each([
    ["candidates", () => mockGetCandidates],
    ["assessments", () => mockGetAssessments],
    ["outcomes", () => mockGetOutcomes],
    ["session", () => mockGetGradingSession],
  ])("shows a failure, not an empty cohort, when the %s request fails, and retries it", async (_name, mock) => {
    const user = userEvent.setup();
    mock().mockRejectedValueOnce(new ApiError("Server error.", 500));
    renderBoard();

    expect(await screen.findByRole("alert")).toHaveTextContent("The final decisions could not be loaded.");
    expect(screen.queryByTestId("cab-row-1")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("cab-row-1")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers no decision controls without Master authority", async () => {
    mockCurrentUser = { ...masterUser, can_make_final_grading_decision: false };
    renderBoard();

    await screen.findByTestId("cab-row-1");
    expect(screen.getByText(/Final decisions are made by an authorised Master/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
    expect(screen.queryByTestId("cab-record-staged")).toBeNull();
  });

  it("offers no decision controls until the session is locked", async () => {
    mockGetGradingSession.mockResolvedValue({ ...lockedSession, status: "OPEN", status_display: "Open" });
    renderBoard();

    await screen.findByTestId("cab-row-1");
    expect(screen.getByText(/Final decisions open once the session is locked/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
  });

  it("moves focus to the detail pane when a row is chosen on a narrow screen", async () => {
    const user = userEvent.setup();
    const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) => ({ matches: query === "(max-width: 64rem)", media: query }) as MediaQueryList,
    );
    renderBoard();

    await user.click(within(await screen.findByTestId("cab-row-2")).getByRole("button", { name: "Alex Carter" }));

    await waitFor(() =>
      expect(within(screen.getByTestId("cab-detail")).getByRole("heading", { name: "Alex Carter" })).toHaveFocus(),
    );
    matchMedia.mockRestore();
  });

  it("leaves focus on the row when a row is chosen on a wide screen", async () => {
    const user = userEvent.setup();
    renderBoard();

    const name = within(await screen.findByTestId("cab-row-2")).getByRole("button", { name: "Alex Carter" });
    await user.click(name);

    expect(within(screen.getByTestId("cab-detail")).getByRole("heading", { name: "Alex Carter" })).toBeVisible();
    expect(name).toHaveFocus();
  });

  it("focuses the requested candidate and shows every recorded note, not only shortfalls", async () => {
    renderBoard("/gradings/10/decisions?candidate=2");

    const detail = await screen.findByTestId("cab-detail");
    expect(within(detail).getByRole("heading", { name: "Alex Carter" })).toBeVisible();
    expect(await within(detail).findByText("Guard dropped on the turn.")).toBeVisible();
    expect(within(detail).getByText("Excellent chamber.")).toBeVisible();
    expect(within(detail).queryByText(/Yup Cha Gi/)).toBeNull();
    expect(within(detail).getByText("Back kick needs a re-test.")).toBeVisible();
    expect(within(detail).getByRole("link", { name: "Open the full assessment record" })).toHaveAttribute(
      "href",
      "/gradings/10/assessments/2/review",
    );
  });
});
