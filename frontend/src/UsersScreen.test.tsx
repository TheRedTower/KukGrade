import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UsersScreen } from "./UsersScreen";
import { ApiError, NETWORK_ERROR, type ManagedUser } from "./api";
import { CHOICES } from "./appTestSupport";

const mockGetManagedUsers = vi.fn();
const mockCreateManagedUser = vi.fn();

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getChoices: async () => CHOICES,
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
  rank: 13,
  rank_name: "KSN",
  is_active: true,
  can_make_final_grading_decision: false,
  can_promote_student: false,
  can_override_locked_session: true,
  can_view_grading_audit_log: false,
  must_change_password: false,
  temporary_password_expires_at: null,
  manageable: true,
  missing_details: [],
  date_joined: "2025-02-14T09:00:00Z",
  last_login: "2026-09-14T18:43:00Z",
};

async function giveName(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.type(within(dialog).getByLabelText("First name"), "Casey");
  await user.type(within(dialog).getByLabelText("Last name"), "Created");
}

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

    expect(await screen.findByText("KSN Riley Khan")).toBeInTheDocument();
    expect(screen.getByText("riley.khan@example.com")).toBeInTheDocument();
    expect(await screen.findByText("Override locked sessions")).toBeInTheDocument();
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

  it("flags an account that still lacks a name or a rank, in the server's words", async () => {
    mockGetManagedUsers.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          ...managedUser,
          first_name: "",
          last_name: "",
          full_name: "Unnamed account",
          rank: null,
          rank_name: "",
          missing_details: [
            { value: "name", label: "Needs a name" },
            { value: "rank", label: "Needs a rank" },
          ],
        },
      ],
    });
    renderScreen();

    const row = await screen.findByRole("row", { name: /Unnamed account/ });
    expect(within(row).getByText("Needs a name")).toBeInTheDocument();
    expect(within(row).getByText("Needs a rank")).toBeInTheDocument();
    // No address stands in for the missing name.
    expect(within(row).getByText("Unnamed account").tagName).toBe("STRONG");
  });

  it("flags nothing on an account that has all it needs", async () => {
    renderScreen();
    const row = await screen.findByRole("row", { name: /Riley Khan/ });
    expect(within(row).queryByText(/^Needs a/)).not.toBeInTheDocument();
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
    await screen.findByText("KSN Riley Khan");

    await user.type(screen.getByRole("searchbox", { name: "Search users" }), "Riley");
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

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(mockGetManagedUsers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
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
    await screen.findByText("KSN Riley Khan");

    await user.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add staff user" });
    // The server generates the password: there is nothing to type.
    expect(within(dialog).queryByLabelText(/password/i)).not.toBeInTheDocument();
    await giveName(user, dialog);
    await user.type(within(dialog).getByLabelText("Email address"), "created@example.com");
    await user.selectOptions(within(dialog).getByLabelText("Rank"), "KSN");
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    expect(mockCreateManagedUser.mock.calls[0][0]).toEqual({
      email: "created@example.com",
      first_name: "Casey",
      last_name: "Created",
      role: "instructor",
      rank: 13,
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

  it("asks an instructor's rank, and none for an administrator account", async () => {
    const user = userEvent.setup();
    mockCreateManagedUser.mockResolvedValue({ ...managedUser, temporary_password: "Kq7#mPx4!vRt9@Wa" });
    renderScreen();
    await screen.findByText("KSN Riley Khan");
    await user.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add staff user" });

    // The instructor ranks the server serves, and nothing chosen for them.
    const rank = within(dialog).getByLabelText("Rank");
    expect(rank).toBeRequired();
    expect(
      within(rank)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Choose their rank", "JKN", "KSN", "PSBN", "SBN", "PKJN"]);

    await user.selectOptions(within(dialog).getByLabelText("Role"), "administrator");
    expect(within(dialog).queryByLabelText("Rank")).not.toBeInTheDocument();
    await giveName(user, dialog);
    await user.type(within(dialog).getByLabelText("Email address"), "admin2@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    expect(mockCreateManagedUser.mock.calls[0][0]).toEqual({
      email: "admin2@example.com",
      first_name: "Casey",
      last_name: "Created",
      role: "administrator",
      is_active: true,
    });
  });

  it("does not lose the temporary password to a stray click outside the dialog", async () => {
    const user = userEvent.setup();
    mockCreateManagedUser.mockResolvedValue({
      ...managedUser,
      temporary_password_expires_at: "2026-10-20T14:00:00Z",
      temporary_password: "Kq7#mPx4!vRt9@Wa",
    });
    renderScreen();
    await screen.findByText("KSN Riley Khan");
    await user.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add staff user" });
    await giveName(user, dialog);
    await user.type(within(dialog).getByLabelText("Email address"), "created@example.com");
    await user.selectOptions(within(dialog).getByLabelText("Rank"), "KSN");
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
    await screen.findByText("KSN Riley Khan");

    await user.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add staff user" });
    await giveName(user, dialog);
    const emailInput = within(dialog).getByLabelText("Email address");
    await user.type(emailInput, "riley.khan@example.com");
    await user.selectOptions(within(dialog).getByLabelText("Rank"), "KSN");
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    const fieldError = await screen.findByText("A user with that email already exists.");
    expect(fieldError.closest("[role='alert']")).not.toBeNull();
    expect(fieldError).toHaveClass("error-text--field");
    expect(emailInput).toHaveAttribute("aria-invalid", "true");
    expect(emailInput).toHaveAccessibleDescription("A user with that email already exists.");
    // Said once, beside the box, not repeated above the buttons.
    expect(screen.queryByText("Validation failed.")).not.toBeInTheDocument();
  });

  it("says a missing name beside its box, and asks for both names before sending", async () => {
    const user = userEvent.setup();
    mockCreateManagedUser.mockRejectedValue(
      new ApiError("Validation failed.", 400, "validation_error", {
        last_name: ["Enter a last name."],
      }),
    );
    renderScreen();
    await screen.findByText("KSN Riley Khan");

    await user.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add staff user" });
    expect(within(dialog).getByLabelText("First name")).toBeRequired();
    expect(within(dialog).getByLabelText("Last name")).toBeRequired();
    await giveName(user, dialog);
    await user.type(within(dialog).getByLabelText("Email address"), "riley.khan@example.com");
    await user.selectOptions(within(dialog).getByLabelText("Rank"), "KSN");
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    expect(await within(dialog).findByText("Enter a last name.")).toHaveClass("error-text--field");
    expect(within(dialog).getByLabelText("Last name")).toHaveAccessibleDescription("Enter a last name.");
  });

  it("says a refusal about a field it has no message box for, rather than dropping it", async () => {
    const user = userEvent.setup();
    mockCreateManagedUser.mockRejectedValue(
      new ApiError("Validation failed.", 400, "validation_error", {
        is_active: ["A new account starts active."],
      }),
    );
    renderScreen();
    await screen.findByText("KSN Riley Khan");

    await user.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add staff user" });
    await giveName(user, dialog);
    await user.type(within(dialog).getByLabelText("Email address"), "riley.khan@example.com");
    await user.selectOptions(within(dialog).getByLabelText("Rank"), "KSN");
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    expect(await within(dialog).findByText("A new account starts active.")).toBeVisible();
  });

  it("says so when the connection fails, rather than doing nothing", async () => {
    const user = userEvent.setup();
    mockCreateManagedUser.mockRejectedValue(new TypeError("Failed to fetch"));
    renderScreen();
    await screen.findByText("KSN Riley Khan");

    await user.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add staff user" });
    await giveName(user, dialog);
    await user.type(within(dialog).getByLabelText("Email address"), "riley.khan@example.com");
    await user.selectOptions(within(dialog).getByLabelText("Rank"), "KSN");
    await user.click(within(dialog).getByRole("button", { name: "Add user" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(NETWORK_ERROR);
  });

  it("cannot be closed while the create request is in flight", async () => {
    const user = userEvent.setup();
    mockCreateManagedUser.mockReturnValue(new Promise(() => {}));
    renderScreen();
    await screen.findByText("KSN Riley Khan");
    await user.click(screen.getByRole("button", { name: "Add user" }));

    const dialog = screen.getByRole("dialog", { name: "Add staff user" });
    await giveName(user, dialog);
    await user.type(within(dialog).getByLabelText("Email address"), "pending@example.com");
    await user.selectOptions(within(dialog).getByLabelText("Rank"), "KSN");
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
    await screen.findByText("KSN Riley Khan");
    await user.click(screen.getByRole("button", { name: "Manage user" }));
    expect(await screen.findByRole("heading", { name: "User detail reached" })).toBeInTheDocument();
  });
});
