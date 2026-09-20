import "@testing-library/jest-dom/vitest";
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
  Rank,
} from "./api";

let mockCurrentUser: AuthUser = {
  id: "uuid-master",
  email: "master.kim@kuksoolwon.test",
  first_name: "In Hyuk",
  last_name: "Kim",
  full_name: "In Hyuk Kim",
  role: "instructor",
  role_display: "Instructor",
  can_make_final_grading_decision: true,
  can_promote_student: true,
  can_override_locked_session: true,
  must_change_password: false,
  is_staff: false,
  is_superuser: false,
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
const mockGetRanks = vi.fn();
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
    getRanks: (...args: unknown[]) => mockGetRanks(...args),
    promoteCandidateOutcome: (...args: unknown[]) => mockPromoteCandidateOutcome(...args),
    bulkPromoteCandidateOutcomes: (...args: unknown[]) => mockBulkPromoteCandidateOutcomes(...args),
  };
});

const mockSession: GradingSession = {
  id: 1,
  title: "Autumn 2026 Grading",
  status: "LOCKED",
  status_display: "Locked",
  grading_date: "2026-10-15",
  location: "Main Dojang",
  notes: "Annual autumn examination",
  created_by: "uuid-master",
  created_by_email: "master.kim@kuksoolwon.test",
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-10-15T18:00:00Z",
};

const mockRanks: Rank[] = [
  {
    id: 1,
    code: "WHITE",
    name: "White",
    order: 1,
    category: "COLOURED_BELT",
    category_display: "Coloured Belt",
    active: true,
  },
  {
    id: 2,
    code: "YELLOW_STRIPE",
    name: "Yellow Stripe",
    order: 2,
    category: "COLOURED_BELT",
    category_display: "Coloured Belt",
    active: true,
  },
  {
    id: 3,
    code: "YELLOW",
    name: "Yellow",
    order: 3,
    category: "COLOURED_BELT",
    category_display: "Coloured Belt",
    active: true,
  },
  {
    id: 4,
    code: "BLUE_STRIPE",
    name: "Blue Stripe",
    order: 4,
    category: "COLOURED_BELT",
    category_display: "Coloured Belt",
    active: true,
  },
];

