import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PromotionLedgerScreen } from "./PromotionLedgerScreen";
import type {
  AuthUser,
  CandidateOutcome,
  GradingCandidate,
  GradingSession,
  Promotion,
} from "./api";

let mockCurrentUser: AuthUser = {
  id: "uuid-master",
  email: "master.kim@kuksoolwon.test",
  first_name: "In Hyuk",
  last_name: "Kim",
  full_name: "In Hyuk Kim",
  role_display: "Instructor",
  can_make_final_grading_decision: true,
  can_promote_student: true,
  can_override_locked_session: true,
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

vi.mock("./auth", () => ({
  useAuth: () => ({
    user: mockCurrentUser,
    status: "authenticated",
  }),
}));

const mockGetGradingSession = vi.fn();
const mockGetGradingCandidates = vi.fn();
const mockGetCandidateOutcomes = vi.fn();
const mockGetPromotions = vi.fn();
const mockGetPromotionEligibility = vi.fn();
const mockPromoteCandidateOutcome = vi.fn();
const mockBulkPromoteCandidateOutcomes = vi.fn();

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getGradingSession: (...args: unknown[]) => mockGetGradingSession(...args),
    getAllGradingCandidates: (...args: unknown[]) => mockGetGradingCandidates(...args),
    getAllCandidateOutcomes: (...args: unknown[]) => mockGetCandidateOutcomes(...args),
    getAllPromotions: (...args: unknown[]) => mockGetPromotions(...args),
    getPromotionEligibility: (...args: unknown[]) => mockGetPromotionEligibility(...args),
    promoteCandidateOutcome: (...args: unknown[]) => mockPromoteCandidateOutcome(...args),
    bulkPromoteCandidateOutcomes: (...args: unknown[]) => mockBulkPromoteCandidateOutcomes(...args),
  };
});

const mockSession: GradingSession = {
  id: 1,
  title: "Autumn 2026 Grading",
  status: "LOCKED",
  status_display: "Locked",
  candidate_count: 0,
  completed_assessment_count: 0,
  awaiting_decision_count: 0,
  can_be_deleted: false,
  grading_date: "2026-10-15",
  location: "Main Dojang",
  notes: "Annual autumn examination",
};


// A locked session: every candidate's assessment is completed.
const mockCandidates: GradingCandidate[] = [
  {
    id: 101,
    session: 1,
    student: 50,
    student_display_name: "Alex Mercer",
    student_wksa_id: "K-88231",
    from_rank: 2,
    from_rank_name: "Yellow stripe",
    testing_for_rank: 3,
    testing_for_rank_name: "Yellow",
    age_band_display: "9-12",
    status: "COMPLETED",
    withdrawal_reason: "",
    withdrawal_reason_display: "",
    can_be_moved: false,
    can_be_removed: false,
    withdrawal_note: "",
  },
  {
    id: 102,
    session: 1,
    student: 51,
    student_display_name: "Beth Harmon",
    student_wksa_id: "K-88232",
    from_rank: 3,
    from_rank_name: "Yellow",
    testing_for_rank: 4,
    testing_for_rank_name: "Blue Stripe",
    age_band_display: "9-12",
    status: "COMPLETED",
    withdrawal_reason: "",
    withdrawal_reason_display: "",
    can_be_moved: false,
    can_be_removed: false,
    withdrawal_note: "",
  },
  {
    id: 103,
    session: 1,
    student: 52,
    student_display_name: "Carlos Rivera",
    student_wksa_id: "K-88233",
    from_rank: 2,
    from_rank_name: "Yellow stripe",
    testing_for_rank: 3,
    testing_for_rank_name: "Yellow",
    age_band_display: "9-12",
    status: "COMPLETED",
    withdrawal_reason: "",
    withdrawal_reason_display: "",
    can_be_moved: false,
    can_be_removed: false,
    withdrawal_note: "",
  },
  {
    id: 104,
    session: 1,
    student: 53,
    student_display_name: "Diana Prince",
    student_wksa_id: "K-88234",
    from_rank: 2,
    from_rank_name: "Yellow stripe",
    testing_for_rank: 3,
    testing_for_rank_name: "Yellow",
    age_band_display: "9-12",
    status: "COMPLETED",
    withdrawal_reason: "",
    withdrawal_reason_display: "",
    can_be_moved: false,
    can_be_removed: false,
    withdrawal_note: "",
  },
  {
    id: 105,
    session: 1,
    student: 54,
    student_display_name: "Ethan Hunt",
    student_wksa_id: "K-88235",
    from_rank: 2,
    from_rank_name: "Yellow stripe",
    testing_for_rank: 3,
    testing_for_rank_name: "Yellow",
    age_band_display: "9-12",
    status: "COMPLETED",
    withdrawal_reason: "",
    withdrawal_reason_display: "",
    can_be_moved: false,
    can_be_removed: false,
    withdrawal_note: "",
  },
  {
    id: 106,
    session: 1,
    student: 55,
    student_display_name: "Fiona Gallagher",
    student_wksa_id: "K-88236",
    from_rank: 2,
    from_rank_name: "Yellow stripe",
    testing_for_rank: 3,
    testing_for_rank_name: "Yellow",
    age_band_display: "9-12",
    status: "COMPLETED",
    withdrawal_reason: "",
    withdrawal_reason_display: "",
    can_be_moved: false,
    can_be_removed: false,
    withdrawal_note: "",
  },
];

