import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

const authUser = {
  id: "7d3c55f4-e9e7-4b2b-b5d0-5fc9e899df17",
  email: "casey@example.com",
  first_name: "Casey",
  last_name: "Instructor",
  full_name: "Casey Instructor",
  role: "instructor",
  role_display: "Instructor",
  can_make_final_grading_decision: false,
  can_promote_student: false,
  can_override_locked_session: false,
  must_change_password: false,
  is_staff: false,
  is_superuser: false,
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function emptyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => undefined,
  } as Response;
}

function authRequiredResponse(): Response {
  return jsonResponse(403, {
    error: {
      code: "authentication_required",
      message: "Authentication credentials were not provided.",
    },
  });
}

// Theme and "have we seen this browser before" both live in localStorage and
// a DOM attribute, not component state, so they survive across tests in this
// file unless cleared - every test starts from the same first-time,
// system-theme baseline.
afterEach(() => {
  window.localStorage.removeItem("kukgrade-has-signed-in");
  window.localStorage.removeItem("kukgrade-theme");
  document.documentElement.removeAttribute("data-theme");
});

describe("App authentication", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.cookie = "csrftoken=test-csrf-token";
    // These tests exercise the ordinary sign-in/out flow, not first-time
    // copy - see "First-time login copy" below for that.
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("loads the authenticated application shell with the signed-in user", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, authUser));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Casey Instructor")).toBeVisible();
    });

    expect(screen.getByText("Instructor")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Casey Instructor, Instructor" }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/auth/me/",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("protects authenticated routes from anonymous users", async () => {
    window.history.replaceState({}, "", "/sessions");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(authRequiredResponse()));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe("/login");
    });
  });

  it("logs in with a CSRF-protected session request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authRequiredResponse())
      .mockResolvedValueOnce(jsonResponse(200, authUser));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Welcome back" });
    await user.type(screen.getByLabelText("Email address"), "casey@example.com");
    await user.type(screen.getByLabelText("Password"), "StrongPass123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByText("Casey Instructor")).toBeVisible();
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:8000/api/auth/login/",
      expect.objectContaining({
        body: JSON.stringify({
          email: "casey@example.com",
          password: "StrongPass123!",
        }),
        credentials: "include",
        method: "POST",
      }),
    );
    const loginHeaders = (fetchMock.mock.calls[1][1] as RequestInit)
      .headers as Headers;
    expect(loginHeaders.get("X-CSRFToken")).toBe("test-csrf-token");
    expect(window.location.pathname).toBe("/");
  });

  it("uses a generic login error for failed credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authRequiredResponse())
      .mockResolvedValueOnce(
        jsonResponse(400, {
          error: {
            code: "validation_error",
            message: "Unable to log in with the provided credentials.",
            fields: {
              non_field_errors: [
                "Unable to log in with the provided credentials.",
              ],
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Welcome back" });
    await user.type(screen.getByLabelText("Email address"), "casey@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Email or password is incorrect.")).toBeVisible();
  });

  it("shows the server's own message when login is throttled, not a credential error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authRequiredResponse())
      .mockResolvedValueOnce(
        jsonResponse(429, {
          error: {
            code: "throttled",
            message: "Request was throttled. Expected available in 42 seconds.",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Welcome back" });
    await user.type(screen.getByLabelText("Email address"), "casey@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(
        "Request was throttled. Expected available in 42 seconds.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Email or password is incorrect.")).not.toBeInTheDocument();
  });

  it("logs out and returns to the login route", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, authUser))
      .mockResolvedValueOnce(emptyResponse(204));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Casey Instructor");
    await user.click(
      screen.getByRole("button", { name: "Casey Instructor, Instructor" }),
    );
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:8000/api/auth/logout/",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
      }),
    );
    await waitFor(() => {
      expect(window.location.pathname).toBe("/login");
    });
  });
});

describe("Connection failures are not sign-outs", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("shows a retryable error for a server fault instead of the login page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(500, {
          error: { code: "error", message: "Internal Server Error" },
        }),
      ),
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Can’t reach KukGrade" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Welcome back" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "KukGrade is not responding",
    );
  });

  it("shows a retryable error when the network is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "KukGrade could not be reached",
    );
    expect(
      screen.queryByRole("heading", { name: "Welcome back" }),
    ).not.toBeInTheDocument();
  });

  it("does not redirect to the login route on a connection failure", async () => {
    window.history.replaceState({}, "", "/sessions");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    render(<App />);

    await screen.findByRole("alert");
    expect(window.location.pathname).toBe("/sessions");
  });

  it("recovers to the application shell when the retry succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse(200, authUser));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(screen.getByText("Casey Instructor")).toBeVisible();
    });
  });

  it("still treats a genuine authentication answer as anonymous", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(authRequiredResponse()));

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
  });

  it("keeps the viewer signed in when sign-out fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, authUser))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Casey Instructor");
    await user.click(
      screen.getByRole("button", { name: "Casey Instructor, Instructor" }),
    );
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    // The session may still be live, so a signed-out UI would be a lie.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not sign out",
    );
    expect(screen.getByText("Casey Instructor")).toBeVisible();
    expect(window.location.pathname).toBe("/");
  });
});

