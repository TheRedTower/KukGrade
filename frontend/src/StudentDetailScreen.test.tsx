import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StudentDetailScreen } from "./StudentDetailScreen";
import { ApiError } from "./api";
import { CHOICES } from "./appTestSupport";
import type { AuthUser, StudentDetail, StudentGradingHistory, StudentRankHistory } from "./api";

let currentUser: AuthUser;
const mockGetStudent = vi.fn();
const mockGetStudentRankHistory = vi.fn();
const mockGetStudentGradingHistory = vi.fn();
const mockDeleteStudent = vi.fn();

vi.mock("./auth", () => ({
  useAuth: () => ({ user: currentUser, status: "authenticated" }),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getChoices: async () => CHOICES,
    getStudent: (...args: unknown[]) => mockGetStudent(...args),
    getStudentRankHistory: (...args: unknown[]) => mockGetStudentRankHistory(...args),
    getStudentGradingHistory: (...args: unknown[]) => mockGetStudentGradingHistory(...args),
    deleteStudent: (...args: unknown[]) => mockDeleteStudent(...args),
  };
});

const student = {
  id: 42,
  wksa_id: "WKSA0042",
  wksa_id_can_change: false,
  previous_wksa_ids: [],
  extra_information: [],
  first_name: "Alex",
  last_name: "Kim",
  date_of_birth: "2015-03-20",
  current_rank: 2,
  current_rank_name: "Yellow Stripe",
  status: "ACTIVE",
  status_display: "Active",
  can_be_graded: true,
  next_rank: null,
  next_rank_name: null,
  can_be_deleted: false,
  deletion_blocked_by: null,
  age_band_display: "9-12",
  deleted_at: null,
  created_at: "2025-01-01T00:00:00Z",
} satisfies StudentDetail;

const rankHistory: StudentRankHistory = {
  promotions: [],
};

