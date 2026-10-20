import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UsersScreen } from "./UsersScreen";
import { ApiError, type ManagedUser } from "./api";

const mockGetManagedUsers = vi.fn();
const mockCreateManagedUser = vi.fn();

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getManagedUsers: (...args: unknown[]) => mockGetManagedUsers(...args),
    createManagedUser: (...args: unknown[]) => mockCreateManagedUser(...args),
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

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/users"]}>
        <Routes>
          <Route path="/users" element={<UsersScreen />} />
          <Route path="/users/:id" element={<h1>User detail reached</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("UsersScreen", () => {
  beforeEach(() => {
    mockGetManagedUsers.mockReset();
    mockCreateManagedUser.mockReset();
    mockGetManagedUsers.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [managedUser],
    });
  });

  it("shows staff identity, role, authority, status, and activity", async () => {
    renderScreen();

    expect(await screen.findByText("Riley Khan")).toBeInTheDocument();
    expect(screen.getByText("riley.khan@example.com")).toBeInTheDocument();
    expect(screen.getByText("Locked-session override")).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Riley Khan/ });
    expect(within(row).getByText("Active")).toBeInTheDocument();
    // `last_login` is a real timestamp, so it correctly renders in the
    // reader's own timezone - 18:43Z on the 14th is the 15th in Auckland. The
    // expected date is derived rather than hard-coded so this asserts the
    // formatting, not the timezone the suite happens to run in.
    const lastLoginDay = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(managedUser.last_login!));
    expect(screen.getByText(new RegExp(lastLoginDay.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();

    for (const header of screen.getAllByRole("columnheader")) {
      expect(header).toHaveAttribute("scope", "col");
    }
  });

  it("applies server-side search, role, status, and pagination", async () => {
    const user = userEvent.setup();
    mockGetManagedUsers.mockResolvedValue({
      count: 15,
      next: "/api/users/?page=2",
      previous: null,
      results: [managedUser],
    });
    renderScreen();
    await screen.findByText("Riley Khan");

    await user.type(screen.getByRole("searchbox", { name: "Search users" }), "Riley");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.selectOptions(screen.getByLabelText("Role"), "instructor");
    await user.selectOptions(screen.getByLabelText("Status"), "inactive");

    await waitFor(() => {
      expect(mockGetManagedUsers).toHaveBeenLastCalledWith({
        page: 1,
        page_size: 10,
        search: "Riley",
        role: "instructor",
        is_active: false,
      });
    });

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(mockGetManagedUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      );
    });
  });

  it("creates a user, shows their temporary password once, then opens their detail", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mockCreateManagedUser.mockResolvedValue({
      ...managedUser,
      id: "created-user",
      full_name: "Casey Created",
      must_change_password: true,
      temporary_password_expires_at: "2026-10-20T14:00:00Z",
      temporary_password: "Kq7#mPx4!vRt9@Wa",
    });
    renderScreen();
    await screen.findByText("Riley Khan");

    await user.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add staff user" });
    // The server generates the password: there is nothing to type.
    expect(within(dialog).queryByLabelText(/password/i)).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Email address"), "created@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    expect(mockCreateManagedUser.mock.calls[0][0]).toEqual({
      email: "created@example.com",
      first_name: "",
      last_name: "",
      role: "instructor",
      is_active: true,
    });
    const shown = await screen.findByRole("dialog", { name: "Staff user added" });
    expect(within(shown).getByText("Kq7#mPx4!vRt9@Wa")).toBeInTheDocument();
    expect(within(shown).getByText(/It will not be shown again/)).toBeInTheDocument();
    expect(within(shown).getByRole("button", { name: "Copy password" })).toHaveFocus();

    await user.click(within(shown).getByRole("button", { name: "Copy password" }));
    expect(writeText).toHaveBeenCalledWith("Kq7#mPx4!vRt9@Wa");
    expect(await within(shown).findByText("Copied.")).toBeInTheDocument();

    await user.click(within(shown).getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("heading", { name: "User detail reached" })).toBeInTheDocument();
    expect(screen.queryByText("Kq7#mPx4!vRt9@Wa")).not.toBeInTheDocument();
  });

  it("does not lose the temporary password to a stray click outside the dialog", async () => {
    const user = userEvent.setup();
    mockCreateManagedUser.mockResolvedValue({
      ...managedUser,
      temporary_password_expires_at: "2026-10-20T14:00:00Z",
      temporary_password: "Kq7#mPx4!vRt9@Wa",
    });
    renderScreen();
    await screen.findByText("Riley Khan");
    await user.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add staff user" });
    await user.type(within(dialog).getByLabelText("Email address"), "created@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));
    const shown = await screen.findByRole("dialog", { name: "Staff user added" });

    await user.pointer({ keys: "[MouseLeft]", target: shown.parentElement! });

    expect(screen.getByText("Kq7#mPx4!vRt9@Wa")).toBeInTheDocument();
  });

  it("announces a server-side email validation error and associates it with the email field", async () => {
    const user = userEvent.setup();
    mockCreateManagedUser.mockRejectedValue(
      new ApiError("Validation failed.", 400, "validation_error", {
        email: ["A user with that email already exists."],
      }),
    );
    renderScreen();
    await screen.findByText("Riley Khan");

    await user.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add staff user" });
    const emailInput = within(dialog).getByLabelText("Email address");
    await user.type(emailInput, "riley.khan@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    const fieldError = await screen.findByText("A user with that email already exists.");
    expect(fieldError.closest("[role='alert']")).not.toBeNull();
    expect(emailInput).toHaveAttribute("aria-invalid", "true");
    expect(emailInput).toHaveAttribute("aria-describedby", "cud-email-error");
  });

  it("cannot be closed while the create request is in flight", async () => {
    const user = userEvent.setup();
    mockCreateManagedUser.mockReturnValue(new Promise(() => {}));
    renderScreen();
    await screen.findByText("Riley Khan");
    await user.click(screen.getByRole("button", { name: "Add user" }));

    const dialog = screen.getByRole("dialog", { name: "Add staff user" });
    await user.type(within(dialog).getByLabelText("Email address"), "pending@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    await waitFor(() => expect(mockCreateManagedUser).toHaveBeenCalled());
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Add staff user" })).toBeInTheDocument();
  });

  it("opens the selected user for management", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("Riley Khan");
    await user.click(screen.getByRole("button", { name: "Manage user" }));
    expect(await screen.findByRole("heading", { name: "User detail reached" })).toBeInTheDocument();
  });
});
