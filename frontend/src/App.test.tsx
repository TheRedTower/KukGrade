import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
    let signedIn = false;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return signedIn ? jsonResponse(200, authUser) : authRequiredResponse();
      }
      if (url.includes("/api/auth/login/")) {
        signedIn = true;
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
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

    expect(fetchMock).toHaveBeenCalledWith(
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
    const loginCall = fetchMock.mock.calls.find(([url]) =>
      url.includes("/api/auth/login/"),
    );
    expect(loginCall).toBeDefined();
    const loginHeaders = (loginCall![1] as RequestInit).headers as Headers;
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
    let signedIn = true;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return signedIn ? jsonResponse(200, authUser) : authRequiredResponse();
      }
      if (url.includes("/api/auth/logout/")) {
        signedIn = false;
        return emptyResponse(204);
      }
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
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

    expect(fetchMock).toHaveBeenCalledWith(
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
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/auth/logout/")) {
        throw new TypeError("Failed to fetch");
      }
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
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
    let signedIn = false;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return signedIn ? jsonResponse(200, authUser) : authRequiredResponse();
      }
      if (url.includes("/api/auth/login/")) {
        signedIn = true;
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/auth/logout/")) {
        signedIn = false;
        return emptyResponse(204);
      }
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
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

describe("Overview screen (Operational Ledger)", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("renders authentic empty states when no active sessions or events exist", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/audit-events/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeVisible();
    expect(screen.getByText(/TRADITION BUILDS PEOPLE/i)).toBeInTheDocument();
    expect(screen.getByText(/PEOPLE BUILD TOMORROW/i)).toBeInTheDocument();

    // Now card empty state
    expect(screen.getByText("No active grading session")).toBeVisible();
    expect(screen.getByText("No grading session in progress on the mat.")).toBeVisible();

    // Needs attention card empty state
    expect(screen.getByText("All clear")).toBeVisible();
    expect(
      screen.getByText("No candidate assessments currently requiring review."),
    ).toBeVisible();

    // Upcoming card empty state
    expect(screen.getByText("No upcoming gradings")).toBeVisible();
    expect(
      screen.getByText("No future grading sessions are currently scheduled."),
    ).toBeVisible();

    // Recent activity empty state
    expect(await screen.findByText("No recent activity recorded.")).toBeVisible();
  });

  it("renders active session, attention items, upcoming grading, and recent ledger activity", async () => {
    const openSession = {
      id: 101,
      title: "Spring Grading 2026",
      grading_date: "2026-05-15",
      status: "OPEN",
      status_display: "Open",
      location: "Colchester Dojang",
      created_by: authUser.id,
      created_by_email: authUser.email,
      created_at: "2026-05-01T09:00:00Z",
      updated_at: "2026-05-15T09:00:00Z",
    };

    const upcomingSession = {
      id: 102,
      title: "Summer Grading 2026",
      grading_date: "2099-08-20",
      status: "DRAFT",
      status_display: "Draft",
      location: "Ipswich Central",
      created_by: authUser.id,
      created_by_email: authUser.email,
      created_at: "2026-05-01T09:00:00Z",
      updated_at: "2026-05-01T09:00:00Z",
    };

    const candidates = [
      {
        id: 201,
        session: 101,
        session_title: "Spring Grading 2026",
        student: 301,
        student_display_name: "Student One",
        student_wksa_id: "UK12345",
        testing_for_rank: 2,
        testing_for_rank_code: "YS",
        testing_for_rank_name: "Yellow Stripe",
        age_band: "ADULT",
        age_band_display: "18+",
        status: "REGISTERED",
        status_display: "Registered",
        created_at: "2026-05-10T10:00:00Z",
        updated_at: "2026-05-10T10:00:00Z",
      },
      {
        id: 202,
        session: 101,
        session_title: "Spring Grading 2026",
        student: 302,
        student_display_name: "Student Two",
        student_wksa_id: "UK12346",
        testing_for_rank: 3,
        testing_for_rank_code: "Y",
        testing_for_rank_name: "Yellow Belt",
        age_band: "ADULT",
        age_band_display: "18+",
        status: "REGISTERED",
        status_display: "Registered",
        created_at: "2026-05-10T10:00:00Z",
        updated_at: "2026-05-10T10:00:00Z",
      },
    ];

    const assessments = [
      {
        id: 401,
        candidate: 201,
        candidate_student_name: "Student One",
        candidate_student_wksa_id: "UK12345",
        testing_for_rank_code: "YS",
        testing_for_rank_name: "Yellow Stripe",
        age_band: "ADULT",
        age_band_display: "18+",
        status: "COMPLETED",
        status_display: "Completed",
        generated_by: authUser.id,
        generated_by_email: authUser.email,
        generated_at: "2026-05-15T09:30:00Z",
        started_at: "2026-05-15T10:00:00Z",
        completed_at: "2026-05-15T11:00:00Z",
        item_counts: { total: 10, completed: 10 },
        created_at: "2026-05-15T09:30:00Z",
        updated_at: "2026-05-15T11:00:00Z",
      },
      {
        id: 402,
        candidate: 202,
        candidate_student_name: "Student Two",
        candidate_student_wksa_id: "UK12346",
        testing_for_rank_code: "Y",
        testing_for_rank_name: "Yellow Belt",
        age_band: "ADULT",
        age_band_display: "18+",
        status: "IN_PROGRESS",
        status_display: "In Progress",
        generated_by: authUser.id,
        generated_by_email: authUser.email,
        generated_at: "2026-05-15T09:30:00Z",
        started_at: "2026-05-15T10:30:00Z",
        completed_at: null,
        item_counts: { total: 12, completed: 5 },
        created_at: "2026-05-15T09:30:00Z",
        updated_at: "2026-05-15T10:30:00Z",
      },
    ];

    const auditEvents = [
      {
        id: 501,
        occurred_at: new Date().toISOString(),
        action: "candidate_assessment.completed",
        action_display: "Assessment Completed",
        entity_type: "CandidateAssessment",
        entity_id: "401",
        actor: authUser.id,
        actor_email: authUser.email,
        actor_name: "Casey Instructor",
        summary: "Assessment complete (ready for review)",
        metadata: {},
      },
      {
        id: 502,
        occurred_at: new Date().toISOString(),
        action: "candidate_assessment.started",
        action_display: "Assessment Started",
        entity_type: "CandidateAssessment",
        entity_id: "402",
        actor: authUser.id,
        actor_email: authUser.email,
        actor_name: "Casey Instructor",
        summary: "Assessment started on the mat",
        metadata: {},
      },
    ];

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, { ...authUser, role: "administrator" });
      }
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, {
          count: 2,
          next: null,
          previous: null,
          results: [openSession, upcomingSession],
        });
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, {
          count: 2,
          next: null,
          previous: null,
          results: candidates,
        });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, {
          count: 2,
          next: null,
          previous: null,
          results: assessments,
        });
      }
      if (url.includes("/api/audit-events/")) {
        return jsonResponse(200, {
          count: 2,
          next: null,
          previous: null,
          results: auditEvents,
        });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    // Now card
    expect(await screen.findByRole("heading", { name: "Spring Grading 2026" })).toBeVisible();
    expect(screen.getByText("Colchester Dojang")).toBeVisible();
    expect(await screen.findByText("1 / 2")).toBeVisible(); // 1 of 2 completed
    expect(screen.getByText("2")).toBeVisible(); // candidates count
    expect(screen.getByRole("button", { name: /Open session/i })).toBeVisible();

    // Needs attention card
    expect(await screen.findByText("Student One")).toBeVisible();
    expect(screen.getByText("Assessment complete · Awaiting your review")).toBeVisible();
    expect(screen.getByText("Student Two")).toBeVisible();
    expect(screen.getByText("Assessment in progress · Scoring pending")).toBeVisible();

    // Upcoming card
    expect(screen.getByText("Summer Grading 2026")).toBeVisible();
    expect(screen.getByText("Ipswich Central")).toBeVisible();

    // Recent activity table
    expect(await screen.findByText("Assessment complete (ready for review)")).toBeVisible();
    expect(screen.getByText("Assessment started on the mat")).toBeVisible();
    expect(screen.getByRole("button", { name: /View all activity/i })).toBeVisible();
  });

  it("navigates to gradings and audit when action links are clicked", async () => {
    const openSession = {
      id: 101,
      title: "Spring Grading 2026",
      grading_date: "2026-05-15",
      status: "OPEN",
      status_display: "Open",
      location: "Colchester Dojang",
      created_by: authUser.id,
      created_by_email: authUser.email,
      created_at: "2026-05-01T09:00:00Z",
      updated_at: "2026-05-15T09:00:00Z",
    };

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, { ...authUser, role: "administrator" });
      }
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [openSession] });
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/audit-events/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    // Click "Open session →"
    const openSessionButton = await screen.findByRole("button", { name: /Open session/i });
    await user.click(openSessionButton);
    expect(window.location.pathname).toBe("/gradings");

    // Navigate back to overview
    window.history.replaceState({}, "", "/");
    await user.click(screen.getByRole("link", { name: "Overview" }));

    // Click "View all activity →"
    const viewAllButton = await screen.findByRole("button", { name: /View all activity/i });
    await user.click(viewAllButton);
    expect(window.location.pathname).toBe("/audit");
  });
});

