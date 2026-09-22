import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GradingSessionDetailScreen } from "./GradingSessionDetailScreen";
import type { AuthUser, GradingSession } from "./api";

let currentUser: AuthUser;
const mockGetGradingSession = vi.fn();
const mockGetAllGradingCandidates = vi.fn();
const mockGetAllCandidateAssessments = vi.fn();
const mockGetAllCandidateOutcomes = vi.fn();
const mockGetAllStudents = vi.fn();
const mockDeleteGradingSession = vi.fn();

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
    getAllStudents: (...args: unknown[]) => mockGetAllStudents(...args),
    deleteGradingSession: (...args: unknown[]) =>
      mockDeleteGradingSession(...args),
  };
});

const adminUser: AuthUser = {
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

const instructorUser: AuthUser = {
  ...adminUser,
  id: "instructor-user",
  email: "instructor@example.com",
  role: "instructor",
  role_display: "Instructor",
  can_promote_student: false,
  can_override_locked_session: false,
};

function lockedSession(): GradingSession {
  return {
    id: 7,
    title: "March 2027 Colchester Grading",
    grading_date: "2027-03-20",
    status: "LOCKED",
    status_display: "Locked",
    location: "Colchester",
    notes: "",
    created_at: "2027-03-01T00:00:00Z",
    updated_at: "2027-03-01T00:00:00Z",
    created_by: 1,
    created_by_name: "Admin User",
    cancellation_reason: "",
  } as unknown as GradingSession;
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
    mockGetAllStudents.mockReset().mockResolvedValue(emptyPage());
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
