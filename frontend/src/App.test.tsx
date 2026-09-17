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