describe("First-time login copy", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.cookie = "csrftoken=test-csrf-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("greets a browser that has never signed in with 'Sign in', not 'Welcome back'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(authRequiredResponse()));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  it("says 'Welcome back' once this browser has signed in before", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authRequiredResponse())
      .mockResolvedValueOnce(jsonResponse(200, authUser))
      .mockResolvedValueOnce(emptyResponse(204));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Sign in" });
    await user.type(screen.getByLabelText("Email address"), "casey@example.com");
    await user.type(screen.getByLabelText("Password"), "StrongPass123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByText("Casey Instructor");
    await user.click(
      screen.getByRole("button", { name: "Casey Instructor, Instructor" }),
    );
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    });
  });
});

describe("Login theme toggle", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.cookie = "csrftoken=test-csrf-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("defaults to following the system preference with no stored choice", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(authRequiredResponse()));

    render(<App />);

    await screen.findByRole("heading", { name: "Sign in" });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("pins an explicit choice to the page and remembers it for next time", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(authRequiredResponse()));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Sign in" });
    await user.click(screen.getByRole("button", { name: "Dark" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("kukgrade-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("Navigation rail and role-gated routes", () => {
  const masterInstructorUser = {
    ...authUser,
    can_make_final_grading_decision: true,
  };

  const adminUser = {
    ...authUser,
    id: "9e1c44b3-d8f6-4c1a-a4d1-4cb8e788df22",
    email: "admin@example.com",
    first_name: "Alex",
    last_name: "Admin",
    full_name: "Alex Admin",
    role: "administrator" as const,
    role_display: "Administrator",
    can_promote_student: true,
    can_override_locked_session: true,
    is_staff: true,
  };

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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, authUser)));

    render(<App />);

    await screen.findByText("Casey Instructor");
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeVisible();

    expect(screen.getByRole("link", { name: "Overview" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Students" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Gradings" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Syllabus" })).toBeVisible();

    expect(screen.queryByRole("link", { name: "Audit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Overview" })).toBeVisible();
  });

  it("navigates between sections when navigation links are clicked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, authUser)));
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, authUser)));

    render(<App />);

    await screen.findByText("Casey Instructor");
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
    expect(screen.getByRole("heading", { name: "Overview" })).toBeVisible();
  });

  it("redirects an unauthorised instructor attempting direct URL access to /users", async () => {
    window.history.replaceState({}, "", "/users");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, authUser)));

    render(<App />);

    await screen.findByText("Casey Instructor");
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
    expect(screen.getByRole("heading", { name: "Overview" })).toBeVisible();
  });

  it("redirects an Authorised Master attempting direct URL access to /users", async () => {
    window.history.replaceState({}, "", "/users");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, masterInstructorUser)),
    );

    render(<App />);

    await screen.findByText("Casey Instructor");
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
    expect(screen.getByRole("heading", { name: "Overview" })).toBeVisible();
  });

  it("grants Audit access and displays the Audit link for an Authorised Master", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, masterInstructorUser)),
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
      vi.fn().mockResolvedValue(jsonResponse(200, adminUser)),
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
    can_promote_student: false,
    can_override_locked_session: false,
  };

  const adminUser = {
    ...authUser,
    id: "9e1c44b3-d8f6-4c1a-a4d1-4cb8e788df22",
    email: "admin@example.com",
    first_name: "Alex",
    last_name: "Admin",
    full_name: "Alex Admin",
    role: "administrator" as const,
    role_display: "Administrator",
    can_make_final_grading_decision: false,
    can_promote_student: true,
    can_override_locked_session: true,
    is_staff: true,
  };

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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, authUser)));
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
    expect(notGrantedBadges).toHaveLength(3);
    expect(screen.queryByText("Granted")).not.toBeInTheDocument();
  });

  it("displays granted status for Master capabilities held by an Authorised Master", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, masterUser)));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Casey Instructor");
    await user.click(
      screen.getByRole("button", { name: "Casey Instructor, Instructor" }),
    );

    expect(screen.getByText("Granted")).toBeVisible();
    const notGrantedBadges = screen.getAllByText("Not granted");
    expect(notGrantedBadges).toHaveLength(2);
  });

  it("displays granted status for student promotion and session override for an Administrator", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, adminUser)));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Alex Admin");
    expect(screen.getByText("AA")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Alex Admin, Administrator" }),
    );

    const grantedBadges = screen.getAllByText("Granted");
    expect(grantedBadges).toHaveLength(2);
    expect(screen.getByText("Not granted")).toBeVisible();
  });

  it("closes the profile menu when pressing the Escape key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, authUser)));
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, authUser)));
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
});

