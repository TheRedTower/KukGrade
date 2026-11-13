import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type {
  AuthUser,
  CandidateAssessment,
  CandidateAssessmentItem,
  CandidateAssessmentSummary,
  CandidateOutcome,
  GradingCandidate,
  GradingCandidateRoster,
  GradingSession,
} from "./api";
import { ApiError } from "./api";
import { CohortAdjudicationScreen } from "./CohortAdjudicationScreen";
import { CHOICES, sessionServed } from "./appTestSupport";

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
const mockGetSummary = vi.fn();
const mockGetItems = vi.fn();
const mockFinalise = vi.fn();
const mockGetStaged = vi.fn();
const mockStage = vi.fn();
const mockDiscard = vi.fn();

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getChoices: async () => CHOICES,
    getGradingSession: (...args: unknown[]) => mockGetGradingSession(...args),
    getAllGradingCandidates: (...args: unknown[]) => mockGetCandidates(...args),
    getAssessmentSummary: (...args: unknown[]) => mockGetSummary(...args),
    getAllCandidateAssessmentItems: (...args: unknown[]) => mockGetItems(...args),
    finaliseCandidateOutcome: (...args: unknown[]) => mockFinalise(...args),
    getStagedDecisions: (...args: unknown[]) => mockGetStaged(...args),
    stageDecision: (...args: unknown[]) => mockStage(...args),
    discardStagedDecision: (...args: unknown[]) => mockDiscard(...args),
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
  candidate_count: 0,
  completed_assessment_count: 0,
  awaiting_decision_count: 0,
  ...sessionServed("LOCKED"),
  withdrawn_count: 1,
  can_be_deleted: false,
  archived_at: null,
  can_be_archived: false,
  can_be_restored: false,
  grading_date: "2026-11-12",
  location: "Riverside",
  notes: "",
};

function candidate(id: number, name: string, overrides: Partial<GradingCandidate> = {}): GradingCandidate {
  return {
    id,
    session: 10,
    student: id + 100,
    student_display_name: name,
    student_first_name: name.split(" ")[0],
    student_wksa_id: `KG-${id}`,
    from_rank: 2,
    from_rank_name: "Yellow Stripe",
    testing_for_rank: 3,
    testing_for_rank_name: "Yellow",
    age_band_display: "9-12",
    status: "COMPLETED",
    withdrawal_reason: "",
    withdrawal_reason_display: "",
    can_be_moved: false,
    can_be_removed: false,
    withdrawal_note: "",
    ...overrides,
  };
}

function assessment(id: number, candidateId: number, overall: CandidateAssessment["overall"]): CandidateAssessment {
  return {
    id,
    candidate: candidateId,
    candidate_student_name: "",
    status: "COMPLETED",
    status_display: "Completed",
    generated_by_name: "PKJN Mia Master",
    overall,
    marks_open: true,
    can_start: false,
    can_delete: false,
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
    status_display: "Proposed",
    proposed_outcome: "PASS",
    proposed_outcome_display: "Pass",
    proposed_by_name: "Morgan Reed",
    proposed_at: "2026-11-12T15:00:00Z",
    proposal_notes: "Clean grading throughout.",
    final_outcome: null,
    final_outcome_display: null,
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
  // Sealed: there is nothing left to complete.
  return { overall: counts, can_complete: false, categories: [] };
}

function item(id: number, overrides: Partial<CandidateAssessmentItem>): CandidateAssessmentItem {
  return {
    id,
    item_name: `Item ${id}`,
    korean_name: "",
    category: "KICKING",
    category_display: "Kicking",
    category_is_core: true,
    reason_required: true,
    can_clear: true,
    position: id,
    required: true,
    display_range: "",
    requirement_notes: "",
    notation: "",
    result: "MET",
    result_display: "Met",
    assessor_name: "KSN Reed Hart",
    assessed_at: "2026-11-12T10:00:00Z",
    comments: [],
    changes: [],
    ...overrides,
  };
}

// Mia is proposed Pass, Alex is proposed Conditional with a shortfall, Tom is
// already finalised, and Sam withdrew.
const cohort = [
  candidate(1, "Mia Okafor"),
  candidate(2, "Alex Carter"),
  candidate(3, "Tom Ashby"),
  candidate(4, "Sam Withdrawn", { status: "WITHDRAWN" }),
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
    status_display: "Finalised",
    final_outcome: "FAIL",
    final_outcome_display: "Fail",
    decided_by_name: "Lee Tan",
    decided_at: "2026-11-12T16:00:00Z",
  }),
] satisfies CandidateOutcome[];

