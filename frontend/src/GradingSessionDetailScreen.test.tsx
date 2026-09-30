import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GradingSessionDetailScreen } from "./GradingSessionDetailScreen";
import { ApiError, type AuthUser, type GradingCandidate, type GradingSession } from "./api";

let currentUser: AuthUser;
const mockGetGradingSession = vi.fn();
const mockGetAllGradingCandidates = vi.fn();
const mockGetAllCandidateAssessments = vi.fn();
const mockGetAllCandidateOutcomes = vi.fn();
const mockDeleteGradingSession = vi.fn();
const mockGetAllGradingSessions = vi.fn();
const mockMoveGradingCandidate = vi.fn();
const mockDeleteGradingCandidate = vi.fn();
const mockUpdateGradingSession = vi.fn();

vi.mock("./auth", () => ({
  useAuth: () => ({ user: currentUser, status: "authenticated" }),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getGradingSession: (...args: unknown[]) => mockGetGradingSession(...args),
    getAllGradingCandidates: (...args: unknown[]) =>
      mockGetAllGradingCandidates(...args),
    getAllCandidateAssessments: (...args: unknown[]) =>
      mockGetAllCandidateAssessments(...args),
    getAllCandidateOutcomes: (...args: unknown[]) =>
      mockGetAllCandidateOutcomes(...args),
    deleteGradingSession: (...args: unknown[]) =>
      mockDeleteGradingSession(...args),
    getAllGradingSessions: (...args: unknown[]) => mockGetAllGradingSessions(...args),
    moveGradingCandidate: (...args: unknown[]) => mockMoveGradingCandidate(...args),
    deleteGradingCandidate: (...args: unknown[]) => mockDeleteGradingCandidate(...args),
    updateGradingSession: (...args: unknown[]) => mockUpdateGradingSession(...args),
  };
});

const adminUser: AuthUser = {
  id: "admin-user",
  email: "admin@example.com",
  first_name: "Admin",
  last_name: "User",
  full_name: "Admin User",
  role_display: "Administrator",
  can_make_final_grading_decision: false,
  can_promote_student: true,
  can_override_locked_session: true,
  can_view_grading_audit_log: false,
  can_manage_users: true,
  can_import_data: true,
  can_reconcile_imported_history: true,
  can_delete_students: true,
  can_delete_assessments: true,
  can_delete_any_session: true,
  can_read_audit_log: true,
  must_change_password: false,
};

const instructorUser: AuthUser = {
  ...adminUser,
  id: "instructor-user",
  email: "instructor@example.com",
  role_display: "Instructor",
  can_promote_student: false,
  can_override_locked_session: false,
  can_manage_users: false,
  can_import_data: false,
  can_reconcile_imported_history: false,
  can_delete_students: false,
  can_delete_assessments: false,
  can_delete_any_session: false,
  can_read_audit_log: false,
};

function lockedSession(): GradingSession {
  return {
    id: 7,
    title: "March 2027 Colchester Grading",
    grading_date: "2027-03-20",
    status: "LOCKED",
    status_display: "Locked",
    candidate_count: 0,
    completed_assessment_count: 0,
    awaiting_decision_count: 0,
    can_be_deleted: false,
    location: "Colchester",
    notes: "",
  };
}