const mockOutcomes: CandidateOutcome[] = [
  {
    id: 101,
    candidate: 101,
    proposed_outcome: "PASS",
    proposed_outcome_display: "Pass",
    proposed_by_name: "In Hyuk Kim",
    proposed_at: "2026-10-15T16:00:00Z",
    proposal_notes: "",
    status: "FINALISED",
    final_outcome: "PASS",
    final_outcome_display: "Pass",
    decided_by_name: "In Hyuk Kim",
    decided_at: "2026-10-15T17:00:00Z",
    decision_notes: "Strong technique",
    conditional_requirements: "",
  },
  {
    id: 102,
    candidate: 102,
    proposed_outcome: "PASS",
    proposed_outcome_display: "Pass",
    proposed_by_name: "In Hyuk Kim",
    proposed_at: "2026-10-15T16:00:00Z",
    proposal_notes: "",
    status: "FINALISED",
    final_outcome: "PASS",
    final_outcome_display: "Pass",
    decided_by_name: "In Hyuk Kim",
    decided_at: "2026-10-15T17:05:00Z",
    decision_notes: "Excellent forms",
    conditional_requirements: "",
  },
  {
    id: 103,
    candidate: 103,
    proposed_outcome: "PASS",
    proposed_outcome_display: "Pass",
    proposed_by_name: "In Hyuk Kim",
    proposed_at: "2026-10-15T16:00:00Z",
    proposal_notes: "",
    status: "FINALISED",
    final_outcome: "PASS",
    final_outcome_display: "Pass",
    decided_by_name: "In Hyuk Kim",
    decided_at: "2026-10-15T17:10:00Z",
    decision_notes: "Solid",
    conditional_requirements: "",
  },
  {
    id: 104,
    candidate: 104,
    proposed_outcome: "CONDITIONAL",
    proposed_outcome_display: "Conditional",
    proposed_by_name: "In Hyuk Kim",
    proposed_at: "2026-10-15T16:00:00Z",
    proposal_notes: "",
    status: "FINALISED",
    final_outcome: "CONDITIONAL",
    final_outcome_display: "Conditional",
    decided_by_name: "In Hyuk Kim",
    decided_at: "2026-10-15T17:15:00Z",
    decision_notes: "Needs re-test on Ki Bohn Soo",
    conditional_requirements: "Ki Bohn Soo 6-10",
  },
  {
    id: 105,
    candidate: 105,
    proposed_outcome: "FAIL",
    proposed_outcome_display: "Fail",
    proposed_by_name: "In Hyuk Kim",
    proposed_at: "2026-10-15T16:00:00Z",
    proposal_notes: "",
    status: "FINALISED",
    final_outcome: "FAIL",
    final_outcome_display: "Fail",
    decided_by_name: "In Hyuk Kim",
    decided_at: "2026-10-15T17:20:00Z",
    decision_notes: "Requires more preparation",
    conditional_requirements: "",
  },
  {
    id: 106,
    candidate: 106,
    proposed_outcome: "PASS",
    proposed_outcome_display: "Pass",
    proposed_by_name: "In Hyuk Kim",
    proposed_at: "2026-10-15T15:00:00Z",
    proposal_notes: "",
    status: "PROPOSED",
    final_outcome: null,
    final_outcome_display: "",
    decided_by_name: "",
    decided_at: null,
    decision_notes: "",
    conditional_requirements: "",
  },
];