describe("Students registry screen (/students)", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/students");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("renders authentic empty state when no students exist in database", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/ranks/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Students" })).toBeVisible();
    expect(screen.getByText("Manage student records and grading history")).toBeVisible();
    expect(await screen.findByText("No students registered yet")).toBeVisible();
    expect(
      screen.getByText("Get started by registering your first student record in the registry."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Add student/i })).toBeVisible();
  });

  it("renders populated student rows with ranks, status badges, and privacy compliance", async () => {
    const testRanks = [
      { id: 1, code: "W", name: "White Belt", order: 1, category: "COLOUR_BELT", category_display: "Colour Belt", active: true },
      { id: 2, code: "YS", name: "Yellow Stripe", order: 2, category: "COLOUR_BELT", category_display: "Colour Belt", active: true },
      { id: 5, code: "B", name: "Blue Belt", order: 5, category: "COLOUR_BELT", category_display: "Colour Belt", active: true },
    ];

    const testStudents = [
      {
        id: 1,
        wksa_id: "UK-1001",
        first_name: "Bruce",
        last_name: "Wayne",
        current_rank: 1,
        current_rank_code: "W",
        current_rank_name: "White Belt",
        status: "ACTIVE",
        status_display: "Active",
      },
      {
        id: 2,
        wksa_id: "UK-1002",
        first_name: "Clark",
        last_name: "Kent",
        current_rank: 2,
        current_rank_code: "YS",
        current_rank_name: "Yellow Stripe",
        status: "INACTIVE",
        status_display: "Inactive",
      },
      {
        id: 3,
        wksa_id: "UK-1003",
        first_name: "Diana",
        last_name: "Prince",
        current_rank: 5,
        current_rank_code: "B",
        current_rank_name: "Blue Belt",
        status: "LEFT",
        status_display: "Left",
      },
    ];

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/ranks/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: testRanks });
      }
      if (url.match(/\/api\/students\/\d+\/rank-history\//)) {
        return jsonResponse(200, {
          student: 1,
          student_display_name: "Bruce Wayne (UK-1001)",
          student_wksa_id: "UK-1001",
          current_rank: 1,
          current_rank_code: "W",
          current_rank_name: "White Belt",
          promotions: [],
        });
      }
      if (url.match(/\/api\/students\/\d+\//)) {
        return jsonResponse(200, testStudents[0]);
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: testStudents });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    // Header & counters
    expect(await screen.findByRole("heading", { name: "Students" })).toBeVisible();
    expect(await screen.findByText("3 students")).toBeVisible();

    // Table rows
    const table = await screen.findByRole("table", { name: "Students directory" });
    const tableScope = within(table);

    expect(tableScope.getByText("Bruce Wayne")).toBeVisible();
    expect(tableScope.getByText("UK-1001")).toBeVisible();
    expect(tableScope.getByText("White Belt")).toBeVisible();
    expect(tableScope.getByText("Active")).toBeVisible();
    expect(tableScope.getByText("Prepare for next grading")).toBeVisible();

    expect(tableScope.getByText("Clark Kent")).toBeVisible();
    expect(tableScope.getByText("UK-1002")).toBeVisible();
    expect(tableScope.getByText("Yellow Stripe")).toBeVisible();
    expect(tableScope.getByText("Inactive")).toBeVisible();
    expect(tableScope.getByText("Follow up required")).toBeVisible();

    expect(tableScope.getByText("Diana Prince")).toBeVisible();
    expect(tableScope.getByText("UK-1003")).toBeVisible();
    expect(tableScope.getByText("Blue Belt")).toBeVisible();
    expect(tableScope.getByText("Left")).toBeVisible();
    expect(tableScope.getByText("No further action")).toBeVisible();

    // Privacy verification: Date of birth must NOT be rendered in table
    expect(screen.queryByText(/199[0-9]|200[0-9]/)).not.toBeInTheDocument();

    // Navigate to student profile via "View student →"
    const viewBruceButton = tableScope.getByRole("button", { name: /View record for Bruce Wayne/i });
    await user.click(viewBruceButton);
    expect(window.location.pathname).toBe("/students/1");
  });

  it("handles filter changes and clears filters back to initial state", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/ranks/")) {
        return jsonResponse(200, {
          count: 1,
          next: null,
          previous: null,
          results: [{ id: 1, code: "W", name: "White Belt", order: 1, category: "COLOUR_BELT", category_display: "Colour Belt", active: true }],
        });
      }
      if (url.includes("/api/students/")) {
        // Return empty when filtered
        if (url.includes("search=Nonexistent")) {
          return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
        }
        return jsonResponse(200, {
          count: 1,
          next: null,
          previous: null,
          results: [{
            id: 1,
            wksa_id: "UK-1001",
            first_name: "Bruce",
            last_name: "Wayne",
            current_rank: 1,
            current_rank_code: "W",
            current_rank_name: "White Belt",
            status: "ACTIVE",
            status_display: "Active",
          }],
        });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByText("Bruce Wayne")).toBeVisible();

    // Search input
    const searchInput = screen.getByPlaceholderText("Search name or WKSA ID");
    await user.type(searchInput, "Nonexistent");

    // Filter empty state renders
    expect(await screen.findByText("No matching students found")).toBeVisible();
    expect(screen.getByText("No records match your active search and filter criteria.")).toBeVisible();

    // Click "Clear all filters"
    const clearButton = screen.getByRole("button", { name: /Clear all filters/i });
    await user.click(clearButton);

    expect(searchInput).toHaveValue("");
    expect(await screen.findByText("Bruce Wayne")).toBeVisible();
  });
});