// The roster the server serves: each candidate with their assessment and
// outcome. A proposed outcome in a locked session is open for a final decision.
const assessments = [
  assessment(1001, 1, summary(18, 18, 0).overall),
  assessment(1002, 2, summary(24, 22, 2).overall),
  assessment(1003, 3, summary(18, 18, 0).overall),
];
const servedRoster = cohort.map((row): GradingCandidateRoster => {
  const found = outcomes.find((o) => o.candidate === row.id) ?? null;
  return {
    ...row,
    assessment: assessments.find((a) => a.candidate === row.id) ?? null,
    outcome: found,
    next_action: "REVIEW_DECISION",
    promotion: null,
    can_be_withdrawn_after_lock: false,
    can_be_marked_absent: false,
    can_prepare_assessment: false,
    can_be_finalised: found?.status === "PROPOSED",
    can_download_record: true,
  };
});
// The board asks for the candidates still being graded (withdrawn=false).
const roster = servedRoster.filter((row) => row.status !== "WITHDRAWN");

function renderBoard(
  path = "/gradings/10/decisions",
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
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

/** Past the pause after typing that the board waits for before keeping a change. */
async function passTypingPause() {
  await act(() => vi.advanceTimersByTimeAsync(700));
}

describe("CohortAdjudicationScreen", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentUser = masterUser;
    mockGetGradingSession.mockResolvedValue(lockedSession);
    mockGetCandidates.mockResolvedValue(page(roster));
    // Only the row in focus fetches its full summary, for the evidence pane.
    mockGetSummary.mockImplementation(async (assessmentId: number) =>
      assessmentId === 1002 ? summary(24, 22, 2) : summary(18, 18, 0),
    );
    mockGetItems.mockResolvedValue(
      page([
        item(1, {
          result: "NOT_MET",
          result_display: "Not met",
          item_name: "Dwi Cha Gi",
          comments: [
            {
              id: 1,
              author_name: "Casey Reed",
              body: "Guard dropped on the turn.",
              created_at: "2026-09-18T10:20:00Z",
              after_lock: false,
            },
          ],
        }),
        item(2, {
          item_name: "Ap Cha Gi",
          comments: [
            {
              id: 2,
              author_name: "Casey Reed",
              body: "Excellent chamber.",
              created_at: "2026-09-18T10:20:00Z",
              after_lock: false,
            },
          ],
        }),
        item(3, { item_name: "Yup Cha Gi" }),
      ]),
    );
    mockFinalise.mockImplementation(async (outcomeId: number) => ({
      ...outcomes.find((o) => o.id === outcomeId)!,
      status: "FINALISED",
      status_display: "Finalised",
    }));
    mockGetStaged.mockResolvedValue([]);
    mockStage.mockImplementation(async (outcomeId: number) => ({ outcome: outcomeId }));
    mockDiscard.mockResolvedValue(undefined);
  });

  it("brings back decisions staged earlier, so a timed-out session loses nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetStaged.mockResolvedValue([
      {
        outcome: 12,
        final_outcome: "CONDITIONAL",
        decision_notes: "Strong forms.",
        conditional_requirements: "Re-test Dwi Cha Gi.",
        revision: 1,
        updated_at: "2026-11-12T15:00:00Z",
        discarded: false,
      },
    ]);
    renderBoard();

    const recordAll = await screen.findByTestId("cab-record-staged");
    await waitFor(() => expect(recordAll).toHaveTextContent("Record 1 staged decision"));
    expect(within(screen.getByTestId("cab-row-2")).getByRole("button", { name: "Conditional" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(mockGetStaged).toHaveBeenCalledWith(10);
    await passTypingPause();
    // Already on the server: nothing is sent back.
    expect(mockStage).not.toHaveBeenCalled();
  });

  it("keeps each staged decision on the server, and drops it when it is unstaged", async () => {
    const user = userEvent.setup();
    renderBoard();

    const mia = await screen.findByTestId("cab-row-1");
    await user.click(await within(mia).findByRole("button", { name: "Pass" }));
    await waitFor(() =>
      expect(mockStage).toHaveBeenCalledWith(
        11,
        {
          final_outcome: "PASS",
          decision_notes: "",
          conditional_requirements: "",
          revision: expect.any(Number),
        },
        false,
      ),
    );

    await user.click(within(mia).getByRole("button", { name: "Pass" }));
    await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith(11, expect.any(Number), false));
    expect(mockStage).toHaveBeenCalledTimes(1);
  });

  it("drops a decision taken off the board even when the board is left before the save", async () => {
    const user = userEvent.setup();
    const board = renderBoard();

    const mia = await screen.findByTestId("cab-row-1");
    await user.click(await within(mia).findByRole("button", { name: "Pass" }));
    await waitFor(() => expect(mockStage).toHaveBeenCalledTimes(1));
    await user.click(within(mia).getByRole("button", { name: "Pass" }));
    // Another screen, before the pause that would have saved it.
    board.unmount();

    await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith(11, expect.any(Number), false));
    expect(mockStage).toHaveBeenCalledTimes(1);
  });

  it("keeps a staged decision at once when the page is left, so a closed tab loses nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderBoard();

    const mia = await screen.findByTestId("cab-row-1");
    await user.click(await within(mia).findByRole("button", { name: "Pass" }));
    window.dispatchEvent(new Event("pagehide"));

    await waitFor(() =>
      expect(mockStage).toHaveBeenCalledWith(11, expect.objectContaining({ final_outcome: "PASS" }), true),
    );
    await passTypingPause();
    // Already sent: the pause sends nothing again.
    expect(mockStage).toHaveBeenCalledTimes(1);
  });

  it("sends every unsaved row at once when the page is left, without waiting for one another", async () => {
    const user = userEvent.setup();
    // Never answers: a queued save would wait behind it for good.
    mockStage.mockImplementation(() => new Promise(() => {}));
    renderBoard();

    await user.click(await within(await screen.findByTestId("cab-row-1")).findByRole("button", { name: "Pass" }));
    await user.click(within(screen.getByTestId("cab-row-2")).getByRole("button", { name: "Fail" }));
    window.dispatchEvent(new Event("pagehide"));

    expect(mockStage).toHaveBeenCalledWith(11, expect.objectContaining({ final_outcome: "PASS" }), true);
    expect(mockStage).toHaveBeenCalledWith(12, expect.objectContaining({ final_outcome: "FAIL" }), true);
  });

  it("sends a change made while an earlier save is still on its way when the page is left", async () => {
    const user = userEvent.setup();
    mockStage.mockImplementation(() => new Promise(() => {}));
    renderBoard();

    const mia = await screen.findByTestId("cab-row-1");
    await user.click(await within(mia).findByRole("button", { name: "Pass" }));
    await waitFor(() => expect(mockStage).toHaveBeenCalledTimes(1));
    // Taken off while the save of Pass has not been answered, and the page left.
    await user.click(within(mia).getByRole("button", { name: "Pass" }));
    window.dispatchEvent(new Event("pagehide"));

    expect(mockDiscard).toHaveBeenCalledWith(11, expect.any(Number), true);
  });

  it("says which change each save is, always later than the last, starting above the server's", async () => {
    // A revision far ahead of this device's clock: the next change must still be later.
    const ahead = Date.now() + 60 * 60 * 1000;
    mockGetStaged.mockResolvedValue([
      {
        outcome: 11,
        final_outcome: "FAIL",
        decision_notes: "",
        conditional_requirements: "",
        revision: ahead,
        updated_at: "2026-11-12T15:00:00Z",
        discarded: false,
      },
    ]);
    const user = userEvent.setup();
    renderBoard();

    const mia = await screen.findByTestId("cab-row-1");
    await user.click(await within(mia).findByRole("button", { name: "Pass" }));
    await waitFor(() => expect(mockStage).toHaveBeenCalledTimes(1));
    await user.click(within(mia).getByRole("button", { name: "Pass" }));
    await waitFor(() => expect(mockDiscard).toHaveBeenCalledTimes(1));

    const staged = mockStage.mock.calls[0][1] as { revision: number };
    const discarded = mockDiscard.mock.calls[0][1] as number;
    expect(staged.revision).toBe(ahead + 1);
    expect(discarded).toBeGreaterThan(staged.revision);
  });

  it("starts above a decision taken off on a device whose clock is ahead, and does not show it", async () => {
    const ahead = Date.now() + 60 * 60 * 1000;
    mockGetStaged.mockResolvedValue([
      {
        outcome: 11,
        final_outcome: "",
        decision_notes: "",
        conditional_requirements: "",
        revision: ahead,
        updated_at: "2026-11-12T15:00:00Z",
        discarded: true,
      },
    ]);
    const user = userEvent.setup();
    renderBoard();

    const mia = await screen.findByTestId("cab-row-1");
    const pass = await within(mia).findByRole("button", { name: "Pass" });
    await waitFor(() => expect(pass).toBeEnabled());
    // Taken off is not staged: nothing is shown or counted.
    for (const name of ["Pass", "Fail", "Conditional"]) {
      expect(within(mia).getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
    await user.click(pass);
    await waitFor(() => expect(mockStage).toHaveBeenCalledTimes(1));

    expect((mockStage.mock.calls[0][1] as { revision: number }).revision).toBe(ahead + 1);
    // Nothing is taken off again: the server already holds it taken off.
    expect(mockDiscard).not.toHaveBeenCalled();
  });

  it("does not drop the server's copy of a recorded decision itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderBoard();

    await user.click(await within(await screen.findByTestId("cab-row-1")).findByRole("button", { name: "Pass" }));
    await waitFor(() => expect(mockStage).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId("cab-record-staged"));

    expect(await screen.findByText("1 decision recorded.")).toBeVisible();
    await passTypingPause();
    expect(mockDiscard).not.toHaveBeenCalled();
  });

  it("shows a recorded decision as final by reading the roster again", async () => {
    const user = userEvent.setup();
    let recorded = false;
    mockGetCandidates.mockImplementation(async () =>
      page(
        roster.map((row) =>
          recorded && row.id === 1
            ? {
                ...row,
                outcome: {
                  ...row.outcome!,
                  status: "FINALISED" as const,
                  status_display: "Finalised",
                  final_outcome: "PASS" as const,
                  final_outcome_display: "Pass",
                },
                can_be_finalised: false,
              }
            : row,
        ),
      ),
    );
    mockFinalise.mockImplementation(async (outcomeId: number) => {
      recorded = true;
      return { ...outcomes.find((o) => o.id === outcomeId)!, status: "FINALISED", status_display: "Finalised" };
    });
    renderBoard();

    await user.click(await within(await screen.findByTestId("cab-row-1")).findByRole("button", { name: "Pass" }));
    await user.click(screen.getByTestId("cab-record-staged"));

    expect(await screen.findByText("1 decision recorded.")).toBeVisible();
    await waitFor(() =>
      expect(within(screen.getByTestId("cab-row-1")).queryByRole("button", { name: "Pass" })).toBeNull(),
    );
    expect(mockGetCandidates.mock.calls.length).toBeGreaterThan(1);
  });

  it("reads the staged decisions afresh each time the board opens", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = renderBoard(undefined, queryClient);
    await waitFor(() => expect(mockGetStaged).toHaveBeenCalledTimes(1));
    first.unmount();
    mockGetStaged.mockResolvedValue([
      {
        outcome: 11,
        final_outcome: "FAIL",
        decision_notes: "",
        conditional_requirements: "",
        revision: 1,
        updated_at: "2026-11-12T15:00:00Z",
        discarded: false,
      },
    ]);

    renderBoard(undefined, queryClient);

    await waitFor(() => expect(mockGetStaged).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(within(screen.getByTestId("cab-row-1")).getByRole("button", { name: "Fail" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  it("pauses staging, rather than overwrite, when the staged decisions cannot be read", async () => {
    const user = userEvent.setup();
    mockGetStaged.mockRejectedValueOnce(new ApiError("Server error.", 500));
    renderBoard();

    expect(await screen.findByText(/Your staged decisions could not be loaded/)).toBeVisible();
    expect(within(screen.getByTestId("cab-row-1")).getByRole("button", { name: "Pass" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(within(screen.getByTestId("cab-row-1")).getByRole("button", { name: "Pass" })).toBeEnabled(),
    );
    expect(screen.queryByText(/Your staged decisions could not be loaded/)).toBeNull();
  });

  it("sends one save at a time for a candidate, so the last edit is the one kept", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let finishFirst!: () => void;
    mockStage.mockImplementationOnce(
      (outcomeId: number) => new Promise((resolve) => (finishFirst = () => resolve({ outcome: outcomeId }))),
    );
    renderBoard();

    const mia = await screen.findByTestId("cab-row-1");
    await user.click(await within(mia).findByRole("button", { name: "Pass" }));
    await waitFor(() => expect(mockStage).toHaveBeenCalledTimes(1));
    await user.click(within(mia).getByRole("button", { name: "Fail" }));
    await passTypingPause();
    // The first is still on its way, so the newer one waits for it.
    expect(mockStage).toHaveBeenCalledTimes(1);

    finishFirst();

    await waitFor(() => expect(mockStage).toHaveBeenCalledTimes(2));
    expect(mockStage).toHaveBeenLastCalledWith(11, expect.objectContaining({ final_outcome: "FAIL" }), false);
  });

  it("records a decision only after its save in flight has landed", async () => {
    const user = userEvent.setup();
    let finishSave!: () => void;
    mockStage.mockImplementationOnce(
      (outcomeId: number) => new Promise((resolve) => (finishSave = () => resolve({ outcome: outcomeId }))),
    );
    renderBoard();

    await user.click(await within(await screen.findByTestId("cab-row-1")).findByRole("button", { name: "Pass" }));
    await waitFor(() => expect(mockStage).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId("cab-record-staged"));
    // The save is still on its way, so recording waits behind it.
    expect(mockFinalise).not.toHaveBeenCalled();

    finishSave();

    expect(await screen.findByText("1 decision recorded.")).toBeVisible();
    expect(mockFinalise).toHaveBeenCalledTimes(1);
  });

  it("keeps warning while any candidate's decision is unsaved", async () => {
    const user = userEvent.setup();
    mockStage.mockImplementation(async (outcomeId: number) => {
      if (outcomeId === 11) throw new ApiError("Could not save Mia.", 500);
      return { outcome: outcomeId };
    });
    renderBoard();

    await user.click(await within(await screen.findByTestId("cab-row-1")).findByRole("button", { name: "Pass" }));
    expect(await screen.findByText(/Could not save Mia\./)).toBeVisible();
    await user.click(within(screen.getByTestId("cab-row-2")).getByRole("button", { name: "Fail" }));
    await waitFor(() => expect(mockStage).toHaveBeenCalledWith(12, expect.anything(), false));

    expect(screen.getByText(/Could not save Mia\./)).toBeVisible();
  });

  it("says so when a staged decision cannot be kept", async () => {
    const user = userEvent.setup();
    mockStage.mockRejectedValue(new ApiError("This candidate's decision can no longer be staged.", 400));
    renderBoard();

    await user.click(await within(await screen.findByTestId("cab-row-1")).findByRole("button", { name: "Pass" }));

    expect(
      await screen.findByText(/This candidate's decision can no longer be staged. That decision is still/),
    ).toBeVisible();
  });

  it("does not send a failed save again until the decision changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockStage.mockRejectedValue(new ApiError("The server had a problem.", 500));
    renderBoard();

    const mia = await screen.findByTestId("cab-row-1");
    await user.click(await within(mia).findByRole("button", { name: "Pass" }));
    expect(await screen.findByText(/The server had a problem./)).toBeVisible();
    await passTypingPause();
    await passTypingPause();
    // Showing the failure is not a change: nothing is sent again.
    expect(mockStage).toHaveBeenCalledTimes(1);

    // A change is, and it is sent whatever the server was last thought to hold.
    await user.click(within(mia).getByRole("button", { name: "Fail" }));
    await waitFor(() => expect(mockStage).toHaveBeenCalledTimes(2));
  });

  it("lists the non-withdrawn cohort with served counts, proposals and recorded decisions", async () => {
    renderBoard();

    const alex = await screen.findByTestId("cab-row-2");
    await waitFor(() => expect(within(alex).getByText("22 / 24 met")).toBeVisible());
    expect(within(alex).getByText("2 not met")).toBeVisible();
    expect(within(alex).getByText("Conditional", { selector: '[data-tone="warning"]' })).toBeVisible();
    expect(within(screen.getByTestId("cab-row-3")).getByText("Recorded · Fail")).toBeVisible();
    // The server leaves withdrawn candidates out, and counts them on the session.
    expect(mockGetCandidates).toHaveBeenCalledWith({ session: 10, withdrawn: false });
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
    await user.click(await within(mia).findByRole("button", { name: "Pass" }));
    // Named by the first name the server serves.
    expect(screen.getByRole("button", { name: "Record decision for Mia" })).toBeVisible();
    const alex = screen.getByTestId("cab-row-2");
    await user.click(await within(alex).findByRole("button", { name: "Conditional" }));

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
      return { ...outcomes[0], status: "FINALISED", status_display: "Finalised" };
    });
    renderBoard();

    await user.click(await within(await screen.findByTestId("cab-row-1")).findByRole("button", { name: "Pass" }));
    await user.click(within(screen.getByTestId("cab-row-2")).getByRole("button", { name: "Fail" }));
    await user.click(screen.getByTestId("cab-record-staged"));

    expect(await screen.findByText("1 recorded, 1 could not be recorded and remains staged.")).toBeVisible();
    expect(within(screen.getByTestId("cab-row-2")).getByRole("alert")).toHaveTextContent("Session changed.");

    mockFinalise.mockClear();
    await user.click(screen.getByRole("button", { name: "Retry 1 failed" }));
    await waitFor(() => expect(mockFinalise).toHaveBeenCalledTimes(1));
    expect(mockFinalise).toHaveBeenCalledWith(12, expect.objectContaining({ final_outcome: "FAIL" }));
  });

  it("stops at the row that finds the session ended, and keeps the rows it never tried", async () => {
    const user = userEvent.setup();
    mockFinalise.mockImplementation(async (outcomeId: number) => {
      if (outcomeId === 11) {
        throw new ApiError("Authentication credentials were not provided.", 403, "authentication_required");
      }
      return { ...outcomes[0], status: "FINALISED", status_display: "Finalised" };
    });
    renderBoard();

    await user.click(await within(await screen.findByTestId("cab-row-1")).findByRole("button", { name: "Pass" }));
    await user.click(within(screen.getByTestId("cab-row-2")).getByRole("button", { name: "Fail" }));
    await user.click(screen.getByTestId("cab-record-staged"));

    expect(await screen.findByText("0 recorded, 2 could not be recorded and remain staged.")).toBeVisible();
    expect(mockFinalise).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("cab-record-staged")).toHaveTextContent("Record 2 staged decisions");
  });

  it.each([
    ["roster", () => mockGetCandidates],
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
    mockGetGradingSession.mockResolvedValue({
      ...lockedSession,
      status: "OPEN",
      status_display: "Open",
      ...sessionServed("OPEN"),
    });
    // Nothing can be finalised before the lock, and the rows say so.
    mockGetCandidates.mockResolvedValue(page(roster.map((row) => ({ ...row, can_be_finalised: false }))));
    renderBoard();

    await screen.findByTestId("cab-row-1");
    expect(screen.getByText(/Final decisions open once the session is locked/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
  });

  it("moves focus to the detail pane when a row is chosen on a narrow screen", async () => {
    const user = userEvent.setup();
    // Stacked: the detail heading starts where the queue starts, not beyond it.
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return { left: 0, right: this.classList.contains("rtable") ? 500 : 0 } as DOMRect;
    });
    renderBoard();

    await user.click(
      await within(await screen.findByTestId("cab-row-2")).findByRole("button", { name: "Alex Carter" }),
    );

    await waitFor(() =>
      expect(within(screen.getByTestId("cab-detail")).getByRole("heading", { name: "Alex Carter" })).toHaveFocus(),
    );
    rect.mockRestore();
  });

  it("leaves focus on the row when a row is chosen on a wide screen", async () => {
    const user = userEvent.setup();
    renderBoard();

    const name = await within(await screen.findByTestId("cab-row-2")).findByRole("button", { name: "Alex Carter" });
    await user.click(name);

    expect(within(screen.getByTestId("cab-detail")).getByRole("heading", { name: "Alex Carter" })).toBeVisible();
    expect(name).toHaveFocus();
  });

  it("focuses the requested candidate and shows every recorded note, not only shortfalls", async () => {
    renderBoard("/gradings/10/decisions?candidate=2");

    const detail = await screen.findByTestId("cab-detail");
    expect(within(detail).getByRole("heading", { name: "Alex Carter" })).toBeVisible();
    expect(await within(detail).findByText("“Guard dropped on the turn.”")).toBeVisible();
    expect(within(detail).getByText("“Excellent chamber.”")).toBeVisible();
    expect(within(detail).queryByText(/Yup Cha Gi/)).toBeNull();
    expect(within(detail).getByText("Back kick needs a re-test.")).toBeVisible();
    expect(within(detail).getByRole("link", { name: "Open the full assessment record" })).toHaveAttribute(
      "href",
      "/gradings/10/assessments/2/review",
    );
  });
});