function createMockPromotion(
  overrides: Partial<Promotion> & {
    id: number;
    student: number;
    student_display_name: string;
    grading_candidate: number;
    outcome: number;
  },
): Promotion {
  return {
    to_rank_name: "Yellow",
    effective_date: "2026-10-15",
    ...overrides,
  };
}

const mockExistingPromotions: Promotion[] = [
  createMockPromotion({
    id: 1,
    student: 52,
    student_display_name: "Carlos Rivera",
    grading_candidate: 103,
    outcome: 103,
  }),
];

function renderScreen(
  sessionId = 1,
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/gradings/${sessionId}/promotions`]}>
        <Routes>
          <Route path="/gradings/:id/promotions" element={<PromotionLedgerScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PromotionLedgerScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    mockCurrentUser = {
      id: "uuid-master",
      email: "master.kim@kuksoolwon.test",
      first_name: "In Hyuk",
      last_name: "Kim",
      full_name: "In Hyuk Kim",
      role_display: "Instructor",
      can_make_final_grading_decision: true,
      can_promote_student: true,
      can_override_locked_session: true,
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

    mockGetGradingSession.mockResolvedValue(mockSession);
    mockGetGradingCandidates.mockResolvedValue({
      count: mockCandidates.length,
      next: null,
      previous: null,
      results: mockCandidates,
    });
    mockGetCandidateOutcomes.mockResolvedValue({
      count: mockOutcomes.length,
      next: null,
      previous: null,
      results: mockOutcomes,
    });
    mockGetPromotions.mockResolvedValue({
      count: mockExistingPromotions.length,
      next: null,
      previous: null,
      results: mockExistingPromotions,
    });
    mockGetPromotionEligibility.mockResolvedValue([
      { candidate: 101, outcome: 101, eligible: true, reason: "" },
      { candidate: 102, outcome: 102, eligible: true, reason: "" },
      { candidate: 103, outcome: 103, eligible: false, reason: "Outcome already has a promotion." },
      { candidate: 104, outcome: 104, eligible: false, reason: "Only a pass can be promoted." },
      { candidate: 105, outcome: 105, eligible: false, reason: "Only a pass can be promoted." },
      { candidate: 106, outcome: 106, eligible: false, reason: "Only finalised candidate outcomes can be promoted." },
    ]);
  });

  it("renders screen header, breadcrumbs, candidate rows, and summary banner", async () => {
    renderScreen(1);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Autumn 2026 Grading — Promotion Ledger" }),
      ).toBeInTheDocument();
    });

    // Breadcrumb navigation
    expect(screen.getByRole("link", { name: "Grading Sessions" })).toHaveAttribute(
      "href",
      "/gradings",
    );
    expect(screen.getByRole("link", { name: "Autumn 2026 Grading" })).toHaveAttribute(
      "href",
      "/gradings/1",
    );
    expect(screen.getByText("Promotion Ledger", { selector: "[aria-current=\"page\"]" })).toBeInTheDocument();

    // Summary banner (Alex and Beth are eligible, Carlos is already promoted)
    expect(
      screen.getByText("2 Candidates Finalised with Pass · Eligible for Promotion"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Promote Qualified Cohort \(2 Candidates\)/i,
      }),
    ).toBeInTheDocument();

    // Candidates in table
    expect(screen.getByText("Alex Mercer")).toBeInTheDocument();
    expect(screen.getByText("Beth Harmon")).toBeInTheDocument();
    expect(screen.getByText("Carlos Rivera")).toBeInTheDocument();
    expect(screen.getByText("Diana Prince")).toBeInTheDocument();
    expect(screen.getByText("Ethan Hunt")).toBeInTheDocument();
    expect(screen.getByText("Fiona Gallagher")).toBeInTheDocument();
  });

  it("uses the server's black-belt ID blocker instead of marking a pass eligible", async () => {
    mockGetPromotionEligibility.mockResolvedValue([
      { candidate: 101, outcome: 101, eligible: false, reason: "Record Alex Mercer's black belt ID before promoting them to JKN." },
      { candidate: 102, outcome: 102, eligible: true, reason: "" },
      { candidate: 103, outcome: 103, eligible: false, reason: "Outcome already has a promotion." },
      { candidate: 104, outcome: 104, eligible: false, reason: "Only a pass can be promoted." },
      { candidate: 105, outcome: 105, eligible: false, reason: "Only a pass can be promoted." },
      { candidate: 106, outcome: 106, eligible: false, reason: "Only finalised candidate outcomes can be promoted." },
    ]);

    renderScreen(1);
    const row = await screen.findByTestId("promotion-row-101");
    expect(row).toHaveTextContent("black belt ID");
    expect(screen.queryByTestId("promote-candidate-btn-101")).not.toBeInTheDocument();
    expect(screen.getByText("1 Candidate Finalised with Pass · Eligible for Promotion")).toBeInTheDocument();
  });

  it("blocks promotion when the promotions could not be loaded, until a retry succeeds", async () => {
    // Without promotions, Carlos (already promoted) would read as eligible.
    mockGetPromotions.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    renderScreen(1);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("could not be loaded");
    expect(screen.queryByText("Carlos Rivera")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Promote Qualified Cohort/i })).toBeDisabled();

    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Carlos Rivera")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Promote Qualified Cohort \(2 Candidates\)/i }),
    ).toBeEnabled();
  });

  it("displays correct eligibility badges and action states across candidate statuses", async () => {
    renderScreen(1);

    await waitFor(() => {
      expect(screen.getByText("Alex Mercer")).toBeInTheDocument();
    });

    // Row 101 (Alex Mercer): Pass (Finalised), Eligible for Yellow, Promote button
    const row101 = screen.getByTestId("promotion-row-101");
    expect(row101).toHaveTextContent("Pass (Finalised)");
    expect(row101).toHaveTextContent("Eligible for Yellow");
    expect(screen.getByTestId("promote-candidate-btn-101")).toHaveTextContent("Promote to Yellow");

    // Row 102 (Beth Harmon): Pass (Finalised), Eligible for Blue Stripe, Promote button
    const row102 = screen.getByTestId("promotion-row-102");
    expect(row102).toHaveTextContent("Pass (Finalised)");
    expect(row102).toHaveTextContent("Eligible for Blue Stripe");
    expect(screen.getByTestId("promote-candidate-btn-102")).toHaveTextContent(
      "Promote to Blue Stripe",
    );

    // Row 103 (Carlos Rivera): Already promoted to Yellow
    const row103 = screen.getByTestId("promotion-row-103");
    expect(row103).toHaveTextContent("Pass (Finalised)");
    expect(row103).toHaveTextContent("Promoted to Yellow ✓");
    expect(row103).toHaveTextContent("Effective 15 Oct 2026");
    expect(row103).toHaveTextContent("Promoted ✓");
    expect(screen.queryByTestId("promote-candidate-btn-103")).not.toBeInTheDocument();

    // Row 104 (Diana Prince): Conditional (Finalised)
    const row104 = screen.getByTestId("promotion-row-104");
    expect(row104).toHaveTextContent("Conditional (Finalised)");
    expect(row104).toHaveTextContent("Only a pass can be promoted.");
    expect(screen.queryByTestId("promote-candidate-btn-104")).not.toBeInTheDocument();

    // Row 105 (Ethan Hunt): Fail (Finalised)
    const row105 = screen.getByTestId("promotion-row-105");
    expect(row105).toHaveTextContent("Fail (Finalised)");
    expect(row105).toHaveTextContent("Only a pass can be promoted.");
    expect(screen.queryByTestId("promote-candidate-btn-105")).not.toBeInTheDocument();

    // Row 106 (Fiona Gallagher): Proposed Pass (Pending finalisation)
    const row106 = screen.getByTestId("promotion-row-106");
    // The served display, never the raw enum.
    expect(row106).toHaveTextContent("Proposed: Pass");
    expect(row106).not.toHaveTextContent("PASS");
    expect(row106).toHaveTextContent("Only finalised candidate outcomes can be promoted.");
    expect(screen.queryByTestId("promote-candidate-btn-106")).not.toBeInTheDocument();
  });

  it("reads each row's rank and promotion from that candidate alone, even when ids overlap", async () => {
    // Deliberately overlapping ids: Ana's student id is a rank id, and each
    // candidate's id is the other's outcome id. Rows keyed on anything but
    // the candidate's own snapshot and promotion would cross-contaminate.
    const ana: GradingCandidate = {
      ...mockCandidates[0],
      id: 7,
      student: 3,
      student_display_name: "Ana Overlap",
      from_rank: 5,
      from_rank_name: "Blue",
      testing_for_rank: 6,
      testing_for_rank_name: "Red stripe",
    };
    const ben: GradingCandidate = {
      ...mockCandidates[0],
      id: 9,
      student: 4,
      student_display_name: "Ben Overlap",
    };
    mockGetGradingCandidates.mockResolvedValue({
      count: 2,
      next: null,
      previous: null,
      results: [ana, ben],
    });
    mockGetCandidateOutcomes.mockResolvedValue({
      count: 2,
      next: null,
      previous: null,
      results: [
        { ...mockOutcomes[0], id: 9, candidate: 7, student: 3, student_display_name: "Ana Overlap" },
        { ...mockOutcomes[0], id: 7, candidate: 9, student: 4, student_display_name: "Ben Overlap" },
      ],
    });
    mockGetPromotions.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [
        createMockPromotion({
          id: 1,
          student: 4,
          student_display_name: "Ben Overlap",
          grading_candidate: 9,
          outcome: 7,
        }),
      ],
    });
    mockGetPromotionEligibility.mockResolvedValue([
      { candidate: 7, outcome: 9, eligible: true, reason: "" },
      { candidate: 9, outcome: 7, eligible: false, reason: "Outcome already has a promotion." },
    ]);

    renderScreen(1);

    const anaRow = await screen.findByTestId("promotion-row-7");
    expect(anaRow).toHaveTextContent("Blue");
    expect(anaRow).not.toHaveTextContent("Promoted ✓");
    expect(screen.getByTestId("promote-candidate-btn-7")).toHaveTextContent(
      "Promote to Red stripe",
    );
    expect(screen.getByTestId("promotion-row-9")).toHaveTextContent("Promoted ✓");
  });

  it("handles single candidate promotion confirmation dialog and API submission", async () => {
    const user = userEvent.setup();
    const newPromotion = createMockPromotion({
      id: 2,
      student: 50,
      student_display_name: "Alex Mercer",
      grading_candidate: 101,
      outcome: 101,
    });
    mockPromoteCandidateOutcome.mockResolvedValue(newPromotion);

    renderScreen(1);

    await waitFor(() => {
      expect(screen.getByTestId("promote-candidate-btn-101")).toBeInTheDocument();
    });

    // Open confirmation modal
    await user.click(screen.getByTestId("promote-candidate-btn-101"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Confirm Student Promotion" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Alex Mercer", { selector: ".pl-modal-name" })).toBeInTheDocument();
    expect(
      screen.getByText("Effective date:", { exact: false }),
    ).toHaveTextContent("15 Oct 2026");

    // Enter optional ceremonial remarks
    const notesTextarea = screen.getByLabelText("Promotion Notes (Optional)");
    await user.type(notesTextarea, "Demonstrated great focus");

    // Confirm promotion
    const modal = screen.getByRole("dialog");
    const confirmBtn = within(modal).getByRole("button", { name: "Promote to Yellow" });
    await user.click(confirmBtn);

    expect(mockPromoteCandidateOutcome).toHaveBeenCalledWith(101, {
      notes: "Demonstrated great focus",
    });

    await waitFor(() => {
      expect(
        screen.getByText("Successfully promoted Alex Mercer to Yellow!"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("marks every cached view of the promoted student stale", async () => {
    const user = userEvent.setup();
    mockPromoteCandidateOutcome.mockResolvedValue(
      createMockPromotion({
        id: 2,
        student: 50,
        student_display_name: "Alex Mercer",
        grading_candidate: 101,
        outcome: 101,
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["students", "detail", 50], { id: 50 });
    queryClient.setQueryData(["students", "list", "", "ALL", "ALL", 1], { results: [] });
    queryClient.setQueryData(["students", "rankHistory", 50], { promotions: [] });

    renderScreen(1, queryClient);
    await user.click(await screen.findByTestId("promote-candidate-btn-101"));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Promote to Yellow" }),
    );

    await waitFor(() => {
      expect(queryClient.getQueryState(["students", "detail", 50])?.isInvalidated).toBe(true);
    });
    expect(queryClient.getQueryState(["students", "list", "", "ALL", "ALL", 1])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["students", "rankHistory", 50])?.isInvalidated).toBe(true);
  });

  it("can cancel single candidate promotion modal without calling API", async () => {
    const user = userEvent.setup();
    renderScreen(1);

    await waitFor(() => {
      expect(screen.getByTestId("promote-candidate-btn-101")).toBeInTheDocument();
    });

    const promoteButton = screen.getByTestId("promote-candidate-btn-101");
    await user.click(promoteButton);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockPromoteCandidateOutcome).not.toHaveBeenCalled();
    expect(promoteButton).toHaveFocus();
  });

  it("opens batch promotion summary, displays eligible candidates, and executes bulk promotion", async () => {
    const user = userEvent.setup();
    const bulkResponse = {
      promoted: [
        createMockPromotion({
          id: 2,
          student: 50,
          student_display_name: "Alex Mercer",
          grading_candidate: 101,
          outcome: 101,
        }),
        createMockPromotion({
          id: 3,
          student: 51,
          student_display_name: "Beth Harmon",
          grading_candidate: 102,
          outcome: 102,
          to_rank_name: "Blue Stripe",
        }),
      ],
      errors: {},
    };
    mockBulkPromoteCandidateOutcomes.mockResolvedValue(bulkResponse);

    renderScreen(1);

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: /Promote Qualified Cohort \(2 Candidates\)/i,
        }),
      ).toBeInTheDocument();
    });

    // Open batch promotion summary
    await user.click(
      screen.getByRole("button", {
        name: /Promote Qualified Cohort \(2 Candidates\)/i,
      }),
    );

    const tray = screen.getByRole("dialog", {
      name: "Promotion summary",
    });
    expect(tray).toBeInTheDocument();
    expect(screen.getByText("2 Candidates Selected")).toBeInTheDocument();

    // Check candidate pills
    expect(screen.getByText("1.")).toBeInTheDocument();
    expect(screen.getByText("Alex Mercer", { selector: ".pl-chip-name" })).toBeInTheDocument();
    expect(screen.getByText("Yellow", { selector: ".pl-chip-target" })).toBeInTheDocument();

    expect(screen.getByText("2.")).toBeInTheDocument();
    expect(screen.getByText("Beth Harmon", { selector: ".pl-chip-name" })).toBeInTheDocument();
    expect(screen.getByText("Blue Stripe", { selector: ".pl-chip-target" })).toBeInTheDocument();

    // Metadata in right section: the session's grading date, labelled as such.
    expect(screen.getByText("15 Oct 2026", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("Grading date", { selector: "dt" })).toBeInTheDocument();
    expect(screen.getByText("In Hyuk Kim", { selector: "dd" })).toBeInTheDocument();

    // Confirm batch promotion
    const confirmBatchBtn = screen.getByRole("button", {
      name: /Confirm promotions/i,
    });
    await user.click(confirmBatchBtn);

    expect(mockBulkPromoteCandidateOutcomes).toHaveBeenCalledWith({
      outcomes: [101, 102],
    });

    await waitFor(() => {
      expect(
        screen.getByText("Successfully promoted all 2 qualified candidates!"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog", { name: "Promotion summary" })).not.toBeInTheDocument();
  });

  it("can close the batch promotion summary without promoting", async () => {
    const user = userEvent.setup();
    renderScreen(1);

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: /Promote Qualified Cohort \(2 Candidates\)/i,
        }),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", {
        name: /Promote Qualified Cohort \(2 Candidates\)/i,
      }),
    );
    expect(
      screen.getByRole("dialog", { name: "Promotion summary" }),
    ).toBeInTheDocument();

    const closeBtn = screen.getByRole("button", {
      name: "Close the promotion summary",
    });
    await user.click(closeBtn);

    expect(
      screen.queryByRole("dialog", { name: "Promotion summary" }),
    ).not.toBeInTheDocument();
    expect(mockBulkPromoteCandidateOutcomes).not.toHaveBeenCalled();
  });

  it("restricts actions and displays warning when user lacks can_promote_student permission", async () => {
    mockCurrentUser = {
      ...mockCurrentUser,
      can_promote_student: false,
    };

    renderScreen(1);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading candidate promotion ledger…"),
      ).not.toBeInTheDocument();
    });

    expect(screen.getByText("Promotion authority needed")).toBeInTheDocument();
    expect(
      screen.getByText(/promoting students needs promotion authority/),
    ).toBeInTheDocument();

    // Cohort promotion CTA is disabled
    const summaryBtn = screen.getByRole("button", {
      name: /Promote Qualified Cohort \(2 Candidates\)/i,
    });
    expect(summaryBtn).toBeDisabled();

    // Inline row promotion buttons are disabled
    expect(screen.getByTestId("promote-candidate-btn-101")).toBeDisabled();
    expect(screen.getByTestId("promote-candidate-btn-102")).toBeDisabled();
  });

  it("handles batch promotion partial errors", async () => {
    const user = userEvent.setup();
    mockBulkPromoteCandidateOutcomes.mockResolvedValue({
      promoted: [
        createMockPromotion({
          id: 2,
          student: 50,
          student_display_name: "Alex Mercer",
          grading_candidate: 101,
          outcome: 101,
        }),
      ],
      // The backend's shape: row index -> that row's messages.
      errors: { "1": ["Outcome 102 cannot be promoted at this time"] },
    });

    renderScreen(1);

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: /Promote Qualified Cohort \(2 Candidates\)/i,
        }),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", {
        name: /Promote Qualified Cohort \(2 Candidates\)/i,
      }),
    );

    const confirmBatchBtn = screen.getByRole("button", {
      name: /Confirm promotions/i,
    });
    await user.click(confirmBatchBtn);

    // Row 1 of the request is outcome 102: the candidate is named, with why.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Promoted 1 of 2. Not promoted - Beth Harmon: Outcome 102 cannot be promoted at this time",
    );
  });

  it("shows informational notice when all candidates are already promoted", async () => {
    // Both eligible candidates have now already been promoted
    mockGetPromotions.mockResolvedValue({
      count: 3,
      next: null,
      previous: null,
      results: [
        mockExistingPromotions[0],
        createMockPromotion({
          id: 2,
          student: 50,
          student_display_name: "Alex Mercer",
          grading_candidate: 101,
          outcome: 101,
        }),
        createMockPromotion({
          id: 3,
          student: 51,
          student_display_name: "Beth Harmon",
          grading_candidate: 102,
          outcome: 102,
          to_rank_name: "Blue Stripe",
        }),
      ],
    });
    mockGetPromotionEligibility.mockResolvedValue([
      { candidate: 101, outcome: 101, eligible: false, reason: "Outcome already has a promotion." },
      { candidate: 102, outcome: 102, eligible: false, reason: "Outcome already has a promotion." },
      { candidate: 103, outcome: 103, eligible: false, reason: "Outcome already has a promotion." },
      { candidate: 104, outcome: 104, eligible: false, reason: "Only a pass can be promoted." },
      { candidate: 105, outcome: 105, eligible: false, reason: "Only a pass can be promoted." },
      { candidate: 106, outcome: 106, eligible: false, reason: "Only finalised candidate outcomes can be promoted." },
    ]);

    renderScreen(1);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading candidate promotion ledger…"),
      ).not.toBeInTheDocument();
    });

    expect(
      screen.getByText("0 Candidates Finalised with Pass · Eligible for Promotion"),
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        "All qualified candidates in this cohort have already been promoted.",
      ),
    ).toBeInTheDocument();

    const summaryBtn = screen.getByRole("button", {
      name: /Promote Qualified Cohort \(0 Candidates\)/i,
    });
    expect(summaryBtn).toBeDisabled();
  });
});