describe("Add student screen (/students/new)", () => {
  const testRanks = [
    { id: 1, code: "W", name: "White Belt", order: 1, category: "COLOUR_BELT", category_display: "Colour Belt", active: true },
    { id: 2, code: "YS", name: "Yellow Stripe", order: 2, category: "COLOUR_BELT", category_display: "Colour Belt", active: true },
    { id: 5, code: "B", name: "Blue Belt", order: 5, category: "COLOUR_BELT", category_display: "Colour Belt", active: true },
  ];

  beforeEach(() => {
    window.history.replaceState({}, "", "/students/new");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("renders the add student form with breadcrumbs, inputs, ranks, and privacy notice", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/ranks/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: testRanks });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    // Header & breadcrumbs
    expect(await screen.findByRole("heading", { name: "Add student" })).toBeVisible();
    expect(screen.getByText("Create a staff-only student record")).toBeVisible();
    expect(screen.getByRole("button", { name: "Students" })).toBeVisible();
    expect(screen.getByText("Add student", { selector: ".breadcrumb-current" })).toBeVisible();

    // Section 1: Identity
    expect(screen.getByRole("heading", { name: "Identity" })).toBeVisible();
    expect(screen.getByLabelText(/First name/i)).toBeVisible();
    expect(screen.getByLabelText(/Last name/i)).toBeVisible();
    expect(screen.getByLabelText(/WKSA ID/i)).toBeVisible();
    expect(screen.getByText("This identifier cannot be changed after the record is created.")).toBeVisible();

    // Section 2: Grading details
    expect(screen.getByRole("heading", { name: "Grading details" })).toBeVisible();
    expect(screen.getByLabelText(/Date of birth/i)).toBeVisible();
    expect(screen.getByText("Date of birth is visible only on the individual student record.")).toBeVisible();
    expect(screen.getByLabelText(/Current rank/i)).toBeVisible();

    // Ranks populated
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "White Belt" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Yellow Stripe" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Blue Belt" })).toBeInTheDocument();
    });

    // Status defaults to Active
    const statusSelect = screen.getByRole("combobox", { name: /^Status/i }) as HTMLSelectElement;
    expect(statusSelect.value).toBe("ACTIVE");

    // Action buttons
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Create student" })).toBeVisible();
  });

  it("blocks submission and shows client-side validation errors when required fields are empty", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/ranks/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: testRanks });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Add student" })).toBeVisible();

    // Submit empty form
    const submitBtn = screen.getByRole("button", { name: "Create student" });
    await user.click(submitBtn);

    // Validation messages
    expect(await screen.findByText("First name is required.")).toBeVisible();
    expect(screen.getByText("Last name is required.")).toBeVisible();
    expect(screen.getByText("WKSA ID is required.")).toBeVisible();
    expect(screen.getByText("Date of birth is required.")).toBeVisible();

    // Ensure no POST request was dispatched
    const postCalls = fetchMock.mock.calls.filter(([url, options]) =>
      url.includes("/api/students/") && (options as RequestInit)?.method === "POST"
    );
    expect(postCalls.length).toBe(0);
  });

  it("successfully creates a student and navigates to the student detail page", async () => {
    let createdPayload: unknown = null;
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/ranks/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: testRanks });
      }
      if (url.includes("/api/students/") && options?.method === "POST") {
        createdPayload = JSON.parse(options.body as string);
        return jsonResponse(201, {
          id: 42,
          wksa_id: "UK-9999",
          first_name: "Alex",
          last_name: "Carter",
          date_of_birth: "2005-04-12",
          current_rank: 2,
          current_rank_code: "YS",
          current_rank_name: "Yellow Stripe",
          status: "ACTIVE",
          status_display: "Active",
          attendance_count: 0,
          eligible_for_grading: false,
          created_at: "2026-09-17T12:00:00Z",
          updated_at: "2026-09-17T12:00:00Z",
        });
      }
      if (url.includes("/api/students/42")) {
        return jsonResponse(200, {
          id: 42,
          wksa_id: "UK-9999",
          first_name: "Alex",
          last_name: "Carter",
          date_of_birth: "2005-04-12",
          current_rank: 2,
          current_rank_code: "YS",
          current_rank_name: "Yellow Stripe",
          status: "ACTIVE",
          status_display: "Active",
          attendance_count: 0,
          eligible_for_grading: false,
          created_at: "2026-09-17T12:00:00Z",
          updated_at: "2026-09-17T12:00:00Z",
        });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Add student" })).toBeVisible();

    // Fill form
    await user.type(screen.getByLabelText(/First name/i), "Alex");
    await user.type(screen.getByLabelText(/Last name/i), "Carter");
    await user.type(screen.getByLabelText(/WKSA ID/i), "UK-9999");
    await user.type(screen.getByLabelText(/Date of birth/i), "2005-04-12");

    // Select Yellow Stripe (id 2)
    await user.selectOptions(screen.getByLabelText(/Current rank/i), "2");

    // Submit
    await user.click(screen.getByRole("button", { name: "Create student" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/students/42");
    });

    // Check payload passed to backend
    expect(createdPayload).toEqual({
      first_name: "Alex",
      last_name: "Carter",
      wksa_id: "UK-9999",
      date_of_birth: "2005-04-12",
      current_rank: 2,
      status: "ACTIVE",
    });
  });

  it("surfaces server validation errors (e.g. duplicate WKSA ID)", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/ranks/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: testRanks });
      }
      if (url.includes("/api/students/") && options?.method === "POST") {
        return jsonResponse(400, {
          error: {
            code: "validation_error",
            message: "Invalid input.",
            fields: {
              wksa_id: ["A student with this WKSA ID already exists."],
            },
          },
        });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Add student" })).toBeVisible();

    await user.type(screen.getByLabelText(/First name/i), "Alex");
    await user.type(screen.getByLabelText(/Last name/i), "Carter");
    await user.type(screen.getByLabelText(/WKSA ID/i), "DUPLICATE-ID");
    await user.type(screen.getByLabelText(/Date of birth/i), "2005-04-12");

    await user.click(screen.getByRole("button", { name: "Create student" }));

    expect(await screen.findByText("A student with this WKSA ID already exists.")).toBeVisible();
    expect(window.location.pathname).toBe("/students/new");
  });

  it("navigates back to /students when Cancel or breadcrumb is clicked", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/ranks/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: testRanks });
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Add student" })).toBeVisible();

    // Click Cancel button
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    await user.click(cancelBtn);

    expect(window.location.pathname).toBe("/students");
  });
});