const mockCandidates: GradingCandidate[] = [
  {
    id: 101,
    session: 1,
    session_title: "Autumn 2026 Grading",
    student: 50,
    student_display_name: "Alex Mercer",
    student_wksa_id: "K-88231",
    testing_for_rank: 3,
    testing_for_rank_code: "YELLOW",
    testing_for_rank_name: "Yellow",
    age_band: "AGE_9_TO_12",
    age_band_display: "9-12",
    status: "REGISTERED",
    status_display: "Registered",
    notes: "",
    created_at: "2026-09-18T10:00:00Z",
    updated_at: "2026-09-18T10:00:00Z",
  },
  {
    id: 102,
    session: 1,
    session_title: "Autumn 2026 Grading",
    student: 51,
    student_display_name: "Beth Harmon",
    student_wksa_id: "K-88232",
    testing_for_rank: 4,
    testing_for_rank_code: "BLUE_STRIPE",
    testing_for_rank_name: "Blue Stripe",
    age_band: "AGE_9_TO_12",
    age_band_display: "9-12",
    status: "REGISTERED",
    status_display: "Registered",
    notes: "",
    created_at: "2026-09-18T10:00:00Z",
    updated_at: "2026-09-18T10:00:00Z",
  },
  {
    id: 103,
    session: 1,
    session_title: "Autumn 2026 Grading",
    student: 52,
    student_display_name: "Carlos Rivera",
    student_wksa_id: "K-88233",
    testing_for_rank: 3,
    testing_for_rank_code: "YELLOW",
    testing_for_rank_name: "Yellow",
    age_band: "AGE_9_TO_12",
    age_band_display: "9-12",
    status: "REGISTERED",
    status_display: "Registered",
    notes: "",
    created_at: "2026-09-18T10:00:00Z",
    updated_at: "2026-09-18T10:00:00Z",
  },
  {
    id: 104,
    session: 1,
    session_title: "Autumn 2026 Grading",
    student: 53,
    student_display_name: "Diana Prince",
    student_wksa_id: "K-88234",
    testing_for_rank: 3,
    testing_for_rank_code: "YELLOW",
    testing_for_rank_name: "Yellow",
    age_band: "AGE_9_TO_12",
    age_band_display: "9-12",
    status: "REGISTERED",
    status_display: "Registered",
    notes: "",
    created_at: "2026-09-18T10:00:00Z",
    updated_at: "2026-09-18T10:00:00Z",
  },
  {
    id: 105,
    session: 1,
    session_title: "Autumn 2026 Grading",
    student: 54,
    student_display_name: "Ethan Hunt",
    student_wksa_id: "K-88235",
    testing_for_rank: 3,
    testing_for_rank_code: "YELLOW",
    testing_for_rank_name: "Yellow",
    age_band: "AGE_9_TO_12",
    age_band_display: "9-12",
    status: "REGISTERED",
    status_display: "Registered",
    notes: "",
    created_at: "2026-09-18T10:00:00Z",
    updated_at: "2026-09-18T10:00:00Z",
  },
  {
    id: 106,
    session: 1,
    session_title: "Autumn 2026 Grading",
    student: 55,
    student_display_name: "Fiona Gallagher",
    student_wksa_id: "K-88236",
    testing_for_rank: 3,
    testing_for_rank_code: "YELLOW",
    testing_for_rank_name: "Yellow",
    age_band: "AGE_9_TO_12",
    age_band_display: "9-12",
    status: "REGISTERED",
    status_display: "Registered",
    notes: "",
    created_at: "2026-09-18T10:00:00Z",
    updated_at: "2026-09-18T10:00:00Z",
  },
];

