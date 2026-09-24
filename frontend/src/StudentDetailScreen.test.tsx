import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StudentDetailScreen } from "./StudentDetailScreen";
import type {
  AuthUser,
  StudentDetail,
  StudentGradingHistory,
  StudentRankHistory,
} from "./api";

let currentUser: AuthUser;
const mockGetStudent = vi.fn();
const mockGetStudentRankHistory = vi.fn();
const mockGetStudentGradingHistory = vi.fn();
const mockGetRanks = vi.fn();
const mockDeleteStudent = vi.fn();

vi.mock("./auth", () => ({
  useAuth: () => ({ user: currentUser, status: "authenticated" }),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getStudent: (...args: unknown[]) => mockGetStudent(...args),
    getStudentRankHistory: (...args: unknown[]) =>
      mockGetStudentRankHistory(...args),
    getStudentGradingHistory: (...args: unknown[]) =>
      mockGetStudentGradingHistory(...args),
    getRanks: (...args: unknown[]) => mockGetRanks(...args),
    deleteStudent: (...args: unknown[]) => mockDeleteStudent(...args),
  };
});

const student = {
  id: 42,
  wksa_id: "WKSA0042",
  first_name: "Alex",
  last_name: "Kim",
  date_of_birth: "2015-03-20",
  current_rank: 2,
  current_rank_name: "Yellow Stripe",
  current_rank_code: "YELLOW_STRIPE",
  status: "ACTIVE",
  status_display: "Active",
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
} as unknown as StudentDetail;

const rankHistory: StudentRankHistory = {
  student: 42,
  student_display_name: "Alex Kim",
  student_wksa_id: "WKSA0042",
  current_rank: 2,
  current_rank_code: "YELLOW_STRIPE",
  current_rank_name: "Yellow Stripe",
  promotions: [],
};

const gradingHistory: StudentGradingHistory = {
  student: 42,
  student_display_name: "Alex Kim",
  student_wksa_id: "WKSA0042",
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
    mockGetRanks
      .mockReset()
      .mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
    mockDeleteStudent.mockReset().mockResolvedValue(undefined);
  });

  it("does not render a delete action for a non-administrator", async () => {
    currentUser = {
      id: "instructor-user",
      email: "instructor@example.com",
      first_name: "Instructor",
      last_name: "User",
      full_name: "Instructor User",
      role: "instructor",
      role_display: "Instructor",
      can_make_final_grading_decision: false,
      can_promote_student: false,
      can_override_locked_session: false,
      can_view_grading_audit_log: false,
      must_change_password: false,
      is_staff: false,
      is_superuser: false,
    };

    renderScreen();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Alex Kim" }),
      ).toBeInTheDocument(),
    );

    expect(
      screen.queryByRole("button", { name: "Delete student" }),
    ).not.toBeInTheDocument();
  });

  it("lets an administrator delete the student after confirming", async () => {
    currentUser = {
      id: "admin-user",
      email: "admin@example.com",
      first_name: "Admin",
      last_name: "User",
      full_name: "Admin User",
      role: "administrator",
      role_display: "Administrator",
      can_make_final_grading_decision: false,
      can_promote_student: true,
      can_override_locked_session: true,
      can_view_grading_audit_log: false,
      must_change_password: false,
      is_staff: false,
      is_superuser: false,
    };
    const user = userEvent.setup();

    renderScreen();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Alex Kim" }),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Delete student" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Delete student",
    });

    await user.click(
      within(dialog).getByRole("button", { name: "Delete student" }),
    );

    await waitFor(() => expect(mockDeleteStudent).toHaveBeenCalledWith(42));
    await waitFor(() =>
      expect(screen.getByText("Students list")).toBeInTheDocument(),
    );
  });
});