describe("Student detail screen (/students/:id)", () => {
  const testRanks = [
    { id: 1, code: "W", name: "White Belt", order: 1, category: "COLOUR_BELT", category_display: "Colour Belt", active: true },
    { id: 2, code: "YS", name: "Yellow Stripe", order: 2, category: "COLOUR_BELT", category_display: "Colour Belt", active: true },
    { id: 3, code: "Y", name: "Yellow Belt", order: 3, category: "COLOUR_BELT", category_display: "Colour Belt", active: true },
  ];

  const testStudent = {
    id: 10,
    wksa_id: "UK-5001",
    first_name: "Alex",
    last_name: "Carter",
    date_of_birth: "2012-04-24",
    current_rank: 2,
    current_rank_code: "YS",
    current_rank_name: "Yellow Stripe",
    status: "ACTIVE",
    status_display: "Active",
    can_be_graded: true,
    created_at: "2021-01-08T10:00:00Z",
    updated_at: "2021-01-08T10:00:00Z",
  };

  beforeEach(() => {
    window.history.replaceState({}, "", "/students/10");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("renders student profile with personal details, age band, readiness, and empty history", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/ranks/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: testRanks });
      }
      if (url.includes("/api/students/10/rank-history/")) {
        return jsonResponse(200, {
          student: 10,
          student_display_name: "Alex Carter (UK-5001)",
          student_wksa_id: "UK-5001",
          current_rank: 2,
          current_rank_code: "YS",
          current_rank_name: "Yellow Stripe",
          promotions: [],
        });
      }
      if (url.includes("/api/students/10/")) {
        return jsonResponse(200, testStudent);
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    // Header & identity
    expect(await screen.findByRole("heading", { name: "Alex Carter" })).toBeVisible();
    expect(screen.getByText("UK-5001")).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit student" })).toBeVisible();

    // Breadcrumb
    expect(screen.getByRole("button", { name: "Students" })).toBeVisible();
    expect(screen.getByText("Alex Carter", { selector: ".breadcrumb-current" })).toBeVisible();

    // Student details card
    expect(screen.getByRole("heading", { name: "Student details" })).toBeVisible();
    expect(screen.getByText("24 April 2012")).toBeVisible();
    expect(screen.getByText("13 – 17")).toBeVisible();
    expect(screen.getByText("08 January 2021")).toBeVisible();

    // Grading readiness card
    expect(screen.getByRole("heading", { name: "Grading readiness" })).toBeVisible();
    expect(screen.getByText("Yellow Belt")).toBeVisible();
    expect(screen.getByText("Eligible for registration")).toBeVisible();

    // Record status card
    expect(screen.getByRole("heading", { name: "Record status" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Change status" })).toBeVisible();

    // Empty grading history
    expect(screen.getByText("No grading history recorded")).toBeVisible();
  });

  it("renders populated grading history table and timeline with past promotions", async () => {
    const testPromotions = [
      {
        id: 101,
        from_rank: 1,
        from_rank_code: "W",
        from_rank_name: "White Belt",
        to_rank: 2,
        to_rank_code: "YS",
        to_rank_name: "Yellow Stripe",
        session: 5,
        session_title: "Winter Grading",
        grading_date: "2025-12-12",
        outcome: 12,
        outcome_status: "CONFIRMED",
        final_outcome: "PASS",
        promoted_by: "7d3c55f4-e9e7-4b2b-b5d0-5fc9e899df17",
        promoted_by_email: "master@example.com",
        promoted_by_name: "Master Tan",
        promoted_at: "2025-12-12T14:30:00Z",
        effective_date: "2025-12-12",
        notes: "Excellent forms and techniques.",
      },
    ];

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/ranks/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: testRanks });
      }
      if (url.includes("/api/students/10/rank-history/")) {
        return jsonResponse(200, {
          student: 10,
          student_display_name: "Alex Carter (UK-5001)",
          student_wksa_id: "UK-5001",
          current_rank: 2,
          current_rank_code: "YS",
          current_rank_name: "Yellow Stripe",
          promotions: testPromotions,
        });
      }
      if (url.includes("/api/students/10/")) {
        return jsonResponse(200, testStudent);
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Alex Carter" })).toBeVisible();

    // Table rows
    const table = await screen.findByRole("table", { name: "Grading history" });
    const tableScope = within(table);

    expect(tableScope.getByText("Winter Grading")).toBeVisible();
    expect(tableScope.getByText("12 Dec 2025")).toBeVisible();
    expect(tableScope.getByText("White Belt")).toBeVisible();
    expect(tableScope.getByText("Passed")).toBeVisible();
    expect(tableScope.getByText("Yellow Stripe")).toBeVisible();

    // Rank history timeline
    expect(screen.getByText("Promoted at Winter Grading")).toBeVisible();
    expect(screen.getByText("Joined Kuk Sool Won")).toBeVisible();
  });

  it("changes student status via status modal and triggers PATCH request", async () => {
    let patchPayload: unknown = null;
    let currentStatus = "ACTIVE";

    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/ranks/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: testRanks });
      }
      if (url.includes("/api/students/10/rank-history/")) {
        return jsonResponse(200, {
          student: 10,
          student_display_name: "Alex Carter (UK-5001)",
          student_wksa_id: "UK-5001",
          current_rank: 2,
          current_rank_code: "YS",
          current_rank_name: "Yellow Stripe",
          promotions: [],
        });
      }
      if (url.includes("/api/students/10/") && options?.method === "PATCH") {
        patchPayload = JSON.parse(options.body as string);
        currentStatus = (patchPayload as { status: string }).status;
        return jsonResponse(200, {
          ...testStudent,
          status: currentStatus,
          status_display: currentStatus === "INACTIVE" ? "Inactive" : "Active",
        });
      }
      if (url.includes("/api/students/10/")) {
        return jsonResponse(200, {
          ...testStudent,
          status: currentStatus,
          status_display: currentStatus === "INACTIVE" ? "Inactive" : "Active",
        });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Alex Carter" })).toBeVisible();

    // Open change status modal
    const changeStatusBtn = screen.getByRole("button", { name: "Change status" });
    await user.click(changeStatusBtn);

    expect(await screen.findByRole("heading", { name: "Change student status" })).toBeVisible();

    // Select Inactive option
    const inactiveRadio = screen.getByLabelText(/Inactive/i);
    await user.click(inactiveRadio);

    // Save status
    const updateBtn = screen.getByRole("button", { name: "Update status" });
    await user.click(updateBtn);

    // Check patch payload
    await waitFor(() => {
      expect(patchPayload).toEqual({ status: "INACTIVE" });
    });

    // Modal closed
    expect(screen.queryByRole("heading", { name: "Change student status" })).not.toBeInTheDocument();
  });

  it("edits student details via edit student modal", async () => {
    let patchPayload: unknown = null;

    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/ranks/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: testRanks });
      }
      if (url.includes("/api/students/10/rank-history/")) {
        return jsonResponse(200, {
          student: 10,
          student_display_name: "Alex Carter (UK-5001)",
          student_wksa_id: "UK-5001",
          current_rank: 2,
          current_rank_code: "YS",
          current_rank_name: "Yellow Stripe",
          promotions: [],
        });
      }
      if (url.includes("/api/students/10/") && options?.method === "PATCH") {
        patchPayload = JSON.parse(options.body as string);
        return jsonResponse(200, {
          ...testStudent,
          ...(patchPayload as object),
        });
      }
      if (url.includes("/api/students/10/")) {
        return jsonResponse(200, testStudent);
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Alex Carter" })).toBeVisible();

    // Open edit student modal
    const editBtn = screen.getByRole("button", { name: "Edit student" });
    await user.click(editBtn);

    expect(await screen.findByRole("heading", { name: "Edit student record" })).toBeVisible();

    // Verify WKSA ID is disabled
    const wksaInput = screen.getByLabelText("WKSA ID") as HTMLInputElement;
    expect(wksaInput).toBeDisabled();

    // Change first name
    const firstNameInput = screen.getByLabelText(/First name/i);
    await user.clear(firstNameInput);
    await user.type(firstNameInput, "Alexander");

    // Submit edit
    const saveBtn = screen.getByRole("button", { name: "Save changes" });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(patchPayload).toEqual({
        first_name: "Alexander",
        last_name: "Carter",
        date_of_birth: "2012-04-24",
      });
    });

    expect(screen.queryByRole("heading", { name: "Edit student record" })).not.toBeInTheDocument();
  });

  it("navigates back to /students when clicking breadcrumb", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/ranks/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: testRanks });
      }
      if (url.includes("/api/students/10/rank-history/")) {
        return jsonResponse(200, {
          student: 10,
          student_display_name: "Alex Carter (UK-5001)",
          student_wksa_id: "UK-5001",
          current_rank: 2,
          current_rank_code: "YS",
          current_rank_name: "Yellow Stripe",
          promotions: [],
        });
      }
      if (url.includes("/api/students/10/")) {
        return jsonResponse(200, testStudent);
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [testStudent] });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Alex Carter" })).toBeVisible();

    const breadcrumbBtn = screen.getByRole("button", { name: "Students" });
    await user.click(breadcrumbBtn);

    expect(window.location.pathname).toBe("/students");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Grading Sessions List Screen (/gradings)