const mockOutcomes: CandidateOutcome[] = [
  {
    id: 101,
    candidate: 101,
    assessment: 201,
    assessment_status: "COMPLETED",
    student: 50,
    student_display_name: "Alex Mercer",
    student_wksa_id: "K-88231",
    session: 1,
    session_title: "Autumn 2026 Grading",
    testing_for_rank: 3,
    testing_for_rank_code: "YELLOW",
    testing_for_rank_name: "Yellow",
    proposed_outcome: "PASS",
    proposed_outcome_display: "Pass",
    proposed_by: "uuid-master",
    proposed_by_email: "master.kim@kuksoolwon.test",
    proposed_by_name: "In Hyuk Kim",
    proposed_at: "2026-10-15T16:00:00Z",
    proposal_notes: "",
    status: "FINALISED",
    status_display: "Finalised",
    final_outcome: "PASS",
    final_outcome_display: "Pass",
    decided_by: "uuid-master",
    decided_by_email: "master.kim@kuksoolwon.test",
    decided_by_name: "In Hyuk Kim",
    decided_at: "2026-10-15T17:00:00Z",
    decision_notes: "Strong technique",
    conditional_requirements: "",
    created_at: "2026-10-15T15:00:00Z",
    updated_at: "2026-10-15T17:00:00Z",
  },
  {
    id: 102,
    candidate: 102,
    assessment: 202,
    assessment_status: "COMPLETED",
    student: 51,
    student_display_name: "Beth Harmon",
    student_wksa_id: "K-88232",
    session: 1,
    session_title: "Autumn 2026 Grading",
    testing_for_rank: 4,
    testing_for_rank_code: "BLUE_STRIPE",
    testing_for_rank_name: "Blue Stripe",
    proposed_outcome: "PASS",
    proposed_outcome_display: "Pass",
    proposed_by: "uuid-master",
    proposed_by_email: "master.kim@kuksoolwon.test",
    proposed_by_name: "In Hyuk Kim",
    proposed_at: "2026-10-15T16:00:00Z",
    proposal_notes: "",
    status: "FINALISED",
    status_display: "Finalised",
    final_outcome: "PASS",
    final_outcome_display: "Pass",
    decided_by: "uuid-master",
    decided_by_email: "master.kim@kuksoolwon.test",
    decided_by_name: "In Hyuk Kim",
    decided_at: "2026-10-15T17:05:00Z",
    decision_notes: "Excellent forms",
    conditional_requirements: "",
    created_at: "2026-10-15T15:00:00Z",
    updated_at: "2026-10-15T17:05:00Z",
  },
  {
    id: 103,
    candidate: 103,
    assessment: 203,
    assessment_status: "COMPLETED",
    student: 52,
    student_display_name: "Carlos Rivera",
    student_wksa_id: "K-88233",
    session: 1,
    session_title: "Autumn 2026 Grading",
    testing_for_rank: 3,
    testing_for_rank_code: "YELLOW",
    testing_for_rank_name: "Yellow",
    proposed_outcome: "PASS",
    proposed_outcome_display: "Pass",
    proposed_by: "uuid-master",
    proposed_by_email: "master.kim@kuksoolwon.test",
    proposed_by_name: "In Hyuk Kim",
    proposed_at: "2026-10-15T16:00:00Z",
    proposal_notes: "",
    status: "FINALISED",
    status_display: "Finalised",
    final_outcome: "PASS",
    final_outcome_display: "Pass",
    decided_by: "uuid-master",
    decided_by_email: "master.kim@kuksoolwon.test",
    decided_by_name: "In Hyuk Kim",
    decided_at: "2026-10-15T17:10:00Z",
    decision_notes: "Solid",
    conditional_requirements: "",
    created_at: "2026-10-15T15:00:00Z",
    updated_at: "2026-10-15T17:10:00Z",
  },
  {
    id: 104,
    candidate: 104,
    assessment: 204,
    assessment_status: "COMPLETED",
    student: 53,
    student_display_name: "Diana Prince",
    student_wksa_id: "K-88234",
    session: 1,
    session_title: "Autumn 2026 Grading",
    testing_for_rank: 3,
    testing_for_rank_code: "YELLOW",
    testing_for_rank_name: "Yellow",
    proposed_outcome: "CONDITIONAL",
    proposed_outcome_display: "Conditional",
    proposed_by: "uuid-master",
    proposed_by_email: "master.kim@kuksoolwon.test",
    proposed_by_name: "In Hyuk Kim",
    proposed_at: "2026-10-15T16:00:00Z",
    proposal_notes: "",
    status: "FINALISED",
    status_display: "Finalised",
    final_outcome: "CONDITIONAL",
    final_outcome_display: "Conditional",
    decided_by: "uuid-master",
    decided_by_email: "master.kim@kuksoolwon.test",
    decided_by_name: "In Hyuk Kim",
    decided_at: "2026-10-15T17:15:00Z",
    decision_notes: "Needs re-test on Ki Bohn Soo",
    conditional_requirements: "Ki Bohn Soo 6-10",
    created_at: "2026-10-15T15:00:00Z",
    updated_at: "2026-10-15T17:15:00Z",
  },
  {
    id: 105,
    candidate: 105,
    assessment: 205,
    assessment_status: "COMPLETED",
    student: 54,
    student_display_name: "Ethan Hunt",
    student_wksa_id: "K-88235",
    session: 1,
    session_title: "Autumn 2026 Grading",
    testing_for_rank: 3,
    testing_for_rank_code: "YELLOW",
    testing_for_rank_name: "Yellow",
    proposed_outcome: "FAIL",
    proposed_outcome_display: "Fail",
    proposed_by: "uuid-master",
    proposed_by_email: "master.kim@kuksoolwon.test",
    proposed_by_name: "In Hyuk Kim",
    proposed_at: "2026-10-15T16:00:00Z",
    proposal_notes: "",
    status: "FINALISED",
    status_display: "Finalised",
    final_outcome: "FAIL",
    final_outcome_display: "Fail",
    decided_by: "uuid-master",
    decided_by_email: "master.kim@kuksoolwon.test",
    decided_by_name: "In Hyuk Kim",
    decided_at: "2026-10-15T17:20:00Z",
    decision_notes: "Requires more preparation",
    conditional_requirements: "",
    created_at: "2026-10-15T15:00:00Z",
    updated_at: "2026-10-15T17:20:00Z",
  },
  {
    id: 106,
    candidate: 106,
    assessment: 206,
    assessment_status: "IN_PROGRESS",
    student: 55,
    student_display_name: "Fiona Gallagher",
    student_wksa_id: "K-88236",
    session: 1,
    session_title: "Autumn 2026 Grading",
    testing_for_rank: 3,
    testing_for_rank_code: "YELLOW",
    testing_for_rank_name: "Yellow",
    proposed_outcome: "PASS",
    proposed_outcome_display: "Pass",
    proposed_by: "uuid-master",
    proposed_by_email: "master.kim@kuksoolwon.test",
    proposed_by_name: "In Hyuk Kim",
    proposed_at: "2026-10-15T15:00:00Z",
    proposal_notes: "",
    status: "PROPOSED",
    status_display: "Proposed",
    final_outcome: null,
    final_outcome_display: "",
    decided_by: null,
    decided_by_email: "",
    decided_by_name: "",
    decided_at: null,
    decision_notes: "",
    conditional_requirements: "",
    created_at: "2026-10-15T15:00:00Z",
    updated_at: "2026-10-15T15:00:00Z",
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
    student_wksa_id: "K-88000",
    student_current_rank: overrides.to_rank || 3,
    student_current_rank_code: overrides.to_rank_code || "YELLOW",
    student_current_rank_name: overrides.to_rank_name || "Yellow",
    session: 1,
    session_title: "Autumn 2026 Grading",
    grading_date: "2026-10-15",
    from_rank: 2,
    from_rank_code: "YELLOW_STRIPE",
    from_rank_name: "Yellow Stripe",
    to_rank: 3,
    to_rank_code: "YELLOW",
    to_rank_name: "Yellow",
    promoted_by: "uuid-master",
    promoted_by_email: "master.kim@kuksoolwon.test",
    promoted_by_name: "In Hyuk Kim",
    promoted_at: "2026-10-15T18:00:00Z",
    effective_date: "2026-10-15",
    notes: "",
    created_at: "2026-10-15T18:00:00Z",
    updated_at: "2026-10-15T18:00:00Z",
    ...overrides,
  };
}

