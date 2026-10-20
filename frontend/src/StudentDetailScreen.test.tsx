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
  age_band_display: "9-12",
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
      role_display: "Instructor",
      can_make_final_grading_decision: false,
      can_promote_student: false,
      can_override_locked_session: false,
      can_view_grading_audit_log: false,
      can_manage_users: false,
      can_import_data: false,
      can_reconcile_imported_history: false,
      can_delete_students: false,
      can_delete_assessments: false,
      can_delete_any_session: false,
      can_read_audit_log: false,
      must_change_password: false,
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

describe("StudentDetailScreen extra information", () => {
  beforeEach(() => {
    mockGetStudentRankHistory.mockReset().mockResolvedValue(rankHistory);
    mockGetStudentGradingHistory.mockReset().mockResolvedValue(gradingHistory);
    mockGetRanks
      .mockReset()
      .mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
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

    const card = (await screen.findByRole("heading", { name: "Extra information" })).closest(
      ".detail-section-card",
    ) as HTMLElement;
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