// ─────────────────────────────────────────────────────────────────────────────

describe("Grading Sessions List Screen (/gradings)", () => {
  const testSessions = [
    {
      id: 1,
      title: "Autumn Grading",
      grading_date: "2026-09-15",
      status: "OPEN",
      status_display: "Open",
      location: "Colchester Dojang",
      notes: "",
      cancellation_reason: "",
      created_by: "7d3c55f4-e9e7-4b2b-b5d0-5fc9e899df17",
      created_by_email: "master@example.com",
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-15T10:00:00Z",
    },
    {
      id: 2,
      title: "Summer Grading",
      grading_date: "2026-06-20",
      status: "LOCKED",
      status_display: "Locked",
      location: "Colchester Dojang",
      notes: "",
      cancellation_reason: "",
      created_by: "7d3c55f4-e9e7-4b2b-b5d0-5fc9e899df17",
      created_by_email: "master@example.com",
      created_at: "2026-06-01T10:00:00Z",
      updated_at: "2026-06-20T10:00:00Z",
    },
    {
      id: 3,
      title: "Spring Grading",
      grading_date: "2026-03-21",
      status: "COMPLETED",
      status_display: "Completed",
      location: "Colchester Dojang",
      notes: "",
      cancellation_reason: "",
      created_by: "7d3c55f4-e9e7-4b2b-b5d0-5fc9e899df17",
      created_by_email: "master@example.com",
      created_at: "2026-03-01T10:00:00Z",
      updated_at: "2026-03-21T10:00:00Z",
    },
  ];

  function makeFetch(sessions = testSessions) {
    return vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      // All-sessions fetch (page_size=200) for year dropdown & current session
      if (url.includes("/api/gradings/sessions/") && url.includes("page_size=200")) {
        return jsonResponse(200, { count: sessions.length, next: null, previous: null, results: sessions });
      }
      // Paginated sessions fetch (page_size=10 or no page_size)
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: sessions.length, next: null, previous: null, results: sessions });
      }
      // Candidates per session
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 5, next: null, previous: null, results: [] });
      }
      // Assessments per session
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
  }

  beforeEach(() => {
    window.history.replaceState({}, "", "/gradings");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("renders gradings page heading and subtitle", async () => {
    vi.stubGlobal("fetch", makeFetch());

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Gradings" })).toBeVisible();
    expect(screen.getByText("Plan and manage grading sessions")).toBeVisible();
  });

  it("renders session table rows from API with title, date, and status", async () => {
    vi.stubGlobal("fetch", makeFetch());

    render(<App />);

    await screen.findByRole("heading", { name: "Gradings" });

    // Sessions should appear — Autumn Grading appears in both the spotlight and the table
    const autumnInstances = await screen.findAllByText("Autumn Grading");
    expect(autumnInstances.length).toBeGreaterThanOrEqual(1);
    // LOCKED and COMPLETED sessions only appear in the table
    expect(await screen.findByText("Summer Grading")).toBeVisible();
    expect(await screen.findByText("Spring Grading")).toBeVisible();
  });

  it("renders the current (open) session spotlight card", async () => {
    vi.stubGlobal("fetch", makeFetch());

    render(<App />);

    await screen.findByRole("heading", { name: "Gradings" });

    // Current session spotlight card
    const spotlight = await screen.findByRole("region", { name: "Current grading session" });
    expect(spotlight).toBeVisible();
    expect(within(spotlight).getByText("Autumn Grading")).toBeVisible();
    // Candidates metric label
    expect(within(spotlight).getByText("Candidates")).toBeVisible();
  });

  it("renders authentic empty state when no sessions exist", async () => {
    const emptyFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", emptyFetch);

    render(<App />);

    await screen.findByRole("heading", { name: "Gradings" });

    expect(
      await screen.findByText("No grading sessions found. Create a new grading session to get started."),
    ).toBeVisible();
  });

  it("renders both Create grading buttons with coherent primary styling in empty state for admin", async () => {
    const adminUser = {
      ...authUser,
      role: "administrator" as const,
      role_display: "Administrator",
      is_staff: true,
      is_superuser: true,
    };
    const emptyAdminFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", emptyAdminFetch);

    render(<App />);

    await screen.findByRole("heading", { name: "Gradings" });
    await screen.findByText("No grading sessions found. Create a new grading session to get started.");

    const createButtons = await screen.findAllByRole("button", { name: /create grading/i });
    expect(createButtons).toHaveLength(2);

    const [headerBtn, emptyStateBtn] = createButtons;
    expect(headerBtn).toHaveAttribute("id", "create-grading-btn");
    expect(emptyStateBtn).toHaveAttribute("id", "gs-create-first-btn");

    // Both buttons share identical coherent primary styling classes
    expect(headerBtn.className).toBe(emptyStateBtn.className);
    expect(emptyStateBtn.className).toContain("gs-create-btn");
    expect(emptyStateBtn.className).toContain("btn-primary");
  });

  it("filters sessions by status dropdown and shows reset option on mismatch", async () => {
    const cancelledSession = {
      id: 4,
      title: "Cancelled Test Grading",
      grading_date: "2025-09-13",
      status: "CANCELLED",
      status_display: "Cancelled",
      location: "Colchester Dojang",
      notes: "",
      cancellation_reason: "Venue unavailable",
      created_by: "7d3c55f4-e9e7-4b2b-b5d0-5fc9e899df17",
      created_by_email: "master@example.com",
      created_at: "2025-09-01T10:00:00Z",
      updated_at: "2025-09-13T10:00:00Z",
    };

    const filterFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/") && url.includes("page_size=200")) {
        return jsonResponse(200, {
          count: 4,
          next: null,
          previous: null,
          results: [...testSessions, cancelledSession],
        });
      }
      if (url.includes("/api/gradings/sessions/") && url.includes("status=CANCELLED")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [cancelledSession] });
      }
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 3, next: null, previous: null, results: testSessions });
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", filterFetch);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Gradings" });
    // Wait for sessions to load — Autumn Grading appears in spotlight + table
    expect((await screen.findAllByText("Autumn Grading")).length).toBeGreaterThanOrEqual(1);

    // Apply cancelled status filter — spotlight disappears, only cancelled session shown
    const statusSelect = screen.getByRole("combobox", { name: "Status" });
    await user.selectOptions(statusSelect, "CANCELLED");

    expect(await screen.findByText("Cancelled Test Grading")).toBeVisible();
  });
});