function emptyPage() {
  return { count: 0, next: null, previous: null, results: [] };
}

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/gradings/7"]}>
        <Routes>
          <Route
            path="/gradings/:id"
            element={<GradingSessionDetailScreen />}
          />
          <Route path="/gradings" element={<h1>Gradings list</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("GradingSessionDetailScreen delete action on a locked session", () => {
  beforeEach(() => {
    mockGetGradingSession.mockReset().mockResolvedValue(lockedSession());
    mockGetAllGradingCandidates.mockReset().mockResolvedValue(emptyPage());
    mockGetAllCandidateAssessments.mockReset().mockResolvedValue(emptyPage());
    mockGetAllCandidateOutcomes.mockReset().mockResolvedValue(emptyPage());
    mockDeleteGradingSession.mockReset().mockResolvedValue(undefined);
  });

  it("does not offer a delete menu item for a non-administrator", async () => {
    currentUser = instructorUser;
    const user = userEvent.setup();

    renderScreen();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "March 2027 Colchester Grading" }),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Session actions/i }));

    expect(
      screen.queryByRole("menuitem", { name: "Delete session" }),
    ).not.toBeInTheDocument();
  });

  it("lets an administrator delete a locked session after confirming", async () => {
    currentUser = adminUser;
    const user = userEvent.setup();

    renderScreen();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "March 2027 Colchester Grading" }),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Session actions/i }));
    await user.click(screen.getByRole("menuitem", { name: "Delete session" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Delete Grading Session",
    });
    expect(dialog).toHaveTextContent("finalised outcome and promotion");

    await user.click(screen.getByRole("button", { name: "Delete session" }));

    await waitFor(() =>
      expect(mockDeleteGradingSession).toHaveBeenCalledWith(7),
    );
    await waitFor(() =>
      expect(screen.getByText("Gradings list")).toBeInTheDocument(),
    );
  });
});

function openSession(overrides: Partial<GradingSession> = {}): GradingSession {
  return { ...lockedSession(), status: "OPEN", status_display: "Open", ...overrides };
}

function registeredCandidate(overrides: Partial<GradingCandidate> = {}): GradingCandidate {
  return {
    id: 31,
    session: 7,
    student: 131,
    student_display_name: "Mia Okafor",
    student_wksa_id: "KG-31",
    from_rank: 1,
    from_rank_name: "White",
    testing_for_rank: 2,
    testing_for_rank_name: "Yellow Stripe",
    age_band_display: "18+",
    status: "REGISTERED",
    withdrawal_reason: "",
    withdrawal_reason_display: "",
    can_be_moved: true,
    can_be_removed: true,
    withdrawal_note: "",
    ...overrides,
  };
}

