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
  role: "instructor",
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
  is_staff: false,
  is_superuser: false,
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
  cancellation_reason: "",
  created_by: "uuid-master",
  created_by_email: "master@example.com",
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-12T10:00:00Z",
};

function candidate(id: number, name: string, overrides: Partial<GradingCandidate> = {}): GradingCandidate {
  return {
    id,
    session: 10,
    session_title: "Autumn Grading",
    student: id + 100,
    student_display_name: name,
    student_wksa_id: `KG-${id}`,
    from_rank: 2,
    from_rank_code: "YELLOW_STRIPE",
    from_rank_name: "Yellow Stripe",
    testing_for_rank: 3,
    testing_for_rank_code: "YELLOW",
    testing_for_rank_name: "Yellow",
    age_band: "AGE_9_TO_12",
    age_band_display: "9-12",
    status: "COMPLETED",
    status_display: "Completed",
    notes: "",
    withdrawal_reason: "",
    withdrawal_reason_display: "",
    withdrawal_note: "",
    withdrawn_by: null,
    withdrawn_by_email: "",
    withdrawn_by_name: "",
    withdrawn_at: null,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T10:00:00Z",
    ...overrides,
  };
}

function assessment(id: number, candidateId: number): CandidateAssessment {
  return {
    id,
    candidate: candidateId,
    candidate_student_name: "",
    candidate_student_wksa_id: "",
    testing_for_rank_code: "YELLOW",
    testing_for_rank_name: "Yellow",
    age_band: "AGE_9_TO_12",
    age_band_display: "9-12",
    status: "COMPLETED",
    status_display: "Completed",
    generated_by: "uuid-master",
    generated_by_email: "master@example.com",
    generated_at: "2026-11-12T09:00:00Z",
    started_at: "2026-11-12T09:05:00Z",
    completed_at: "2026-11-12T11:00:00Z",
    notes: "",
    item_counts: { total: 3, required: 3, met: 3, not_met: 0, not_assessed: 0 },
    created_at: "2026-11-12T09:00:00Z",
    updated_at: "2026-11-12T11:00:00Z",
  };
}

function outcome(id: number, candidateId: number, overrides: Partial<CandidateOutcome> = {}): CandidateOutcome {
  return {
    id,
    candidate: candidateId,
    assessment: candidateId + 1000,
    assessment_status: "COMPLETED",
    student: candidateId + 100,
    student_display_name: "",
    student_wksa_id: "",
    session: 10,
    session_title: "Autumn Grading",
    testing_for_rank: 3,
    testing_for_rank_code: "YELLOW",
    testing_for_rank_name: "Yellow",
    status: "PROPOSED",
    status_display: "Proposed",
    proposed_outcome: "PASS",
    proposed_outcome_display: "Pass",
    proposed_by: "uuid-reed",
    proposed_by_email: "reed@example.com",
    proposed_by_name: "Morgan Reed",
    proposed_at: "2026-11-12T15:00:00Z",
    proposal_notes: "Clean grading throughout.",
    final_outcome: null,
    final_outcome_display: "",
    decided_by: null,
    decided_by_email: "",
    decided_by_name: "",
    decided_at: null,
    decision_notes: "",
    conditional_requirements: "",
    created_at: "2026-11-12T14:00:00Z",
    updated_at: "2026-11-12T15:00:00Z",
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
    required_not_met: notMet,
    required_not_assessed: 0,
    all_required_assessed: true,
    all_required_met: notMet === 0,
  };
  return { overall: counts, categories: [] };
}

function item(id: number, overrides: Partial<CandidateAssessmentItem>): CandidateAssessmentItem {
  return {
    id,
    assessment: 1002,
    source_requirement: id,
    source_item: id,
    source_rank: 3,
    source_age_band: "AGE_9_TO_12",
    item_code: `ITEM_${id}`,
    item_name: `Item ${id}`,
    korean_name: "",
    category: "KICKING",
    category_display: "Kicking",
    requirement_sequence: id,
    required: true,
    start_number: null,
    end_number: null,
    display_range: "",
    requirement_notes: "",
    result: "MET",
    result_display: "Met",
    assessor: "uuid-reed",
    assessor_email: "reed@example.com",
    assessed_at: "2026-11-12T10:00:00Z",
    assessor_notes: "",
    created_at: "2026-11-12T09:00:00Z",
    updated_at: "2026-11-12T10:00:00Z",
    ...overrides,
  };
}

// Mia is proposed Pass, Alex is proposed Conditional with a shortfall, Tom is
// already finalised, and Sam withdrew.
const cohort = [
  candidate(1, "Mia Okafor"),
  candidate(2, "Alex Carter"),
  candidate(3, "Tom Ashby"),
  candidate(4, "Sam Withdrawn", { status: "WITHDRAWN", status_display: "Withdrawn" }),
];
const outcomes = [
  outcome(11, 1),
  outcome(12, 2, {
    proposed_outcome: "CONDITIONAL",
    proposed_outcome_display: "Conditional",
    proposal_notes: "Back kick needs a re-test.",
  }),
  outcome(13, 3, {
    status: "FINALISED",
    status_display: "Finalised",
    final_outcome: "FAIL",
    final_outcome_display: "Fail",
    decided_by_name: "Lee Tan",
    decided_at: "2026-11-12T16:00:00Z",
  }),
];

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
    mockGetAssessments.mockResolvedValue(page([assessment(1001, 1), assessment(1002, 2), assessment(1003, 3)]));
    mockGetOutcomes.mockResolvedValue(page(outcomes));
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