// Create Grading Session Screen (/gradings/new)
describe("Create Grading Session Screen (/gradings/new)", () => {
  const adminUser = {
    id: "7d3c55f4-e9e7-4b2b-b5d0-5fc9e899df17",
    email: "admin@example.com",
    first_name: "Alex",
    last_name: "Admin",
    full_name: "Alex Admin",
    role: "administrator" as const,
    role_display: "Administrator",
    can_make_final_grading_decision: true,
    can_promote_student: true,
    can_override_locked_session: true,
    must_change_password: false,
    is_staff: true,
    is_superuser: true,
  };

  beforeEach(() => {
    window.history.replaceState({}, "", "/gradings/new");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("renders create grading session form with breadcrumbs, inputs, and preview card", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Create grading session" })).toBeVisible();
    expect(screen.getByText("Set the details, then add candidates.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Gradings" })).toBeVisible();
    expect(screen.getByLabelText(/session title/i)).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Grading day" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Grading month" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Grading year" })).toBeVisible();
    expect(screen.getByLabelText(/location/i)).toBeVisible();
    expect(screen.getByLabelText(/staff notes/i)).toBeVisible();
    expect(screen.getByText("0/500")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Session preview" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Create draft session" })).toBeVisible();
  });

  it("updates session preview card live as the user enters title, date, and location", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Create grading session" });

    // Initial placeholder state
    const previewTable = screen.getByRole("table", { name: "Session preview" });
    expect(within(previewTable).getByRole("cell", { name: "Session title" })).toBeVisible();

    // Type title
    await user.type(screen.getByLabelText(/session title/i), "Winter Grading");
    expect(within(previewTable).getByRole("cell", { name: "Winter Grading" })).toBeVisible();

    // Select date: 12 December 2026
    await user.selectOptions(screen.getByRole("combobox", { name: "Grading day" }), "12");
    await user.selectOptions(screen.getByRole("combobox", { name: "Grading month" }), "12");
    await user.selectOptions(screen.getByRole("combobox", { name: "Grading year" }), "2026");

    expect(within(previewTable).getByText("Saturday 12 December 2026")).toBeVisible();

    // Type location
    await user.type(screen.getByLabelText(/location/i), "Colchester Dojang");
    expect(within(previewTable).getByText("Colchester Dojang")).toBeVisible();

    // Check notes counter
    await user.type(screen.getByLabelText(/staff notes/i), "Bring extra forms");
    expect(screen.getByText("17/500")).toBeVisible();
  });

  it("blocks submission and shows client validation errors when required fields are empty", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Create grading session" });

    // Click submit without filling required fields
    await user.click(screen.getByRole("button", { name: "Create draft session" }));

    expect(await screen.findByText("Session title is required.")).toBeVisible();
    expect(await screen.findByText("Grading date is required.")).toBeVisible();

    // Ensure no POST request was made to /api/gradings/sessions/
    const sessionCalls = fetchMock.mock.calls.filter(([url]) => url.includes("/api/gradings/sessions/"));
    expect(sessionCalls).toHaveLength(0);
  });

  it("successfully creates a grading session and navigates to /gradings", async () => {
    const createdSession = {
      id: 99,
      title: "Spring Grading 2027",
      grading_date: "2027-03-20",
      status: "DRAFT",
      status_display: "Draft",
      location: "Colchester Central Dojang",
      notes: "High rank candidates expected",
      cancellation_reason: "",
      created_by: adminUser.id,
      created_by_email: adminUser.email,
      created_at: "2026-09-17T22:00:00Z",
      updated_at: "2026-09-17T22:00:00Z",
    };

    let postBody: unknown = null;
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/") && init?.method === "POST") {
        postBody = JSON.parse(init.body as string);
        return jsonResponse(201, createdSession);
      }
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [createdSession] });
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Create grading session" });

    await user.type(screen.getByLabelText(/session title/i), "Spring Grading 2027");
    await user.selectOptions(screen.getByRole("combobox", { name: "Grading day" }), "20");
    await user.selectOptions(screen.getByRole("combobox", { name: "Grading month" }), "03");
    await user.selectOptions(screen.getByRole("combobox", { name: "Grading year" }), "2027");
    await user.type(screen.getByLabelText(/location/i), "Colchester Central Dojang");
    await user.type(screen.getByLabelText(/staff notes/i), "High rank candidates expected");

    await user.click(screen.getByRole("button", { name: "Create draft session" }));

    await waitFor(() => {
      expect(postBody).toEqual({
        title: "Spring Grading 2027",
        grading_date: "2027-03-20",
        location: "Colchester Central Dojang",
        notes: "High rank candidates expected",
      });
    });

    // Navigates back to /gradings
    await waitFor(() => {
      expect(window.location.pathname).toBe("/gradings");
    });
  });

  it("navigates back to /gradings when Cancel or the breadcrumb link is clicked", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Create grading session" });

    // Click Cancel
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(window.location.pathname).toBe("/gradings");
  });

  it("surfaces server validation error messages on submission failure", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/") && init?.method === "POST") {
        return jsonResponse(400, {
          error: {
            code: "validation_error",
            message: "Invalid input.",
            fields: {
              title: ["A grading session with this title already exists."],
            },
          },
        });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Create grading session" });

    await user.type(screen.getByLabelText(/session title/i), "Duplicate Title");
    await user.selectOptions(screen.getByRole("combobox", { name: "Grading day" }), "15");
    await user.selectOptions(screen.getByRole("combobox", { name: "Grading month" }), "05");
    await user.selectOptions(screen.getByRole("combobox", { name: "Grading year" }), "2027");

    await user.click(screen.getByRole("button", { name: "Create draft session" }));

    expect(await screen.findByText("A grading session with this title already exists.")).toBeVisible();
  });
});

