import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type {
  AuthUser,
} from "./api";
import {
  authUser,
  ADMINISTRATOR_CAPABILITIES,
  fetchSignedInAs,
  jsonResponse,
  signedInResponse,
} from "./appTestSupport";

describe("Navigation rail and role-gated routes", () => {
  const masterInstructorUser = {
    ...authUser,
    can_make_final_grading_decision: true,
    can_read_audit_log: true,
  } satisfies AuthUser;

  const adminUser = {
    ...authUser,
    id: "9e1c44b3-d8f6-4c1a-a4d1-4cb8e788df22",
    email: "admin@example.com",
    first_name: "Alex",
    last_name: "Admin",
    full_name: "Alex Admin",
    ...ADMINISTRATOR_CAPABILITIES,
    role_display: "Administrator",
    can_promote_student: true,
    can_override_locked_session: true,
    can_view_grading_audit_log: false,
  } satisfies AuthUser;

  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("renders base navigation links for a standard instructor and hides privileged links", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));

    render(<App />);

    await screen.findByText("Casey Instructor");
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    expect(
      within(screen.getByRole("complementary", { name: "Navigation rail" })).getByRole("img", {
        name: "KukGrade",
      }),
    ).toBeVisible();

    expect(screen.getByRole("link", { name: "Overview" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Students" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Gradings" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Syllabus" })).toBeVisible();

    expect(screen.queryByRole("link", { name: "Audit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Overview" })).toBeVisible();
  });

  it("navigates between sections when navigation links are clicked", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Overview" });

    await user.click(screen.getByRole("link", { name: "Students" }));
    expect(await screen.findByRole("heading", { name: "Students" })).toBeVisible();
    expect(window.location.pathname).toBe("/students");

    await user.click(screen.getByRole("link", { name: "Gradings" }));
    expect(await screen.findByRole("heading", { name: "Gradings" })).toBeVisible();
    expect(window.location.pathname).toBe("/gradings");

    await user.click(screen.getByRole("link", { name: "Syllabus" }));
    expect(await screen.findByRole("heading", { name: "Syllabus" })).toBeVisible();
    expect(window.location.pathname).toBe("/syllabus");

    await user.click(screen.getByRole("link", { name: "Overview" }));
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeVisible();
    expect(window.location.pathname).toBe("/");
  });

  it("redirects an unauthorised instructor attempting direct URL access to /audit", async () => {
    window.history.replaceState({}, "", "/audit");
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));

    render(<App />);

    await screen.findByText("Casey Instructor");
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeVisible();
  });

  it("redirects an unauthorised instructor attempting direct URL access to /users", async () => {
    window.history.replaceState({}, "", "/users");
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));

    render(<App />);

    await screen.findByText("Casey Instructor");
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeVisible();
  });

  it("redirects an Authorised Master attempting direct URL access to /users", async () => {
    window.history.replaceState({}, "", "/users");
    vi.stubGlobal(
      "fetch",
      fetchSignedInAs(masterInstructorUser),
    );

    render(<App />);

    await screen.findByText("Casey Instructor");
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeVisible();
  });

  it("grants Audit access and displays the Audit link for an Authorised Master", async () => {
    vi.stubGlobal(
      "fetch",
      fetchSignedInAs(masterInstructorUser),
    );
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Casey Instructor");
    expect(screen.getByRole("link", { name: "Audit" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Audit" }));
    expect(await screen.findByRole("heading", { name: "Audit" })).toBeVisible();
    expect(window.location.pathname).toBe("/audit");
  });

  it("grants full navigation and route access for an Administrator", async () => {
    vi.stubGlobal(
      "fetch",
      fetchSignedInAs(adminUser),
    );
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Alex Admin");
    expect(screen.getByRole("link", { name: "Audit" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Users" })).toBeVisible();

    await user.click(screen.getByRole("link", { name: "Users" }));
    expect(await screen.findByRole("heading", { name: "Users" })).toBeVisible();
    expect(window.location.pathname).toBe("/users");

    await user.click(screen.getByRole("link", { name: "Audit" }));
    expect(await screen.findByRole("heading", { name: "Audit" })).toBeVisible();
    expect(window.location.pathname).toBe("/audit");
  });
});

describe("Instructor profile menu and Master capabilities", () => {
  const masterUser = {
    ...authUser,
    can_make_final_grading_decision: true,
    can_read_audit_log: true,
    can_promote_student: false,
    can_override_locked_session: false,
    can_view_grading_audit_log: false,
  } satisfies AuthUser;

  const adminUser = {
    ...authUser,
    id: "9e1c44b3-d8f6-4c1a-a4d1-4cb8e788df22",
    email: "admin@example.com",
    first_name: "Alex",
    last_name: "Admin",
    full_name: "Alex Admin",
    ...ADMINISTRATOR_CAPABILITIES,
    role_display: "Administrator",
    can_make_final_grading_decision: false,
    can_promote_student: true,
    can_override_locked_session: true,
    can_view_grading_audit_log: false,
  } satisfies AuthUser;

  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("opens the profile menu showing initials, user details, and not-granted capabilities for a standard instructor", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Casey Instructor");
    expect(screen.getByText("CI")).toBeVisible();
    expect(screen.queryByLabelText("User account menu")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Casey Instructor, Instructor" }),
    );

    const menu = screen.getByLabelText("User account menu");
    expect(menu).toBeVisible();
    expect(screen.getByText("casey@example.com")).toBeVisible();
    expect(
      screen.getByText("Capabilities are independent of your role."),
    ).toBeVisible();

    const notGrantedBadges = screen.getAllByText("Not granted");
    expect(notGrantedBadges).toHaveLength(4);
    expect(screen.queryByText("Granted")).not.toBeInTheDocument();
  });

  it("displays granted status for Master capabilities held by an Authorised Master", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(masterUser));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Casey Instructor");
    await user.click(
      screen.getByRole("button", { name: "Casey Instructor, Instructor" }),
    );

    expect(screen.getByText("Granted")).toBeVisible();
    const notGrantedBadges = screen.getAllByText("Not granted");
    expect(notGrantedBadges).toHaveLength(3);
  });

  it("displays granted status for student promotion and session override for an Administrator", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(adminUser));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Alex Admin");
    expect(screen.getByText("AA")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Alex Admin, Administrator" }),
    );

    const grantedBadges = screen.getAllByText("Granted");
    expect(grantedBadges).toHaveLength(2);
    expect(screen.getAllByText("Not granted")).toHaveLength(2);
  });

  it("closes the profile menu when pressing the Escape key", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Casey Instructor");
    await user.click(
      screen.getByRole("button", { name: "Casey Instructor, Instructor" }),
    );
    expect(screen.getByLabelText("User account menu")).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("User account menu")).not.toBeInTheDocument();
  });

  it("closes the profile menu when clicking outside", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Casey Instructor");
    await user.click(
      screen.getByRole("button", { name: "Casey Instructor, Instructor" }),
    );
    expect(screen.getByLabelText("User account menu")).toBeVisible();

    await user.click(screen.getByRole("heading", { name: "Overview" }));
    expect(screen.queryByLabelText("User account menu")).not.toBeInTheDocument();
  });

  it("shows the club name the server is configured with", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) =>
        url.includes("/api/site/")
          ? jsonResponse(200, { club_name: "Kuk Sool Won Testville" })
          : signedInResponse(url, authUser),
      ),
    );

    render(<App />);

    expect(await screen.findByText("Kuk Sool Won Testville")).toBeVisible();
  });

  it("saves the user's own name and shows it straight away", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/") && init?.method === "PATCH") {
        return jsonResponse(200, {
          ...authUser,
          first_name: "Casey",
          last_name: "Park",
          full_name: "Casey Park",
        });
      }
      return signedInResponse(url, authUser);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Casey Instructor");
    await user.click(screen.getByRole("button", { name: "Casey Instructor, Instructor" }));
    await user.click(screen.getByRole("button", { name: "Edit your name" }));
    const lastName = screen.getByLabelText("Last name");
    await user.clear(lastName);
    await user.type(lastName, "  Park ");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByRole("button", { name: "Casey Park, Instructor" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save name" })).not.toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patch?.[0]).toContain("/api/auth/me/");
    expect(JSON.parse(patch?.[1]?.body as string)).toEqual({
      first_name: "Casey",
      last_name: "Park",
    });
  });

  it("changes your own password from the account menu, behind the current one", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/change-password/")) {
        const body = JSON.parse(init?.body as string);
        if (body.current_password !== "Current-Pass-2026!") {
          return jsonResponse(400, {
            error: {
              code: "validation_error",
              message: "Invalid input",
              fields: { current_password: ["Current password is incorrect."] },
            },
          });
        }
        return new Response(null, { status: 204 });
      }
      return signedInResponse(url, authUser);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Casey Instructor");
    await user.click(screen.getByRole("button", { name: "Casey Instructor, Instructor" }));
    await user.click(screen.getByRole("button", { name: "Change password" }));
    const menu = screen.getByLabelText("User account menu");

    // A wrong current password is the server's to refuse; the form stays.
    await user.type(within(menu).getByLabelText(/^Current password/), "Wrong-Pass-2026!");
    await user.type(within(menu).getByLabelText("New password"), "Brand-New-Pass-2026!");
    await user.type(within(menu).getByLabelText("Confirm new password"), "Brand-New-Pass-2026!");
    await user.click(within(menu).getByRole("button", { name: "Change password" }));
    expect(await within(menu).findByText("Current password is incorrect.")).toBeVisible();

    const current = within(menu).getByLabelText(/^Current password/);
    await user.clear(current);
    await user.type(current, "Current-Pass-2026!");
    await user.click(within(menu).getByRole("button", { name: "Change password" }));

    expect(await within(menu).findByRole("status")).toHaveTextContent(
      "Your password has been changed.",
    );
    expect(within(menu).queryByLabelText(/^Current password/)).not.toBeInTheDocument();
    const sent = fetchMock.mock.calls
      .filter(([url]) => String(url).includes("/api/auth/change-password/"))
      .map(([, init]) => JSON.parse(init?.body as string));
    expect(sent.at(-1)).toEqual({
      current_password: "Current-Pass-2026!",
      new_password: "Brand-New-Pass-2026!",
    });
  });

  it("keeps the name form open with the server's message when saving fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return jsonResponse(400, {
            error: {
              code: "validation_error",
              message: "Last name is too long.",
              fields: { last_name: ["Last name is too long."] },
            },
          });
        }
        return signedInResponse(url, authUser);
      }),
    );
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Casey Instructor");
    await user.click(screen.getByRole("button", { name: "Casey Instructor, Instructor" }));
    await user.click(screen.getByRole("button", { name: "Edit your name" }));
    await user.click(screen.getByRole("button", { name: "Save name" }));

    const menu = screen.getByLabelText("User account menu");
    expect(await within(menu).findByRole("alert")).toHaveTextContent("Last name is too long.");
    expect(screen.getByRole("button", { name: "Save name" })).toBeEnabled();
  });
});