const mockExistingPromotions: Promotion[] = [
  createMockPromotion({
    id: 1,
    student: 52,
    student_display_name: "Carlos Rivera",
    student_wksa_id: "K-88233",
    grading_candidate: 103,
    outcome: 103,
    notes: "Batch promoted",
  }),
];

function renderScreen(sessionId = 1) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
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
      role: "instructor",
      role_display: "Instructor",
      can_make_final_grading_decision: true,
      can_promote_student: true,
      can_override_locked_session: true,
      must_change_password: false,
      is_staff: false,
      is_superuser: false,
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
    mockGetRanks.mockResolvedValue({
      count: mockRanks.length,
      next: null,
      previous: null,
      results: mockRanks,
    });
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
    expect(screen.getByText("Promotion Ledger", { selector: ".pl-breadcrumb-current" })).toBeInTheDocument();

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
    expect(row104).toHaveTextContent("Re-test required before promotion");
    expect(screen.queryByTestId("promote-candidate-btn-104")).not.toBeInTheDocument();

    // Row 105 (Ethan Hunt): Fail (Finalised)
    const row105 = screen.getByTestId("promotion-row-105");
    expect(row105).toHaveTextContent("Fail (Finalised)");
    expect(row105).toHaveTextContent("Outcome not passed");
    expect(screen.queryByTestId("promote-candidate-btn-105")).not.toBeInTheDocument();

    // Row 106 (Fiona Gallagher): Proposed Pass (Pending finalisation)
    const row106 = screen.getByTestId("promotion-row-106");
    expect(row106).toHaveTextContent("Proposed: PASS");
    expect(row106).toHaveTextContent("Outcome pending finalisation");
    expect(screen.queryByTestId("promote-candidate-btn-106")).not.toBeInTheDocument();
  });

  it("handles single candidate promotion confirmation dialog and API submission", async () => {
    const user = userEvent.setup();
    const newPromotion = createMockPromotion({
      id: 2,
      student: 50,
      student_display_name: "Alex Mercer",
      student_wksa_id: "K-88231",
      grading_candidate: 101,
      outcome: 101,
      notes: "Demonstrated great focus",
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

  it("opens pinned batch preview tray, displays eligible candidates, and executes bulk promotion", async () => {
    const user = userEvent.setup();
    const bulkResponse = {
      promoted: [
        createMockPromotion({
          id: 2,
          student: 50,
          student_display_name: "Alex Mercer",
          student_wksa_id: "K-88231",
          grading_candidate: 101,
          outcome: 101,
        }),
        createMockPromotion({
          id: 3,
          student: 51,
          student_display_name: "Beth Harmon",
          student_wksa_id: "K-88232",
          grading_candidate: 102,
          outcome: 102,
          from_rank: 3,
          from_rank_code: "YELLOW",
          from_rank_name: "Yellow",
          to_rank: 4,
          to_rank_code: "BLUE_STRIPE",
          to_rank_name: "Blue Stripe",
        }),
      ],
      errors: [],
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

    // Open pinned batch confirmation tray
    await user.click(
      screen.getByRole("button", {
        name: /Promote Qualified Cohort \(2 Candidates\)/i,
      }),
    );

    const tray = screen.getByRole("region", {
      name: "Pinned batch confirmation preview",
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

    // Metadata in right section
    expect(screen.getByText("15 Oct 2026", { selector: ".pl-meta-val" })).toBeInTheDocument();
    expect(screen.getByText("In Hyuk Kim", { selector: ".pl-meta-val" })).toBeInTheDocument();

    // Confirm batch promotion
    const confirmBatchBtn = screen.getByRole("button", {
      name: /Confirm Batch Promotion/i,
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
    expect(screen.queryByRole("region", { name: "Pinned batch confirmation preview" })).not.toBeInTheDocument();
  });

  it("can close the pinned batch preview tray without promoting", async () => {
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
      screen.getByRole("region", { name: "Pinned batch confirmation preview" }),
    ).toBeInTheDocument();

    const closeBtn = screen.getByRole("button", {
      name: "Close batch preview tray",
    });
    await user.click(closeBtn);

    expect(
      screen.queryByRole("region", { name: "Pinned batch confirmation preview" }),
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

    expect(screen.getByText("Promotion Authority Required")).toBeInTheDocument();
    expect(
      screen.getByText(/You do not hold the/),
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
          student_wksa_id: "K-88231",
          grading_candidate: 101,
          outcome: 101,
        }),
      ],
      errors: ["Outcome 102 cannot be promoted at this time"],
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
      name: /Confirm Batch Promotion/i,
    });
    await user.click(confirmBatchBtn);

    await waitFor(() => {
      expect(
        screen.getByText("Promoted 1 candidates, but 1 encountered errors."),
      ).toBeInTheDocument();
    });
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
          student_wksa_id: "K-88231",
          grading_candidate: 101,
          outcome: 101,
        }),
        createMockPromotion({
          id: 3,
          student: 51,
          student_display_name: "Beth Harmon",
          student_wksa_id: "K-88232",
          grading_candidate: 102,
          outcome: 102,
          from_rank: 3,
          from_rank_code: "YELLOW",
          from_rank_name: "Yellow",
          to_rank: 4,
          to_rank_code: "BLUE_STRIPE",
          to_rank_name: "Blue Stripe",
        }),
      ],
    });

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
