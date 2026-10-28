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
  temporary_password_expires_at: null,
  manageable: true,
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
        entity_type_display: "User",
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
    // The change is audited, so the page's activity list is read again.
    await waitFor(() => expect(mockGetAuditEvents.mock.calls.length).toBeGreaterThan(1));
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
    await waitFor(() => expect(mockGetAuditEvents.mock.calls.length).toBeGreaterThan(1));
  });

  it("resets a password and shows the new temporary one once", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole("heading", { name: "Riley Khan" });
    expect(screen.getByText("Normal access")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset password" }));
    const dialog = screen.getByRole("dialog", { name: "Reset password" });
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    const reset = {
      ...managedUser,
      must_change_password: true,
      temporary_password_expires_at: "2099-10-20T14:00:00Z",
    };
    mockResetManagedUserPassword.mockResolvedValue({
      ...reset,
      temporary_password: "Kq7#mPx4!vRt9@Wa",
    });
    // The page refetches rather than keeping the pre-reset record.
    mockGetManagedUser.mockResolvedValue(reset);
    await user.click(within(dialog).getByRole("button", { name: "Reset password" }));

    expect(mockResetManagedUserPassword).toHaveBeenCalledWith("target-user");
    const shown = await screen.findByRole("dialog", { name: "Password reset" });
    expect(within(shown).getByText("Kq7#mPx4!vRt9@Wa")).toBeInTheDocument();
    expect(await screen.findByText("Password change required")).toBeInTheDocument();
    expect(screen.getByText(/^Works until/)).toBeInTheDocument();

    await user.click(within(shown).getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Kq7#mPx4!vRt9@Wa")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset password" })).toHaveFocus();
  });

  it("says when a temporary password has expired", async () => {
    mockGetManagedUser.mockResolvedValue({
      ...managedUser,
      must_change_password: true,
      temporary_password_expires_at: "2020-01-01T09:00:00Z",
    });
    renderScreen();

    expect(
      await screen.findByText(/^Expired .*Reset the password to give them a new one\.$/),
    ).toBeInTheDocument();
  });

  it("cannot close the password dialog while the reset is in flight", async () => {
    const user = userEvent.setup();
    mockResetManagedUserPassword.mockReturnValue(new Promise(() => {}));
    renderScreen();
    await screen.findByRole("heading", { name: "Riley Khan" });

    await user.click(screen.getByRole("button", { name: "Reset password" }));
    const dialog = screen.getByRole("dialog", { name: "Reset password" });
    await user.click(within(dialog).getByRole("button", { name: "Reset password" }));

    await waitFor(() => expect(mockResetManagedUserPassword).toHaveBeenCalled());
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Reset password" })).toBeInTheDocument();
  });

  it("offers no change to an account only a superuser may change", async () => {
    mockGetManagedUser.mockResolvedValue({ ...managedUser, manageable: false });
    renderScreen();
    await screen.findByRole("heading", { name: "Riley Khan" });

    expect(screen.getByText("Only a superuser can change this account.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Reset password" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete account" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save account details" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save authority" })).toBeDisabled();
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
    // Your own password is changed in Settings, behind the current
    // one; a reset - which asks for none - is not offered (audit F-04).
    expect(screen.queryByRole("button", { name: "Reset password" })).not.toBeInTheDocument();
    expect(
      screen.getByText("Change your own password in Settings."),
    ).toBeInTheDocument();
  });
});