const gradingHistory: StudentGradingHistory = {
  items: [],
};

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/students/42"]}>
        <Routes>
          <Route path="/students/:id" element={<StudentDetailScreen />} />
          <Route path="/students" element={<h1>Students list</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("StudentDetailScreen delete action", () => {
  beforeEach(() => {
    mockGetStudent.mockReset().mockResolvedValue(student);
    mockGetStudentRankHistory.mockReset().mockResolvedValue(rankHistory);
    mockGetStudentGradingHistory.mockReset().mockResolvedValue(gradingHistory);
    mockDeleteStudent.mockReset().mockResolvedValue(undefined);
  });

  it("does not render a delete action for a non-administrator", async () => {
    currentUser = {
      id: "instructor-user",
      email: "instructor@example.com",
      first_name: "Instructor",
      last_name: "User",
      full_name: "Instructor User",
      role_display: "Instructor",
      can_make_final_grading_decision: false,
      can_promote_student: false,
      can_override_locked_session: false,
      can_view_grading_audit_log: false,
      can_manage_users: false,
      can_import_data: false,
      can_reconcile_imported_history: false,
      can_delete_students: false,
      can_read_audit_log: false,
      must_change_password: false,
    };

    renderScreen();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Alex Kim" })).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: "Delete student" })).not.toBeInTheDocument();
  });

  function signInAsAdministrator() {
    currentUser = {
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
      can_read_audit_log: true,
      must_change_password: false,
    };
  }

  it("lets an administrator delete the student after confirming", async () => {
    signInAsAdministrator();
    mockGetStudent.mockResolvedValue({ ...student, can_be_deleted: true });
    const user = userEvent.setup();

    renderScreen();
    await screen.findByRole("heading", { name: "Alex Kim" });

    await user.click(screen.getByRole("button", { name: "Delete student" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Delete student",
    });
    expect(dialog).toHaveTextContent("past gradings, marks and decisions stay as recorded");

    await user.click(within(dialog).getByRole("button", { name: "Delete student" }));

    await waitFor(() => expect(mockDeleteStudent).toHaveBeenCalledWith(42));
    await waitFor(() => expect(screen.getByText("Students list")).toBeInTheDocument());
  });

  it("says why a student cannot be deleted yet and offers no delete", async () => {
    signInAsAdministrator();
    mockGetStudent.mockResolvedValue({
      ...student,
      deletion_blocked_by:
        "This student is in the grading 'Spring grading', which has not reached its final decision for them yet.",
    });

    renderScreen();

    expect(await screen.findByTestId("student-delete-blocked")).toHaveTextContent("'Spring grading'");
    expect(screen.queryByRole("button", { name: "Delete student" })).not.toBeInTheDocument();
  });

  it("shows the server's reason when a delete is refused after the page loaded", async () => {
    signInAsAdministrator();
    mockGetStudent.mockResolvedValue({ ...student, can_be_deleted: true });
    mockDeleteStudent.mockRejectedValue(
      new ApiError(
        "This student is in the grading 'Spring grading', which has not reached its final decision for them yet.",
        400,
      ),
    );
    const user = userEvent.setup();

    renderScreen();
    await user.click(await screen.findByRole("button", { name: "Delete student" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete student" });
    await user.click(within(dialog).getByRole("button", { name: "Delete student" }));

    expect(await within(dialog).findByText(/'Spring grading'/)).toBeInTheDocument();
  });

  it("shows a deleted student's record as kept and closed to changes", async () => {
    signInAsAdministrator();
    mockGetStudent.mockResolvedValue({
      ...student,
      deleted_at: "2026-11-07T10:00:00Z",
    });

    renderScreen();

    expect(await screen.findByText("Deleted on 7 November 2026")).toBeInTheDocument();
    expect(screen.getByText(/still show who\s+they were/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit student" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete student" })).not.toBeInTheDocument();
  });

  it("does not offer a deleted student for registration, whatever their status", async () => {
    signInAsAdministrator();
    // A deleted student keeps the status they had; the server says they
    // cannot be graded, and the page follows it.
    mockGetStudent.mockResolvedValue({
      ...student,
      status: "ACTIVE",
      can_be_graded: false,
      next_rank: null,
      next_rank_name: null,
      deleted_at: "2026-11-07T10:00:00Z",
    });

    renderScreen();

    expect(await screen.findByText("Deleted on 7 November 2026")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Grading readiness" })).not.toBeInTheDocument();
    expect(screen.queryByText("Can be registered")).not.toBeInTheDocument();
  });
});

describe("StudentDetailScreen grading readiness", () => {
  beforeEach(() => {
    mockGetStudentRankHistory.mockReset().mockResolvedValue(rankHistory);
    mockGetStudentGradingHistory.mockReset().mockResolvedValue(gradingHistory);
  });

  it("says a student can be registered when the server says so", async () => {
    mockGetStudent.mockReset().mockResolvedValue({
      ...student,
      status: "INACTIVE",
      status_display: "Inactive",
      can_be_graded: true,
      next_rank: null,
      next_rank_name: null,
    });

    renderScreen();

    expect(await screen.findByText("Can be registered")).toBeVisible();
    expect(screen.getByText(/Inactive blocks nothing/)).toBeVisible();
  });

  it("says a student cannot be registered when the server says not", async () => {
    mockGetStudent.mockReset().mockResolvedValue({
      ...student,
      status: "LEFT",
      status_display: "Left",
      can_be_graded: false,
      next_rank: null,
      next_rank_name: null,
    });

    renderScreen();

    expect(await screen.findByText("Cannot be registered")).toBeVisible();
    expect(screen.queryByText("Can be registered")).not.toBeInTheDocument();
  });
});

describe("StudentDetailScreen extra information", () => {
  beforeEach(() => {
    mockGetStudentRankHistory.mockReset().mockResolvedValue(rankHistory);
    mockGetStudentGradingHistory.mockReset().mockResolvedValue(gradingHistory);
  });

  it("shows what an import kept that KukGrade has no field for", async () => {
    mockGetStudent.mockReset().mockResolvedValue({
      ...student,
      extra_information: [
        { label: "Notes", value: "Left-handed" },
        { label: "Parent phone", value: "07700 900001" },
      ],
    });

    renderScreen();

    const card = (await screen.findByRole("heading", { name: "Extra information" })).closest(".card") as HTMLElement;
    expect(within(card).getByText("Parent phone")).toBeVisible();
    expect(within(card).getByText("07700 900001")).toBeVisible();
    expect(within(card).getByText("Left-handed")).toBeVisible();
  });

  it("shows no such section when there is none", async () => {
    mockGetStudent.mockReset().mockResolvedValue(student);

    renderScreen();

    await screen.findByRole("heading", { name: "Alex Kim" });
    expect(screen.queryByRole("heading", { name: "Extra information" })).not.toBeInTheDocument();
  });
});

describe("StudentDetailScreen grading history", () => {
  it("shows what a conditional pass still requires and links to the assessment", async () => {
    mockGetStudent.mockReset().mockResolvedValue(student);
    mockGetStudentRankHistory.mockReset().mockResolvedValue(rankHistory);
    mockGetStudentGradingHistory.mockReset().mockResolvedValue({
      items: [
        {
          source: "KUKGRADE",
          record_id: 7,
          date: "2027-03-20",
          cycle_year: 2027,
          cycle_month: 3,
          date_precision: "DAY",
          testing_for_rank_name: "Yellow stripe",
          source_testing_for_rank_text: "",
          outcome: "CONDITIONAL",
          attendance_status: "ATTENDED",
          comments: "Good spirit.",
          note: "",
          conditional_requirements: "Repeat the kicking set within three months.",
          from_rank_name: "White",
          age_band: "AGE_9_TO_12",
          age_band_display: "9-12",
          session_id: 3,
          candidate_id: 11,
        },
      ],
    } satisfies StudentGradingHistory);

    renderScreen();

    expect(await screen.findByText(/Repeat the kicking set within three months/)).toBeVisible();
    expect(screen.getByText(/From White · 9-12/)).toBeVisible();
    expect(screen.getByRole("link", { name: /view assessment/ })).toHaveAttribute(
      "href",
      "/gradings/3/assessments/11/review",
    );
  });
});
