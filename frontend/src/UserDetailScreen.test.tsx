import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserDetailScreen } from "./UserDetailScreen";
import type { AuthUser, ManagedUser } from "./api";

let currentUser: AuthUser;
const mockGetManagedUser = vi.fn();
const mockGetAuditEvents = vi.fn();
const mockUpdateManagedUser = vi.fn();
const mockUpdateManagedUserAuthority = vi.fn();
const mockResetManagedUserPassword = vi.fn();

vi.mock("./auth", () => ({
  useAuth: () => ({ user: currentUser, status: "authenticated" }),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getManagedUser: (...args: unknown[]) => mockGetManagedUser(...args),
    getAuditEvents: (...args: unknown[]) => mockGetAuditEvents(...args),
    updateManagedUser: (...args: unknown[]) => mockUpdateManagedUser(...args),
    updateManagedUserAuthority: (...args: unknown[]) => mockUpdateManagedUserAuthority(...args),
    resetManagedUserPassword: (...args: unknown[]) => mockResetManagedUserPassword(...args),
  };
});

const managedUser: ManagedUser = {
  id: "target-user",
  email: "riley.khan@example.com",
  first_name: "Riley",
  last_name: "Khan",
  full_name: "Riley Khan",
  role: "instructor",
  role_display: "Instructor",
  is_active: true,
  can_make_final_grading_decision: false,
  can_promote_student: false,
  can_override_locked_session: true,
  can_view_grading_audit_log: false,
  must_change_password: false,
  is_staff: false,
  is_superuser: false,
  date_joined: "2025-02-14T09:00:00Z",
  last_login: "2026-09-14T18:43:00Z",
};

function renderScreen(id = "target-user") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/users/${id}`]}>
        <Routes>
          <Route path="/users/:id" element={<UserDetailScreen />} />
          <Route path="/users" element={<h1>Users list</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("UserDetailScreen", () => {
  beforeEach(() => {
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
    mockGetManagedUser.mockReset().mockResolvedValue(managedUser);
    mockGetAuditEvents.mockReset().mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [{
        id: 9,
        occurred_at: "2026-09-14T18:43:00Z",
        action: "USER_AUTHORITY_CHANGED",
        action_display: "User authority changed",
        entity_type: "User",
        entity_id: "target-user",
        actor: "admin-user",
        actor_email: "admin@example.com",
        actor_name: "Admin User",
        summary: "User authority changed.",
        metadata: {},
      }],
    });
    mockUpdateManagedUser.mockReset().mockResolvedValue(managedUser);
    mockUpdateManagedUserAuthority.mockReset().mockResolvedValue(managedUser);
    mockResetManagedUserPassword.mockReset().mockResolvedValue(undefined);
  });

  it("shows account information and recent administrative activity", async () => {
    renderScreen();
    expect(await screen.findByRole("heading", { name: "Riley Khan" })).toBeInTheDocument();
    expect(screen.getByText("14 February 2025")).toBeInTheDocument();
    expect(screen.getByText("User authority changed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View audit history/ })).toHaveAttribute(
      "href",
      "/audit?search=target-user",
    );
  });

  it("saves account details", async () => {
    const user = userEvent.setup();
    mockUpdateManagedUser.mockImplementation(async (_id, data) => ({
      ...managedUser,
      ...data,
      full_name: `${data.first_name} ${data.last_name}`,
    }));
    renderScreen();
    await screen.findByRole("heading", { name: "Riley Khan" });

    await user.clear(screen.getByLabelText("First name"));
    await user.type(screen.getByLabelText("First name"), "Rina");
    await user.selectOptions(screen.getByLabelText("Account status"), "inactive");
    await user.click(screen.getByRole("button", { name: "Save account details" }));

    await waitFor(() => {
      expect(mockUpdateManagedUser).toHaveBeenCalledWith("target-user", expect.objectContaining({
        first_name: "Rina",
        is_active: false,
      }));
    });
    expect(await screen.findByText("Account details saved.")).toBeInTheDocument();
  });

  it("saves independent Master authority", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole("heading", { name: "Riley Khan" });

    await user.click(screen.getByRole("checkbox", { name: /Promote students/ }));
    await user.click(screen.getByRole("button", { name: "Save authority" }));

    await waitFor(() => {
      expect(mockUpdateManagedUserAuthority).toHaveBeenCalledWith("target-user", {
        can_make_final_grading_decision: false,
        can_promote_student: true,
        can_override_locked_session: true,
        can_view_grading_audit_log: false,
      });
    });
    expect(await screen.findByText("Master authority saved.")).toBeInTheDocument();
  });

  it("confirms and resets a password", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole("heading", { name: "Riley Khan" });

    await user.click(screen.getByRole("button", { name: "Set new password" }));
    const dialog = screen.getByRole("dialog", { name: "Set a temporary password" });
    await user.type(within(dialog).getByLabelText("Temporary password"), "Replacement-Password-2026!");
    await user.type(within(dialog).getByLabelText("Confirm password"), "Replacement-Password-2026!");
    await user.click(within(dialog).getByRole("button", { name: "Set password" }));

    await waitFor(() => {
      expect(mockResetManagedUserPassword).toHaveBeenCalledWith(
        "target-user",
        "Replacement-Password-2026!",
      );
    });
    expect(await screen.findByText(/Temporary password set/)).toBeInTheDocument();
  });

  it("prevents self-service role, status, and authority changes", async () => {
    currentUser = { ...currentUser, id: "target-user" };
    renderScreen();
    await screen.findByRole("heading", { name: "Riley Khan" });

    expect(screen.getByLabelText("Role")).toBeDisabled();
    expect(screen.getByLabelText("Account status")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Make final grading decisions/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save authority" })).toBeDisabled();
    expect(screen.getByText("You cannot change your own authority.")).toBeInTheDocument();
  });
});
