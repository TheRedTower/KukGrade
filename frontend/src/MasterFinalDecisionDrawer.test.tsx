import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MasterFinalDecisionDrawer } from "./MasterFinalDecisionDrawer";
import type {
  AuthUser,
  CandidateAssessment,
  CandidateAssessmentSummary,
  CandidateOutcome,
  GradingCandidate,
} from "./api";

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

let mockCurrentUser: AuthUser = {
  id: "uuid-42",
  email: "master.kim@kuksoolwon.test",
  first_name: "In Hyuk",
  last_name: "Kim",
  full_name: "In Hyuk Kim",
  role: "instructor",
  role_display: "Instructor",
  can_make_final_grading_decision: true,
  can_promote_student: true,
  can_override_locked_session: false,
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

const mockFinaliseCandidateOutcome = vi.fn();
const mockGetCandidateAssessmentSummary = vi.fn();

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    finaliseCandidateOutcome: (...args: unknown[]) => mockFinaliseCandidateOutcome(...args),
    getCandidateAssessmentSummary: (...args: unknown[]) =>
      mockGetCandidateAssessmentSummary(...args),
  };
});

const mockCandidate: GradingCandidate = {
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
};

const mockOutcome: CandidateOutcome = {
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
  proposed_by: "user-12",
  proposed_by_email: "davis@kuksoolwon.test",
  proposed_by_name: "Instructor Davis",
  proposed_at: "2026-09-18T11:00:00Z",
  proposal_notes: "Very consistent forms, sharp kicks.",
  final_outcome: null,
  final_outcome_display: "",
  decided_by: null,
  decided_by_email: "",
  decided_by_name: "",
  decided_at: null,
  decision_notes: "",
  conditional_requirements: "",
  status: "PROPOSED",
  status_display: "Proposed",
  created_at: "2026-09-18T11:00:00Z",
  updated_at: "2026-09-18T11:00:00Z",
};

const mockAssessment: CandidateAssessment = {
  id: 201,
  candidate: 101,
  candidate_student_name: "Alex Mercer",
  candidate_student_wksa_id: "K-88231",
  testing_for_rank_code: "YELLOW",
  testing_for_rank_name: "Yellow",
  age_band: "AGE_9_TO_12",
  age_band_display: "9-12",
  status: "COMPLETED",
  status_display: "Completed",
  generated_by: "uuid-12",
  generated_by_email: "davis@kuksoolwon.test",
  generated_at: "2026-09-18T10:00:00Z",
  started_at: "2026-09-18T10:15:00Z",
  completed_at: "2026-09-18T10:45:00Z",
  notes: "Strong focus and etiquette throughout.",
  item_counts: {},
  created_at: "2026-09-18T10:00:00Z",
  updated_at: "2026-09-18T10:45:00Z",
};

const mockSummary: CandidateAssessmentSummary = {
  overall: {
    total: 14,
    required: 14,
    met: 14,
    not_met: 0,
    not_assessed: 0,
    required_met: 14,
    required_not_met: 0,
    required_not_assessed: 0,
    all_required_assessed: true,
    all_required_met: true,
  },
  categories: [
    {
      category: "Etiquette & Stances",
      total: 4,
      required: 4,
      met: 4,
      not_met: 0,
      not_assessed: 0,
      required_met: 4,
      required_not_met: 0,
      required_not_assessed: 0,
      all_required_assessed: true,
      all_required_met: true,
    },
    {
      category: "Technique Set",
      total: 6,
      required: 6,
      met: 6,
      not_met: 0,
      not_assessed: 0,
      required_met: 6,
      required_not_met: 0,
      required_not_assessed: 0,
      all_required_assessed: true,
      all_required_met: true,
    },
    {
      category: "Form / Hyung",
      total: 4,
      required: 4,
      met: 4,
      not_met: 0,
      not_assessed: 0,
      required_met: 4,
      required_not_met: 0,
      required_not_assessed: 0,
      all_required_assessed: true,
      all_required_met: true,
    },
  ],
};