describe("Grading Session Workspace Screen (/gradings/:id)", () => {
  const adminUser = {
    id: "7d3c55f4-e9e7-4b2b-b5d0-5fc9e899df17",
    email: "admin@example.com",
    first_name: "Alex",
    last_name: "Admin",
    full_name: "Alex Admin",
    role: "administrator" as const,
    role_display: "Administrator",
    can_make_final_grading_decision: true,
    can_promote_student: true,
    can_override_locked_session: true,
    must_change_password: false,
    is_staff: true,
    is_superuser: true,
  };

  const testSession = {
    id: 10,
    title: "Autumn Grading",
    grading_date: "2026-09-15",
    status: "OPEN" as const,
    status_display: "Open",
    location: "Colchester Dojang",
    notes: "Please arrive 15 minutes before the start time.",
    cancellation_reason: "",
    created_by: adminUser.id,
    created_by_email: adminUser.email,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
  };

  const testCandidates = [
    {
      id: 101,
      session: 10,
      session_title: "Autumn Grading",
      student: 1,
      student_display_name: "Alex Carter",
      student_wksa_id: "UK-1001",
      testing_for_rank: 3,
      testing_for_rank_code: "Y",
      testing_for_rank_name: "Yellow",
      age_band: "ADULT",
      age_band_display: "18+",
      status: "REGISTERED" as const,
      status_display: "Registered",
      notes: "",
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-01T10:00:00Z",
    },
    {
      id: 102,
      session: 10,
      session_title: "Autumn Grading",
      student: 2,
      student_display_name: "Brooke Ellis",
      student_wksa_id: "UK-1002",
      testing_for_rank: 6,
      testing_for_rank_code: "RS",
      testing_for_rank_name: "Red stripe",
      age_band: "ADULT",
      age_band_display: "18+",
      status: "REGISTERED" as const,
      status_display: "Registered",
      notes: "",
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-01T10:00:00Z",
    },
    {
      id: 103,
      session: 10,
      session_title: "Autumn Grading",
      student: 3,
      student_display_name: "Casey Nguyen",
      student_wksa_id: "UK-1003",
      testing_for_rank: 7,
      testing_for_rank_code: "R",
      testing_for_rank_name: "Red",
      age_band: "ADULT",
      age_band_display: "18+",
      status: "REGISTERED" as const,
      status_display: "Registered",
      notes: "",
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-01T10:00:00Z",
    },
  ];

  const testAssessments = [
    {
      id: 201,
      candidate: 101,
      candidate_student_name: "Alex Carter",
      candidate_student_wksa_id: "UK-1001",
      testing_for_rank_code: "Y",
      testing_for_rank_name: "Yellow",
      age_band: "ADULT",
      age_band_display: "18+",
      status: "IN_PROGRESS" as const,
      status_display: "In progress",
      generated_by: adminUser.id,
      generated_by_email: adminUser.email,
      generated_at: "2026-09-15T09:00:00Z",
      started_at: "2026-09-15T09:10:00Z",
      completed_at: null,
      notes: "",
      item_counts: { total: 10, required: 10, met: 5, not_met: 0, not_assessed: 5 },
      created_at: "2026-09-15T09:00:00Z",
      updated_at: "2026-09-15T09:10:00Z",
    },
    {
      id: 202,
      candidate: 102,
      candidate_student_name: "Brooke Ellis",
      candidate_student_wksa_id: "UK-1002",
      testing_for_rank_code: "RS",
      testing_for_rank_name: "Red stripe",
      age_band: "ADULT",
      age_band_display: "18+",
      status: "COMPLETED" as const,
      status_display: "Completed",
      generated_by: adminUser.id,
      generated_by_email: adminUser.email,
      generated_at: "2026-09-15T09:00:00Z",
      started_at: "2026-09-15T09:10:00Z",
      completed_at: "2026-09-15T10:00:00Z",
      notes: "",
      item_counts: { total: 12, required: 12, met: 12, not_met: 0, not_assessed: 0 },
      created_at: "2026-09-15T09:00:00Z",
      updated_at: "2026-09-15T10:00:00Z",
    },
    {
      id: 203,
      candidate: 103,
      candidate_student_name: "Casey Nguyen",
      candidate_student_wksa_id: "UK-1003",
      testing_for_rank_code: "R",
      testing_for_rank_name: "Red",
      age_band: "ADULT",
      age_band_display: "18+",
      status: "NOT_STARTED" as const,
      status_display: "Not started",
      generated_by: adminUser.id,
      generated_by_email: adminUser.email,
      generated_at: "2026-09-15T09:00:00Z",
      started_at: null,
      completed_at: null,
      notes: "",
      item_counts: { total: 14, required: 14, met: 0, not_met: 0, not_assessed: 14 },
      created_at: "2026-09-15T09:00:00Z",
      updated_at: "2026-09-15T09:00:00Z",
    },
  ];

  const testOutcomes = [
    {
      id: 302,
      candidate: 102,
      assessment: 202,
      assessment_status: "COMPLETED",
      student: 2,
      student_display_name: "Brooke Ellis",
      student_wksa_id: "UK-1002",
      session: 10,
      session_title: "Autumn Grading",
      testing_for_rank: 6,
      testing_for_rank_code: "RS",
      testing_for_rank_name: "Red stripe",
      status: "PROPOSED" as const,
      status_display: "Proposed",
      proposed_outcome: "PASS" as const,
      proposed_outcome_display: "Pass",
      proposed_by: adminUser.id,
      proposed_by_email: adminUser.email,
      proposed_by_name: "Alex Admin",
      proposed_at: "2026-09-15T10:05:00Z",
      proposal_notes: "Strong stances throughout.",
      final_outcome: null,
      final_outcome_display: "",
      decided_by: null,
      decided_by_email: "",
      decided_by_name: "",
      decided_at: null,
      decision_notes: "",
      conditional_requirements: "",
      created_at: "2026-09-15T10:05:00Z",
      updated_at: "2026-09-15T10:05:00Z",
    },
  ];

  const testStudentsList = [
    {
      id: 1,
      wksa_id: "UK-1001",
      first_name: "Alex",
      last_name: "Carter",
      current_rank: 2,
      current_rank_code: "YS",
      current_rank_name: "Yellow stripe",
      status: "ACTIVE" as const,
      status_display: "Active",
    },
    {
      id: 2,
      wksa_id: "UK-1002",
      first_name: "Brooke",
      last_name: "Ellis",
      current_rank: 5,
      current_rank_code: "B",
      current_rank_name: "Blue",
      status: "ACTIVE" as const,
      status_display: "Active",
    },
    {
      id: 3,
      wksa_id: "UK-1003",
      first_name: "Casey",
      last_name: "Nguyen",
      current_rank: 6,
      current_rank_code: "RS",
      current_rank_name: "Red stripe",
      status: "ACTIVE" as const,
      status_display: "Active",
    },
  ];

  beforeEach(() => {
    window.history.replaceState({}, "", "/gradings/10");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  function setupStandardMock(sessionOverrides = {}) {
    return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/10/") && init?.method === "PATCH") {
        const patchData = JSON.parse(init.body as string);
        return jsonResponse(200, { ...testSession, ...sessionOverrides, ...patchData });
      }
      if (url.includes("/api/gradings/sessions/10/")) {
        return jsonResponse(200, { ...testSession, ...sessionOverrides });
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: testCandidates.length, next: null, previous: null, results: testCandidates });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: testAssessments.length, next: null, previous: null, results: testAssessments });
      }
      if (url.includes("/api/gradings/outcomes/")) {
        return jsonResponse(200, { count: testOutcomes.length, next: null, previous: null, results: testOutcomes });
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, { count: testStudentsList.length, next: null, previous: null, results: testStudentsList });
      }
      return jsonResponse(404, {});
    });
  }

  it("renders session header, breadcrumbs, status pill, and lifecycle stepper track", async () => {
    const fetchMock = setupStandardMock();
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Autumn Grading" })).toBeVisible();
    expect(screen.getByText("Colchester Dojang")).toBeVisible();
    expect(screen.getByText("Open", { selector: ".gsd-status-pill" })).toBeVisible();

    // Stepper track
    expect(screen.getByText("Draft", { selector: ".gsd-step-label" })).toBeVisible();
    expect(screen.getByText("Locked", { selector: ".gsd-step-label" })).toBeVisible();
    expect(screen.getByText("Completed", { selector: ".gsd-step-label" })).toBeVisible();

    // Action buttons in header
    expect(screen.getByTestId("gsd-actions-btn")).toBeVisible();
    expect(screen.getByTestId("gsd-add-candidate-btn")).toBeVisible();
  });

  it("renders candidate roster table with authentic student ranks, assessment and outcome badges", async () => {
    const fetchMock = setupStandardMock();
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });

    // Heading and count chip
    expect(screen.getByRole("heading", { name: "Candidates" })).toBeVisible();
    expect(screen.getByText("3 candidates")).toBeVisible();

    // Candidate 1: Alex Carter
    const row1 = await screen.findByTestId("candidate-row-101");
    expect(within(row1).getByText("Alex Carter")).toBeVisible();
    expect(within(row1).getByText("WKSA: UK-1001")).toBeVisible();
    expect(within(row1).getByText("Yellow stripe")).toBeVisible();
    expect(within(row1).getByText("Yellow")).toBeVisible();
    expect(within(row1).getByText("In progress")).toBeVisible();
    expect(within(row1).getByText("Continue assessment →")).toBeVisible();

    // Candidate 2: Brooke Ellis
    const row2 = screen.getByTestId("candidate-row-102");
    expect(within(row2).getByText("Brooke Ellis")).toBeVisible();
    expect(within(row2).getByText("Blue")).toBeVisible();
    expect(within(row2).getByText("Red stripe")).toBeVisible();
    expect(within(row2).getByText("Completed")).toBeVisible();
    expect(within(row2).getByText("Proposed: Pass")).toBeVisible();
    expect(within(row2).getByText("Review decision →")).toBeVisible();

    // Candidate 3: Casey Nguyen
    const row3 = screen.getByTestId("candidate-row-103");
    expect(within(row3).getByText("Casey Nguyen")).toBeVisible();
    expect(within(row3).getByText("Red stripe")).toBeVisible();
    expect(within(row3).getByText("Red")).toBeVisible();
    expect(within(row3).getByText("Not started")).toBeVisible();
    expect(within(row3).getByText("Start assessment →")).toBeVisible();
  });

  it("surfaces operational alert banner when candidates await final decision and triggers filter on Review", async () => {
    const fetchMock = setupStandardMock();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });

    // Alert banner
    expect(screen.getByText("1 candidate awaiting final decision")).toBeVisible();
    const reviewBtn = screen.getByTestId("gsd-review-decisions-btn");
    expect(reviewBtn).toBeVisible();

    // Click Review -> filters by Completed assessment
    await user.click(reviewBtn);

    const statusSelect = screen.getByTestId("gsd-status-filter") as HTMLSelectElement;
    expect(statusSelect.value).toBe("COMPLETED");

    // Only Brooke Ellis has completed assessment
    const table = screen.getByTestId("gsd-candidates-table");
    expect(within(table).getByText("Brooke Ellis")).toBeVisible();
    expect(within(table).queryByText("Alex Carter")).not.toBeInTheDocument();
    expect(within(table).queryByText("Casey Nguyen")).not.toBeInTheDocument();
  });

  it("filters candidate roster in real-time by search query", async () => {
    const fetchMock = setupStandardMock();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });

    const searchInput = screen.getByTestId("gsd-candidate-search");
    await user.type(searchInput, "Alex");

    const table = screen.getByTestId("gsd-candidates-table");
    expect(within(table).getByText("Alex Carter")).toBeVisible();
    expect(within(table).queryByText("Brooke Ellis")).not.toBeInTheDocument();
    expect(within(table).queryByText("Casey Nguyen")).not.toBeInTheDocument();
  });

  it("allows instructors to view and edit session notes with authentic PATCH call", async () => {
    let patchBody: unknown = null;
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/10/") && init?.method === "PATCH") {
        patchBody = JSON.parse(init.body as string);
        return jsonResponse(200, {
          ...testSession,
          notes: "Updated session notes with important instructions.",
        });
      }
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, testSession);
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/outcomes/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });

    // Existing notes displayed
    expect(screen.getByText("Please arrive 15 minutes before the start time.")).toBeVisible();

    // Click Edit notes
    await user.click(screen.getByTestId("gsd-edit-notes-btn"));

    const textarea = screen.getByTestId("gsd-notes-textarea");
    await user.clear(textarea);
    await user.type(textarea, "Updated session notes with important instructions.");

    await user.click(screen.getByTestId("gsd-save-notes-btn"));

    await waitFor(() => {
      expect(patchBody).toEqual({ notes: "Updated session notes with important instructions." });
    });

    // Notes updated on screen
    expect(await screen.findByText("Updated session notes with important instructions.")).toBeVisible();
  });

  it("handles session transition to LOCKED via Session actions dropdown", async () => {
    let patchBody: unknown = null;
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/10/") && init?.method === "PATCH") {
        patchBody = JSON.parse(init.body as string);
        return jsonResponse(200, {
          ...testSession,
          status: "LOCKED",
          status_display: "Locked",
        });
      }
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, testSession);
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/outcomes/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });

    // Open actions menu
    await user.click(screen.getByTestId("gsd-actions-btn"));

    // Click "Lock session"
    await user.click(screen.getByRole("menuitem", { name: "Lock session" }));

    // Confirm dialog
    expect(screen.getByText("Lock Grading Session")).toBeVisible();
    await user.click(screen.getByTestId("gsd-modal-confirm-btn"));

    await waitFor(() => {
      expect(patchBody).toEqual({ status: "LOCKED" });
    });

    expect(await screen.findByText("Locked", { selector: ".gsd-status-pill" })).toBeVisible();
  });

  it("renders clean zero-candidate empty state when session has no registered candidates", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, testSession);
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/outcomes/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });

    expect(screen.getByTestId("gsd-empty-roster")).toBeVisible();
    expect(screen.getByText("No candidates registered in this grading session yet.")).toBeVisible();
  });
});