describe("GradingSessionDetailScreen registration actions", () => {
  beforeEach(() => {
    currentUser = instructorUser;
    mockGetGradingSession.mockReset().mockResolvedValue(openSession());
    mockGetAllGradingCandidates
      .mockReset()
      .mockResolvedValue({ ...emptyPage(), count: 1, results: [registeredCandidate()] });
    mockGetAllCandidateAssessments.mockReset().mockResolvedValue(emptyPage());
    mockGetAllCandidateOutcomes.mockReset().mockResolvedValue(emptyPage());
    mockGetAllGradingSessions.mockReset().mockResolvedValue({
      ...emptyPage(),
      count: 3,
      results: [
        openSession(),
        openSession({ id: 8, title: "April Grading", status: "DRAFT", grading_date: "2027-04-17" }),
        openSession({ id: 10, title: "May Grading", grading_date: "2027-05-15" }),
      ],
    });
    mockMoveGradingCandidate.mockReset().mockResolvedValue(registeredCandidate());
    mockDeleteGradingCandidate.mockReset().mockResolvedValue(undefined);
  });

  it("moves a registration to another draft or open session", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: "Move Mia Okafor to another session" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Move Mia Okafor" });
    const select = within(dialog).getByLabelText("Move to");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(3));
    // The server is asked for only the sessions that accept candidates, and
    // this one is not offered as its own destination.
    expect(mockGetAllGradingSessions).toHaveBeenCalledWith({ status: "DRAFT,OPEN" });
    expect(within(select).queryByRole("option", { name: /March 2027/ })).toBeNull();

    await user.selectOptions(select, "10");
    await user.click(within(dialog).getByRole("button", { name: "Move registration" }));

    await waitFor(() => expect(mockMoveGradingCandidate).toHaveBeenCalledWith(31, 10));
    expect(await screen.findByText("Mia Okafor was moved to another session.")).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the move dialog open with the server's reason when it is refused", async () => {
    mockMoveGradingCandidate.mockRejectedValue(
      new ApiError("Session and testing-for rank cannot be changed after an assessment snapshot has been generated.", 400),
    );
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: "Move Mia Okafor to another session" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Move Mia Okafor" });
    await waitFor(() =>
      expect(within(dialog).getAllByRole("option").length).toBeGreaterThan(1),
    );
    await user.selectOptions(within(dialog).getByLabelText("Move to"), "8");
    await user.click(within(dialog).getByRole("button", { name: "Move registration" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "cannot be changed after an assessment snapshot",
    );
  });

  it("removes a registration after confirming", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: "Remove Mia Okafor's registration" }));
    const dialog = screen.getByRole("dialog", { name: "Remove Mia Okafor" });
    expect(dialog).toHaveTextContent("its assessment, which has not been started");
    await user.click(within(dialog).getByRole("button", { name: "Remove registration" }));

    await waitFor(() => expect(mockDeleteGradingCandidate).toHaveBeenCalledWith(31));
    expect(await screen.findByText("Mia Okafor was removed from this session.")).toBeVisible();
  });

  it("offers only the actions the server says the registration allows", async () => {
    mockGetAllGradingCandidates.mockResolvedValue({
      ...emptyPage(),
      count: 2,
      results: [
        registeredCandidate({ can_be_moved: false }),
        registeredCandidate({
          id: 32,
          student: 132,
          student_display_name: "Ben Hall",
          can_be_moved: false,
          can_be_removed: false,
        }),
      ],
    });
    renderScreen();

    await screen.findByText("Ben Hall");
    expect(screen.queryByRole("button", { name: /to another session/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Mia Okafor's registration" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Remove Ben Hall's registration" })).toBeNull();
  });
});

describe("GradingSessionDetailScreen opening a draft session", () => {
  const draftSession = () => ({
    ...lockedSession(),
    status: "DRAFT" as const,
    status_display: "Draft",
  });

  beforeEach(() => {
    currentUser = instructorUser;
    mockGetGradingSession.mockReset().mockResolvedValue(draftSession());
    mockGetAllGradingCandidates.mockReset().mockResolvedValue({
      ...emptyPage(),
      count: 2,
      results: [
        registeredCandidate(),
        registeredCandidate({ id: 32, student: 132, student_display_name: "Ben Hall" }),
      ],
    });
    mockGetAllCandidateAssessments.mockReset().mockResolvedValue(emptyPage());
    mockGetAllCandidateOutcomes.mockReset().mockResolvedValue(emptyPage());
    mockUpdateGradingSession
      .mockReset()
      .mockResolvedValue({ ...draftSession(), status: "OPEN", status_display: "Open" });
  });

  async function chooseOpenSession(user: ReturnType<typeof userEvent.setup>) {
    renderScreen();
    await screen.findByText("Ben Hall");
    await user.click(screen.getByRole("button", { name: /Session actions/i }));
    await user.click(screen.getByRole("menuitem", { name: "Open session" }));
    return screen.findByRole("dialog", { name: "Open Grading Session" });
  }

  it("asks for confirmation, with the roster count, before opening", async () => {
    const user = userEvent.setup();
    const dialog = await chooseOpenSession(user);

    expect(dialog).toHaveTextContent("2 candidates are registered");
    expect(dialog).toHaveTextContent("cannot be undone");
    expect(mockUpdateGradingSession).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(mockUpdateGradingSession).toHaveBeenCalledWith(7, { status: "OPEN" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("does not count withdrawn candidates as registered", async () => {
    mockGetAllGradingCandidates.mockResolvedValue({
      ...emptyPage(),
      count: 2,
      results: [
        registeredCandidate(),
        registeredCandidate({ id: 32, student: 132, student_display_name: "Ben Hall", status: "WITHDRAWN" }),
      ],
    });
    const user = userEvent.setup();
    const dialog = await chooseOpenSession(user);

    expect(dialog).toHaveTextContent("1 candidate is registered");
  });

  it("leaves the session in draft when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    const dialog = await chooseOpenSession(user);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockUpdateGradingSession).not.toHaveBeenCalled();
  });

  it("keeps the confirmation open with the server's reason when opening is refused", async () => {
    mockUpdateGradingSession.mockRejectedValue(new ApiError("Cannot transition grading session from DRAFT to OPEN.", 400));
    const user = userEvent.setup();
    const dialog = await chooseOpenSession(user);

    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/Cannot transition grading session from DRAFT to OPEN/)).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Open Grading Session" })).toBeVisible();
  });
});