describe("MasterFinalDecisionDrawer (SCR-022)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentUser = {
      id: "uuid-42",
      email: "master.kim@kuksoolwon.test",
      first_name: "In Hyuk",
      last_name: "Kim",
      full_name: "In Hyuk Kim",
      role: "instructor",
      role_display: "Instructor",
      can_make_final_grading_decision: true,
      can_promote_student: true,
      can_override_locked_session: false,
      must_change_password: false,
      is_staff: false,
      is_superuser: false,
    };
    mockGetCandidateAssessmentSummary.mockResolvedValue(mockSummary);
    mockFinaliseCandidateOutcome.mockImplementation((_id: number, payload: unknown) =>
      Promise.resolve({
        ...mockOutcome,
        ...(payload as Record<string, unknown>),
        status: "FINALISED",
      }),
    );
  });

  it("renders candidate context header, assessment ledger, and instructor recommendation", async () => {
    renderWithClient(
      <MasterFinalDecisionDrawer
        candidate={mockCandidate}
        assessment={mockAssessment}
        outcome={mockOutcome}
        currentRankName="Yellow Stripe"
        targetRankName="Yellow"
        sessionStatus="LOCKED"
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    // Candidate header details
    expect(screen.getByText("Alex Mercer")).toBeInTheDocument();
    expect(screen.getByText("(WKSA ID: K-88231)")).toBeInTheDocument();
    expect(screen.getByText(/Targeting:/)).toBeInTheDocument();

    // Assessment ledger breakdown
    await waitFor(() => {
      expect(screen.getByText("Etiquette & Stances")).toBeInTheDocument();
      expect(screen.getByText("Technique Set")).toBeInTheDocument();
      expect(screen.getByText("Form / Hyung")).toBeInTheDocument();
      expect(screen.getByText("14 of 14 Met (100%)")).toBeInTheDocument();
    });

    // Instructor recommendation note box
    expect(
      screen.getByText(/Instructor recommendation note by Instructor Davis/),
    ).toBeInTheDocument();
    expect(screen.getByText("Very consistent forms, sharp kicks.")).toBeInTheDocument();

    // Master authority card
    expect(screen.getByText("In Hyuk Kim")).toBeInTheDocument();
    expect(screen.getByText("Authorised Master")).toBeInTheDocument();
    expect(screen.getByText("Gold Seal Authority")).toBeInTheDocument();
  });

  it("handles outcome ratification selection and conditionally requires re-test criteria", async () => {
    const user = userEvent.setup();

    renderWithClient(
      <MasterFinalDecisionDrawer
        candidate={mockCandidate}
        assessment={mockAssessment}
        outcome={mockOutcome}
        currentRankName="Yellow Stripe"
        targetRankName="Yellow"
        sessionStatus="LOCKED"
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    // Conditional textarea should not exist initially when PASS is selected
    expect(screen.queryByLabelText(/conditional.*requirements/i)).not.toBeInTheDocument();

    // Click CONDITIONAL ratification card
    const conditionalRadio = screen.getByRole("radio", { name: /Conditional/i });
    await user.click(conditionalRadio);

    // Now conditional requirements textarea should be present
    const condTextarea = screen.getByLabelText(/conditional.*requirements/i);
    expect(condTextarea).toBeInTheDocument();

    // Attempt to submit without requirements
    const submitBtn = screen.getByRole("button", { name: /Finalise & Seal Decision/i });
    await user.click(submitBtn);

    expect(
      screen.getByText(/Conditional requirements are required when choosing a Conditional outcome\./i),
    ).toBeInTheDocument();
    expect(mockFinaliseCandidateOutcome).not.toHaveBeenCalled();

    // Fill in conditional requirements
    await user.type(condTextarea, "Re-assess Sohn Mohk Soo #3-5 within 30 days.");
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockFinaliseCandidateOutcome).toHaveBeenCalledWith(101, {
        final_outcome: "CONDITIONAL",
        decision_notes: "",
        conditional_requirements: "Re-assess Sohn Mohk Soo #3-5 within 30 days.",
      });
    });
  });

  it("submits PASS outcome with Master notes when session is locked", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    mockFinaliseCandidateOutcome.mockResolvedValue({
      ...mockOutcome,
      final_outcome: "PASS",
      decision_notes: "Exemplary forms and spirit.",
      status: "FINALISED",
    });

    renderWithClient(
      <MasterFinalDecisionDrawer
        candidate={mockCandidate}
        assessment={mockAssessment}
        outcome={mockOutcome}
        currentRankName="Yellow Stripe"
        targetRankName="Yellow"
        sessionStatus="LOCKED"
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    // Enter master notes
    const notesInput = screen.getByLabelText(/Master Determination Notes/i);
    await user.type(notesInput, "Exemplary forms and spirit.");

    const submitBtn = screen.getByRole("button", { name: /Finalise & Seal Decision/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockFinaliseCandidateOutcome).toHaveBeenCalledWith(101, {
        final_outcome: "PASS",
        decision_notes: "Exemplary forms and spirit.",
      });
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("shows warning banner and disables sealing button when session is not locked", async () => {
    renderWithClient(
      <MasterFinalDecisionDrawer
        candidate={mockCandidate}
        assessment={mockAssessment}
        outcome={mockOutcome}
        currentRankName="Yellow Stripe"
        targetRankName="Yellow"
        sessionStatus="IN_PROGRESS"
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Session Must Be Locked Before Finalising"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Final outcomes can only be sealed after the grading session is locked\./i),
    ).toBeInTheDocument();

    const submitBtn = screen.getByRole("button", { name: /Finalise & Seal Decision/i });
    expect(submitBtn).toBeDisabled();
  });

  it("renders read-only mode when outcome is already FINALISED", () => {
    const finalisedOutcome: CandidateOutcome = {
      ...mockOutcome,
      status: "FINALISED",
      final_outcome: "PASS",
      decided_by_name: "Master In Hyuk Kim",
      decision_notes: "Ratified with distinction.",
    };

    renderWithClient(
      <MasterFinalDecisionDrawer
        candidate={mockCandidate}
        assessment={mockAssessment}
        outcome={finalisedOutcome}
        currentRankName="Yellow Stripe"
        targetRankName="Yellow"
        sessionStatus="LOCKED"
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText("Outcome Finalised & Sealed")).toBeInTheDocument();
    expect(
      screen.getByText(/This grading outcome has been ratified and sealed by Master In Hyuk Kim\./i),
    ).toBeInTheDocument();

    // Options and inputs are disabled
    const radios = screen.getAllByRole("radio");
    radios.forEach((r) => expect(r).toBeDisabled());

    // Primary action button is Close Drawer instead of Finalise & Seal
    expect(screen.queryByRole("button", { name: /Finalise & Seal Decision/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Close Drawer/i })).toBeInTheDocument();
  });

  it("shows permission gate warning when user lacks can_make_final_grading_decision", () => {
    mockCurrentUser = {
      ...mockCurrentUser,
      can_make_final_grading_decision: false,
    };

    renderWithClient(
      <MasterFinalDecisionDrawer
        candidate={mockCandidate}
        assessment={mockAssessment}
        outcome={mockOutcome}
        currentRankName="Yellow Stripe"
        targetRankName="Yellow"
        sessionStatus="LOCKED"
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText("Master Authority Required")).toBeInTheDocument();
    expect(
      screen.getByText(/You do not hold the can_make_final_grading_decision authority\./i),
    ).toBeInTheDocument();

    const submitBtn = screen.getByRole("button", { name: /Finalise & Seal Decision/i });
    expect(submitBtn).toBeDisabled();
  });

  it("closes drawer when clicking Cancel button or pressing Escape key", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderWithClient(
      <MasterFinalDecisionDrawer
        candidate={mockCandidate}
        assessment={mockAssessment}
        outcome={mockOutcome}
        currentRankName="Yellow Stripe"
        targetRankName="Yellow"
        sessionStatus="LOCKED"
        isOpen={true}
        onClose={onClose}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: /Pass/i })).toHaveFocus();

    const cancelBtn = screen.getByRole("button", { name: /Cancel/i });
    await user.click(cancelBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