describe("Mandatory password change", () => {
  const forcedUser = {
    ...authUser,
    must_change_password: true,
  };

  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("renders mandatory password change view and blocks navigation when must_change_password is true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, forcedUser)));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Choose a new password" })).toBeVisible();
    expect(
      screen.getByText(/Your account was provisioned with a temporary password/i),
    ).toBeVisible();

    // Nav rail and main overview should NOT be visible
    expect(screen.queryByRole("navigation", { name: "Main navigation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Overview" })).not.toBeInTheDocument();
  });

  it("validates client-side constraints before submitting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, forcedUser)));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Choose a new password" });

    // Submit with short password
    await user.type(screen.getByLabelText(/Temporary or current password/i), "temp123!");
    await user.type(screen.getByLabelText(/^New password/i), "short");
    await user.type(screen.getByLabelText(/^Confirm new password/i), "short");
    await user.click(screen.getByRole("button", { name: "Update password and continue" }));

    expect(await screen.findByText("Password must be at least 8 characters.")).toBeVisible();

    // Submit with mismatched passwords
    await user.clear(screen.getByLabelText(/^New password/i));
    await user.type(screen.getByLabelText(/^New password/i), "ValidPass123!");
    await user.clear(screen.getByLabelText(/^Confirm new password/i));
    await user.type(screen.getByLabelText(/^Confirm new password/i), "MismatchPass456!");
    await user.click(screen.getByRole("button", { name: "Update password and continue" }));

    expect(await screen.findByText("New passwords do not match.")).toBeVisible();
  });

  it("submits change password, refetches user, and unlocks navigation on success", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, forcedUser);
      }
      if (url.includes("/api/auth/change-password/")) {
        const body = JSON.parse(init?.body as string);
        expect(body.current_password).toBe("temp-secret-123");
        expect(body.new_password).toBe("NewSecretPass123!");
        // Update mock so next /api/auth/me/ call returns must_change_password: false
        fetchMock.mockImplementation(async (nextUrl: string) => {
          if (nextUrl.includes("/api/auth/me/")) {
            return jsonResponse(200, { ...forcedUser, must_change_password: false });
          }
          return jsonResponse(404, {});
        });
        return emptyResponse(204);
      }
      return jsonResponse(404, {});
    });

    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Choose a new password" });

    await user.type(screen.getByLabelText(/Temporary or current password/i), "temp-secret-123");
    await user.type(screen.getByLabelText(/^New password/i), "NewSecretPass123!");
    await user.type(screen.getByLabelText(/^Confirm new password/i), "NewSecretPass123!");
    await user.click(screen.getByRole("button", { name: "Update password and continue" }));

    // Unlocks app and renders the main Overview heading
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  });

  it("surfaces API field errors when current password is wrong", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/auth/me/")) {
          return jsonResponse(200, forcedUser);
        }
        if (url.includes("/api/auth/change-password/")) {
          return jsonResponse(400, {
            error: {
              code: "validation_error",
              message: "Invalid input",
              fields: {
                current_password: ["Current password is incorrect."],
              },
            },
          });
        }
        return jsonResponse(404, {});
      }),
    );
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Choose a new password" });

    await user.type(screen.getByLabelText(/Temporary or current password/i), "wrong-temp-password");
    await user.type(screen.getByLabelText(/^New password/i), "ValidNewPass123!");
    await user.type(screen.getByLabelText(/^Confirm new password/i), "ValidNewPass123!");
    await user.click(screen.getByRole("button", { name: "Update password and continue" }));

    expect(await screen.findByText("Current password is incorrect.")).toBeVisible();
  });

  it("allows user to sign out from the mandatory password change view", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, forcedUser);
      }
      if (url.includes("/api/auth/logout/")) {
        return emptyResponse(204);
      }
      return jsonResponse(404, {});
    });

    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Choose a new password" });

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeVisible();
  });
});
