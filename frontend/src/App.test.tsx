import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type {
  CandidateAssessment,
  CandidateAssessmentItem,
  CandidateAssessmentItemResult,
  GradingCandidate,
  GradingSession,
  Rank,
  StudentListItem,
} from "./api";

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
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeVisible();
  });

  it("redirects an unauthorised instructor attempting direct URL access to /users", async () => {
    window.history.replaceState({}, "", "/users");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, authUser)));

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
      vi.fn().mockResolvedValue(jsonResponse(200, masterInstructorUser)),
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
    expect(notGrantedBadges).toHaveLength(4);
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
    expect(notGrantedBadges).toHaveLength(3);
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
    expect(screen.getAllByText("Not granted")).toHaveLength(2);
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

    // Errors are announced to assistive tech and associated with their field
    const firstNameError = screen.getByText("First name is required.");
    expect(firstNameError).toHaveAttribute("role", "alert");
    const firstNameInput = screen.getByLabelText(/First name/i);
    expect(firstNameInput).toHaveAttribute("aria-describedby", firstNameError.id);
    expect(firstNameInput).toHaveAttribute("aria-invalid", "true");

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
      if (url.includes("/api/students/10/grading-history/")) {
        return jsonResponse(200, {
          student: 10,
          student_display_name: "Alex Carter (UK-5001)",
          student_wksa_id: "UK-5001",
          items: [
            {
              source: "KUKGRADE",
              record_id: 12,
              date: "2025-12-12",
              cycle_year: 2025,
              cycle_month: 12,
              date_precision: "DAY",
              testing_for_rank_code: "YS",
              testing_for_rank_name: "Yellow Stripe",
              source_testing_for_rank_text: "",
              outcome: "PASS",
              attendance_status: "ATTENDED",
              comments: "Excellent forms and techniques.",
              promotion_id: 101,
            },
          ],
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

    expect(tableScope.getByText("12 Dec 2025")).toBeVisible();
    expect(tableScope.getByText("KukGrade")).toBeVisible();
    expect(tableScope.getByText("Yellow Stripe")).toBeVisible();
    expect(tableScope.getByText("Pass")).toBeVisible();
    expect(tableScope.getByText("Excellent forms and techniques.")).toBeVisible();

    // Rank history timeline
    expect(screen.getByText("Promoted at Winter Grading")).toBeVisible();
    expect(screen.getByText("Initial rank recorded in KukGrade")).toBeVisible();
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
    expect(screen.getByRole("radio", { name: /^Active/i })).toHaveFocus();

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
    expect(changeStatusBtn).toHaveFocus();
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
    expect(screen.getByLabelText(/First name/i)).toHaveFocus();

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
    expect(editBtn).toHaveFocus();
  });

  it("announces edit-student field errors and associates them with their input", async () => {
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
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Alex Carter" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Edit student" }));
    expect(await screen.findByRole("heading", { name: "Edit student record" })).toBeVisible();

    const firstNameInput = screen.getByLabelText(/First name/i);
    await user.clear(firstNameInput);
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const fieldError = await screen.findByText("First name is required.");
    expect(fieldError).toHaveAttribute("role", "alert");
    expect(firstNameInput).toHaveAttribute("aria-describedby", fieldError.id);
    expect(firstNameInput).toHaveAttribute("aria-invalid", "true");
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

  it("allows an instructor to create a grading session", async () => {
    const emptyFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", emptyFetch);
    const user = userEvent.setup();

    render(<App />);

    const createButtons = await screen.findAllByRole("button", { name: /create grading/i });
    await user.click(createButtons[0]);

    expect(await screen.findByRole("heading", { name: "Create grading session" })).toBeVisible();
    expect(window.location.pathname).toBe("/gradings/new");
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

  it("allows deleting a cancelled session with no starts from the sessions list", async () => {
    const cancelledSession = {
      id: 4,
      title: "Cancelled Empty Grading",
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

    const deleteFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/4/") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url.includes("/api/gradings/sessions/") && url.includes("page_size=200")) {
        return jsonResponse(200, {
          count: 1,
          next: null,
          previous: null,
          results: [cancelledSession],
        });
      }
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [cancelledSession] });
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", deleteFetch);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByText("Cancelled Empty Grading")).toBeVisible();

    const deleteBtn = screen.getByRole("button", { name: "Delete session Cancelled Empty Grading" });
    expect(deleteBtn).toBeVisible();
    await user.click(deleteBtn);

    // Modal appears
    expect(await screen.findByRole("heading", { name: "Delete Grading Session" })).toBeVisible();
    expect(screen.getByText(/Are you sure you want to permanently delete/)).toBeVisible();

    // Confirm delete in modal
    const confirmBtn = screen.getByRole("button", { name: "Delete" });
    await user.click(confirmBtn);

    // Verify DELETE fetch call
    const deleteCalls = deleteFetch.mock.calls.filter(([url, init]) =>
      url.includes("/api/gradings/sessions/4/") && init?.method === "DELETE"
    );
    expect(deleteCalls.length).toBe(1);
  });

  it("traps focus in the delete confirmation dialog, defaults to Cancel, and restores focus to the launcher on Escape", async () => {
    const cancelledSession = {
      id: 4,
      title: "Cancelled Empty Grading",
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

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [cancelledSession] });
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

    const deleteBtn = await screen.findByRole("button", { name: "Delete session Cancelled Empty Grading" });
    await user.click(deleteBtn);

    expect(await screen.findByRole("heading", { name: "Delete Grading Session" })).toBeVisible();
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    const confirmBtn = screen.getByRole("button", { name: "Delete" });
    expect(cancelBtn).toHaveFocus();

    await user.tab({ shift: true });
    expect(confirmBtn).toHaveFocus();

    await user.tab();
    expect(cancelBtn).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("heading", { name: "Delete Grading Session" })).not.toBeInTheDocument();
    expect(deleteBtn).toHaveFocus();
  });

  it("keeps the delete confirmation dialog open and ignores Escape while deletion is pending", async () => {
    const cancelledSession = {
      id: 4,
      title: "Cancelled Empty Grading",
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

    let resolveDelete: (() => void) | undefined;
    const deletePending = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/4/") && init?.method === "DELETE") {
        await deletePending;
        return new Response(null, { status: 204 });
      }
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [cancelledSession] });
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

    const deleteBtn = await screen.findByRole("button", { name: "Delete session Cancelled Empty Grading" });
    await user.click(deleteBtn);
    expect(await screen.findByRole("heading", { name: "Delete Grading Session" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("button", { name: "Deleting…" })).toBeDisabled();

    // Escape and backdrop clicks are ignored while the deletion is in flight.
    await user.keyboard("{Escape}");
    expect(screen.getByRole("heading", { name: "Delete Grading Session" })).toBeVisible();

    const backdrop = document.querySelector(".gsd-modal-backdrop");
    expect(backdrop).toBeInTheDocument();
    await user.click(backdrop!);
    expect(screen.getByRole("heading", { name: "Delete Grading Session" })).toBeVisible();

    resolveDelete?.();
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Delete Grading Session" })).not.toBeInTheDocument();
    });
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

  it("renders the creation form for an instructor", async () => {
    const instructorUser = {
      ...adminUser,
      email: "instructor@example.com",
      role: "instructor" as const,
      role_display: "Instructor",
      is_staff: false,
      is_superuser: false,
    };
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, instructorUser);
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Create grading session" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Create draft session" })).toBeEnabled();
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

  function setupStandardMock(
    sessionOverrides = {},
    assessments = testAssessments,
    authenticatedUser: typeof adminUser | (Omit<typeof adminUser, "role"> & { role: string }) = adminUser,
    candidates: GradingCandidate[] = testCandidates,
  ) {
    return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authenticatedUser);
      if (
        url.includes("/api/gradings/candidates/bulk-generate-assessments/") &&
        init?.method === "POST"
      ) {
        return jsonResponse(200, { created: [], errors: {} });
      }
      if (
        url.includes("/api/gradings/assessments/bulk-start/") &&
        init?.method === "POST"
      ) {
        return jsonResponse(200, { started: [testAssessments[2]], errors: {} });
      }
      if (
        url.includes("/api/gradings/candidates/bulk-update-status/") &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(init.body as string) as { candidates: number[] };
        return jsonResponse(200, {
          updated: candidates
            .filter((candidate) => body.candidates.includes(candidate.id))
            .map((candidate) => ({ ...candidate, status: "WITHDRAWN", status_display: "Withdrawn" })),
          errors: {},
        });
      }
      if (
        url.match(/\/api\/gradings\/candidates\/\d+\/withdraw\/$/) &&
        init?.method === "POST"
      ) {
        const candidateId = Number(url.match(/candidates\/(\d+)\//)?.[1]);
        const candidate = candidates.find((item) => item.id === candidateId);
        return jsonResponse(200, {
          ...candidate,
          status: "WITHDRAWN",
          status_display: "Withdrawn",
          withdrawal_reason: "INJURY",
          withdrawal_reason_display: "Injured during grading",
          withdrawal_note: "Unable to continue safely.",
          withdrawn_by: authenticatedUser.id,
          withdrawn_by_email: authenticatedUser.email,
          withdrawn_by_name: authenticatedUser.full_name,
          withdrawn_at: "2026-09-20T11:00:00Z",
        });
      }
      if (url.includes("/api/gradings/sessions/10/") && init?.method === "PATCH") {
        const patchData = JSON.parse(init.body as string);
        return jsonResponse(200, { ...testSession, ...sessionOverrides, ...patchData });
      }
      if (url.includes("/api/gradings/sessions/10/")) {
        return jsonResponse(200, { ...testSession, ...sessionOverrides });
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: candidates.length, next: null, previous: null, results: candidates });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: assessments.length, next: null, previous: null, results: assessments });
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

  it("starts all prepared assessments as an explicit bulk action", async () => {
    const fetchMock = setupStandardMock();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    const startButton = await screen.findByRole("button", {
      name: "Start all prepared (1)",
    });
    await user.click(startButton);

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(([url, init]) =>
        String(url).includes("/api/gradings/assessments/bulk-start/") &&
        (init as RequestInit | undefined)?.method === "POST",
      );
      expect(request).toBeDefined();
      expect(JSON.parse((request?.[1] as RequestInit).body as string)).toEqual({
        assessments: [203],
      });
    });
    expect(await screen.findByText("1 assessment started.")).toBeVisible();
  });

  it("offers bulk preparation when registered candidates have no snapshot", async () => {
    const fetchMock = setupStandardMock({}, testAssessments.slice(0, 2));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByText("Not prepared")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Prepare all (1)" }),
    );

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(([url, init]) =>
        String(url).includes(
          "/api/gradings/candidates/bulk-generate-assessments/",
        ) && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(request).toBeDefined();
      expect(JSON.parse((request?.[1] as RequestInit).body as string)).toEqual({
        candidates: [103],
      });
    });
  });

  it("confirms attendance by marking only selected no-shows", async () => {
    const fetchMock = setupStandardMock();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Confirm attendance" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm attendance" });
    await user.click(within(dialog).getByRole("checkbox", { name: /Alex Carter/ }));
    await user.click(within(dialog).getByRole("checkbox", { name: /Casey Nguyen/ }));
    await user.click(within(dialog).getByRole("button", { name: "Mark selected as no-show" }));

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(([url, init]) =>
        String(url).includes("/api/gradings/candidates/bulk-update-status/") &&
        (init as RequestInit | undefined)?.method === "POST",
      );
      expect(JSON.parse((request?.[1] as RequestInit).body as string)).toEqual({
        candidates: [101, 103],
        status: "WITHDRAWN",
      });
    });
    expect(await screen.findByText("2 candidates marked as no-show.")).toBeVisible();
  });

  it("allows an authorised Master to record a reasoned locked-session withdrawal", async () => {
    const fetchMock = setupStandardMock({ status: "LOCKED", status_display: "Locked" });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    const row = await screen.findByTestId("candidate-row-101");
    await user.click(within(row).getByRole("button", { name: "Withdraw candidate" }));
    const dialog = screen.getByRole("dialog", { name: "Withdraw Alex Carter" });
    await user.selectOptions(within(dialog).getByLabelText("Reason"), "INJURY");
    await user.type(
      within(dialog).getByLabelText(/Additional note/),
      "Unable to continue safely.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Withdraw candidate" }));

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(([url, init]) =>
        String(url).includes("/api/gradings/candidates/101/withdraw/") &&
        (init as RequestInit | undefined)?.method === "POST",
      );
      expect(JSON.parse((request?.[1] as RequestInit).body as string)).toEqual({
        withdrawal_reason: "INJURY",
        withdrawal_note: "Unable to continue safely.",
      });
    });
    expect(
      await screen.findByText("Alex Carter was withdrawn from the locked session."),
    ).toBeVisible();
  });

  it("does not expose locked withdrawal without override authority", async () => {
    const fetchMock = setupStandardMock(
      { status: "LOCKED", status_display: "Locked" },
      testAssessments,
      { ...adminUser, can_override_locked_session: false },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });
    expect(screen.queryByRole("button", { name: "Withdraw candidate" })).not.toBeInTheDocument();
  });

  it("shows the recorded reason for a withdrawn candidate without further actions", async () => {
    const withdrawnCandidates = [
      {
        ...testCandidates[0],
        status: "WITHDRAWN" as const,
        status_display: "Withdrawn",
        withdrawal_reason: "INJURY" as const,
        withdrawal_reason_display: "Injured during grading",
        withdrawal_note: "Unable to continue safely.",
        withdrawn_by: adminUser.id,
        withdrawn_by_email: adminUser.email,
        withdrawn_by_name: adminUser.full_name,
        withdrawn_at: "2026-09-20T11:00:00Z",
      },
      ...testCandidates.slice(1),
    ];
    const fetchMock = setupStandardMock(
      { status: "LOCKED", status_display: "Locked" },
      testAssessments,
      adminUser,
      withdrawnCandidates,
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const row = await screen.findByTestId("candidate-row-101");
    expect(within(row).getByText("Withdrawn")).toBeVisible();
    expect(within(row).getByText("Injured during grading")).toBeVisible();
    expect(within(row).getByText("Unable to continue safely.")).toBeVisible();
    expect(within(row).getByText("No further action")).toBeVisible();
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
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

  it("handles session transition to CANCELLED via Session actions dropdown with cancellation reason", async () => {
    let patchBody: unknown = null;
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/10/") && init?.method === "PATCH") {
        patchBody = JSON.parse(init.body as string);
        return jsonResponse(200, {
          ...testSession,
          status: "CANCELLED",
          status_display: "Cancelled",
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

    // Click "Cancel session"
    await user.click(screen.getByRole("menuitem", { name: "Cancel session" }));

    // Confirm dialog
    expect(screen.getByText("Cancel Grading Session")).toBeVisible();
    const reasonInput = screen.getByLabelText("Cancellation reason (optional)");
    expect(reasonInput).toBeInTheDocument();
    expect(reasonInput).toHaveClass("gsd-modal-textarea");

    await user.type(reasonInput, "Hall booking unavailable due to maintenance.");
    await user.click(screen.getByTestId("gsd-modal-confirm-btn"));

    await waitFor(() => {
      expect(patchBody).toEqual({
        status: "CANCELLED",
        cancellation_reason: "Hall booking unavailable due to maintenance.",
      });
    });

    expect(await screen.findByText("Cancelled", { selector: ".gsd-status-pill" })).toBeVisible();
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

  it("closes the session actions dropdown on outside click and Escape key", async () => {
    const fetchMock = setupStandardMock();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });

    // Open actions menu
    const actionsBtn = screen.getByTestId("gsd-actions-btn");
    await user.click(actionsBtn);
    expect(screen.getByRole("menu")).toBeVisible();

    // Escape closes dropdown
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // Re-open
    await user.click(actionsBtn);
    expect(screen.getByRole("menu")).toBeVisible();

    // Outside click closes dropdown
    await user.click(screen.getByRole("heading", { name: "Autumn Grading" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes confirmation modal on backdrop click and Escape key", async () => {
    const fetchMock = setupStandardMock();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });

    // Open actions menu and click "Lock session"
    await user.click(screen.getByTestId("gsd-actions-btn"));
    await user.click(screen.getByRole("menuitem", { name: "Lock session" }));

    expect(screen.getByText("Lock Grading Session")).toBeVisible();

    // Escape closes modal
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Lock Grading Session")).not.toBeInTheDocument();

    // Open modal again
    await user.click(screen.getByTestId("gsd-actions-btn"));
    await user.click(screen.getByRole("menuitem", { name: "Lock session" }));
    expect(screen.getByText("Lock Grading Session")).toBeVisible();

    // Backdrop click closes modal
    const backdrop = document.querySelector(".gsd-modal-backdrop");
    expect(backdrop).toBeInTheDocument();
    await user.click(backdrop!);
    expect(screen.queryByText("Lock Grading Session")).not.toBeInTheDocument();
  });

  it("traps focus in the lifecycle confirmation modal, defaults to Cancel, and restores focus to the launcher on Escape", async () => {
    const fetchMock = setupStandardMock();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });

    await user.click(screen.getByTestId("gsd-actions-btn"));
    const lockMenuItem = screen.getByRole("menuitem", { name: "Lock session" });
    await user.click(lockMenuItem);

    expect(screen.getByText("Lock Grading Session")).toBeVisible();
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    const confirmBtn = screen.getByTestId("gsd-modal-confirm-btn");
    expect(cancelBtn).toHaveFocus();

    await user.tab({ shift: true });
    expect(confirmBtn).toHaveFocus();

    await user.tab();
    expect(cancelBtn).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("Lock Grading Session")).not.toBeInTheDocument();
    expect(screen.getByTestId("gsd-actions-btn")).toHaveFocus();
  });

  it("keeps the lifecycle confirmation modal open and ignores Escape while the transition is pending", async () => {
    let resolvePatch: (() => void) | undefined;
    const patchPending = new Promise<void>((resolve) => {
      resolvePatch = resolve;
    });

    const fetchMock = setupStandardMock();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/10/") && init?.method === "PATCH") {
        await patchPending;
        return jsonResponse(200, { ...testSession, status: "LOCKED", status_display: "Locked" });
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
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });

    await user.click(screen.getByTestId("gsd-actions-btn"));
    await user.click(screen.getByRole("menuitem", { name: "Lock session" }));
    expect(screen.getByText("Lock Grading Session")).toBeVisible();

    await user.click(screen.getByTestId("gsd-modal-confirm-btn"));
    expect(await screen.findByTestId("gsd-modal-confirm-btn")).toBeDisabled();

    await user.keyboard("{Escape}");
    expect(screen.getByText("Lock Grading Session")).toBeVisible();

    const backdrop = document.querySelector(".gsd-modal-backdrop");
    expect(backdrop).toBeInTheDocument();
    await user.click(backdrop!);
    expect(screen.getByText("Lock Grading Session")).toBeVisible();

    resolvePatch?.();
    await waitFor(() => {
      expect(screen.queryByText("Lock Grading Session")).not.toBeInTheDocument();
    });
  });

  it("allows deleting a cancelled session with no starts from the session actions menu", async () => {
    const fetchMock = setupStandardMock({
      status: "CANCELLED",
      status_display: "Cancelled",
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    const notStartedAssessments = testAssessments.map((a) => ({
      ...a,
      status: "NOT_STARTED" as const,
    }));
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/10/") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url.includes("/api/gradings/sessions/10/")) {
        return jsonResponse(200, { ...testSession, status: "CANCELLED", status_display: "Cancelled" });
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: testCandidates.length, next: null, previous: null, results: testCandidates });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: notStartedAssessments.length, next: null, previous: null, results: notStartedAssessments });
      }
      if (url.includes("/api/gradings/outcomes/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, { count: testStudentsList.length, next: null, previous: null, results: testStudentsList });
      }
      return jsonResponse(404, {});
    });

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });

    // Open actions menu
    await user.click(screen.getByTestId("gsd-actions-btn"));

    // "Delete session" should be visible
    const deleteMenuItem = screen.getByRole("menuitem", { name: "Delete session" });
    expect(deleteMenuItem).toBeVisible();
    await user.click(deleteMenuItem);

    // Modal appears
    expect(await screen.findByText("Delete Grading Session")).toBeVisible();

    // Confirm delete
    const modalConfirmBtn = screen.getByTestId("gsd-modal-confirm-btn");
    await user.click(modalConfirmBtn);

    // Verify DELETE call was sent
    const deleteCalls = fetchMock.mock.calls.filter(([url, init]) =>
      url.includes("/api/gradings/sessions/10/") && init?.method === "DELETE"
    );
    expect(deleteCalls.length).toBe(1);
  });

  it("allows an administrator to delete a cancelled session with recorded assessment work", async () => {
    const fetchMock = setupStandardMock({
      status: "CANCELLED",
      status_display: "Cancelled",
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });
    await user.click(screen.getByTestId("gsd-actions-btn"));

    // testAssessments includes an IN_PROGRESS entry, so this is the guarded
    // case - only an administrator should see the option.
    expect(screen.getByRole("menuitem", { name: "Delete session" })).toBeVisible();
  });

  it("hides delete for an instructor on a cancelled session with recorded assessment work", async () => {
    const instructorUser = { ...authUser, role: "instructor" as const, is_superuser: false };
    const fetchMock = setupStandardMock(
      { status: "CANCELLED", status_display: "Cancelled" },
      testAssessments,
      instructorUser,
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });
    await user.click(screen.getByTestId("gsd-actions-btn"));

    expect(screen.queryByRole("menuitem", { name: "Delete session" })).not.toBeInTheDocument();
  });

  it("opens SCR-021 Instructor Outcome Proposal Drawer, displays candidate context and assessment stats, and submits proposal", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, {
          ...adminUser,
          role: "INSTRUCTOR",
          can_make_final_grading_decision: false,
        });
      }
      if (url.includes("/api/gradings/sessions/10/")) {
        return jsonResponse(200, testSession);
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, {
          count: testCandidates.length,
          next: null,
          previous: null,
          results: testCandidates,
        });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, {
          count: testAssessments.length,
          next: null,
          previous: null,
          results: testAssessments,
        });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 24,
          next: null,
          previous: null,
          results: Array.from({ length: 24 }, (_, i) => ({
            id: 1000 + i,
            item_code: `ITEM-${i}`,
            category: "TECHNIQUE",
            required: true,
            result: "MET",
            requirement_sequence: i,
          })),
        });
      }
      if (url.includes("/api/gradings/candidates/102/create-outcome/") && init?.method === "POST") {
        return jsonResponse(201, {
          ...testOutcomes[0],
          id: 401,
          status: "DRAFT",
          proposed_outcome: null,
          proposal_notes: "",
        });
      }
      if (url.includes("/api/gradings/outcomes/401/propose/") && init?.method === "PATCH") {
        const body = JSON.parse(init.body as string);
        return jsonResponse(200, {
          ...testOutcomes[0],
          id: 401,
          status: "PROPOSED",
          proposed_outcome: body.proposed_outcome,
          proposal_notes: body.proposal_notes || "",
        });
      }
      if (url.includes("/api/gradings/outcomes/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, {
          count: testStudentsList.length,
          next: null,
          previous: null,
          results: testStudentsList,
        });
      }
      return jsonResponse(404, {});
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });

    // Candidate 102 (Brooke Ellis) has COMPLETED assessment but no outcome -> shows "Propose outcome →"
    const proposeBtn = await screen.findByTestId("propose-outcome-btn-102");
    expect(proposeBtn).toBeVisible();
    expect(proposeBtn).toHaveTextContent("Propose outcome →");

    // Click "Propose outcome →" to open drawer
    await user.click(proposeBtn);

    // Verify drawer is opened
    const drawer = await screen.findByTestId("outcome-proposal-drawer");
    expect(drawer).toBeVisible();

    // Verify candidate context banner
    expect(within(drawer).getByText("Brooke Ellis")).toBeVisible();
    expect(within(drawer).getByText("WKSA: UK-1002")).toBeVisible();
    expect(within(drawer).getByText("Blue")).toBeVisible();
    expect(within(drawer).getByText("Red stripe")).toBeVisible();

    // Verify assessment completion summary
    expect(await within(drawer).findByText("Assessment complete")).toBeVisible();
    expect(within(drawer).getByText(/24 of 24 Required items met \(100%\)/)).toBeVisible();
    expect(within(drawer).getByText("0 Not Met")).toBeVisible();

    // Verify 3-option proposed outcome selector cards
    expect(within(drawer).getByTestId("outcome-option-pass")).toBeVisible();
    expect(within(drawer).getByTestId("outcome-option-conditional")).toBeVisible();
    expect(within(drawer).getByTestId("outcome-option-fail")).toBeVisible();

    // Switch selection to CONDITIONAL
    await user.click(within(drawer).getByTestId("outcome-option-conditional"));
    const conditionalCard = within(drawer).getByTestId("outcome-option-conditional");
    expect(conditionalCard).toHaveClass("is-selected");

    // Enter proposal notes
    const notesTextarea = within(drawer).getByTestId("opd-notes-textarea");
    await user.type(notesTextarea, "Recommend re-testing form 3 within 2 weeks.");

    // Verify informational callout
    expect(within(drawer).getByTestId("opd-callout-info")).toBeVisible();
    expect(within(drawer).getByText("Master review required")).toBeVisible();

    // Submit proposal
    const submitBtn = within(drawer).getByTestId("opd-submit-btn");
    await user.click(submitBtn);

    // Verify create-outcome and propose endpoints were called
    await waitFor(() => {
      const proposeCall = fetchMock.mock.calls.find(([url, init]) =>
        url.includes("/propose/") && init?.method === "PATCH",
      );
      expect(proposeCall).toBeDefined();
      const body = JSON.parse(proposeCall![1]!.body as string);
      expect(body.proposed_outcome).toBe("CONDITIONAL");
      expect(body.proposal_notes).toContain("Recommend re-testing form 3");
    });

    // Drawer closes on success
    await waitFor(() => {
      expect(screen.queryByTestId("outcome-proposal-drawer")).not.toBeInTheDocument();
    });
  });

  it("dismisses SCR-021 Outcome Proposal Drawer on Cancel button and Escape key", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, testSession);
      if (url.includes("/api/gradings/candidates/")) return jsonResponse(200, { count: testCandidates.length, next: null, previous: null, results: testCandidates });
      if (url.includes("/api/gradings/assessments/")) return jsonResponse(200, { count: testAssessments.length, next: null, previous: null, results: testAssessments });
      if (url.includes("/api/gradings/assessment-items/")) return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      if (url.includes("/api/gradings/outcomes/")) return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      if (url.includes("/api/students/")) return jsonResponse(200, { count: testStudentsList.length, next: null, previous: null, results: testStudentsList });
      return jsonResponse(404, {});
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });

    // Open drawer for candidate 102
    const proposeBtn = await screen.findByTestId("propose-outcome-btn-102");
    await user.click(proposeBtn);

    const reopenedDrawer = await screen.findByTestId("outcome-proposal-drawer");
    expect(reopenedDrawer).toBeVisible();
    expect(
      reopenedDrawer.querySelector<HTMLInputElement>('input[value="PASS"]'),
    ).toHaveFocus();

    // Dismiss via Cancel button
    const cancelBtn = screen.getByTestId("opd-cancel-btn");
    await user.click(cancelBtn);

    expect(screen.queryByTestId("outcome-proposal-drawer")).not.toBeInTheDocument();

    // Open drawer again and dismiss via Escape key
    await user.click(proposeBtn);
    expect(await screen.findByTestId("outcome-proposal-drawer")).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("outcome-proposal-drawer")).not.toBeInTheDocument();
    expect(proposeBtn).toHaveFocus();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Build Grading Cohort & Bulk Candidate Registration (/gradings/:id/register)
// ══════════════════════════════════════════════════════════════════════════════
describe("Build Grading Cohort & Bulk Candidate Registration (/gradings/:id/register)", () => {
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

  const testSession: GradingSession = {
    id: 10,
    title: "Autumn Grading",
    grading_date: "2026-10-15",
    location: "Colchester Dojang",
    status: "DRAFT",
    status_display: "Draft",
    notes: "",
    cancellation_reason: "",
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    created_by: "7d3c55f4-e9e7-4b2b-b5d0-5fc9e899df17",
    created_by_email: "master.tan@example.com",
  };

  const mockRanks: Rank[] = [
    {
      id: 1,
      code: "WHITE",
      name: "White",
      order: 1,
      category: "COLOURED_BELT",
      category_display: "Coloured belt",
      active: true,
    },
    {
      id: 2,
      code: "YELLOW_STRIPE",
      name: "Yellow stripe",
      order: 2,
      category: "COLOURED_BELT",
      category_display: "Coloured belt",
      active: true,
    },
    {
      id: 3,
      code: "YELLOW",
      name: "Yellow",
      order: 3,
      category: "COLOURED_BELT",
      category_display: "Coloured belt",
      active: true,
    },
  ];

  const mockStudents: StudentListItem[] = [
    {
      id: 101,
      wksa_id: "KG-0101",
      first_name: "Alice",
      last_name: "Smith",
      current_rank: 1,
      current_rank_code: "WHITE",
      current_rank_name: "White",
      status: "ACTIVE",
      status_display: "Active",
      age_band: "AGE_18_AND_OVER",
      age_band_display: "18+",
    },
    {
      id: 102,
      wksa_id: "KG-0102",
      first_name: "Bob",
      last_name: "Jones",
      current_rank: 1,
      current_rank_code: "WHITE",
      current_rank_name: "White",
      status: "INACTIVE",
      status_display: "Inactive",
      age_band: "AGE_18_AND_OVER",
      age_band_display: "18+",
    },
    {
      id: 103,
      wksa_id: "KG-0103",
      first_name: "Charlie",
      last_name: "Brown",
      current_rank: 2,
      current_rank_code: "YELLOW_STRIPE",
      current_rank_name: "Yellow stripe",
      status: "ACTIVE",
      status_display: "Active",
      age_band: "AGE_13_TO_17",
      age_band_display: "13-17",
    },
    {
      id: 104,
      wksa_id: "KG-0104",
      first_name: "David",
      last_name: "Left",
      current_rank: 1,
      current_rank_code: "WHITE",
      current_rank_name: "White",
      status: "LEFT",
      status_display: "Left",
      age_band: "AGE_8_AND_UNDER",
      age_band_display: "8 and under",
    },
    {
      id: 105,
      wksa_id: "KG-0105",
      first_name: "Eve",
      last_name: "Existing",
      current_rank: 2,
      current_rank_code: "YELLOW_STRIPE",
      current_rank_name: "Yellow stripe",
      status: "ACTIVE",
      status_display: "Active",
      age_band: "AGE_18_AND_OVER",
      age_band_display: "18+",
    },
  ];

  const mockExistingCandidate: GradingCandidate = {
    id: 501,
    session: 10,
    session_title: "Autumn Grading",
    student: 105,
    student_display_name: "Eve Existing",
    student_wksa_id: "KG-0105",
    testing_for_rank: 3,
    testing_for_rank_code: "YELLOW",
    testing_for_rank_name: "Yellow",
    age_band: "18+",
    age_band_display: "18+",
    status: "REGISTERED",
    status_display: "Registered",
    notes: "",
    created_at: "2026-09-02T10:00:00Z",
    updated_at: "2026-09-02T10:00:00Z",
  };

  beforeEach(() => {
    window.history.replaceState({}, "", "/gradings/10/register");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  function setupCohortMock(options?: {
    bulkRegisterHandler?: (body: unknown) => Response;
  }) {
    return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/candidates/bulk-register/") && init?.method === "POST") {
        if (options?.bulkRegisterHandler) {
          return options.bulkRegisterHandler(JSON.parse(init.body as string));
        }
        return jsonResponse(200, { created: [], errors: {} });
      }
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, testSession);
      if (url.includes("/api/ranks/")) {
        return jsonResponse(200, {
          count: mockRanks.length,
          next: null,
          previous: null,
          results: mockRanks,
        });
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, {
          count: mockStudents.length,
          next: null,
          previous: null,
          results: mockStudents,
        });
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, {
          count: 1,
          next: null,
          previous: null,
          results: [mockExistingCandidate],
        });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/outcomes/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse(404, {});
    });
  }

  it("renders cohort builder workspace layout, session info, and eligible rank groups", async () => {
    vi.stubGlobal("fetch", setupCohortMock());

    render(<App />);

    // Header and Session info
    expect(await screen.findByRole("heading", { name: "Build grading cohort" })).toBeVisible();
    expect(screen.getByText("Add whole groups, then review any exceptions.")).toBeVisible();
    expect(screen.getByText("Autumn Grading", { selector: ".bgc-session-title" })).toBeVisible();

    // Section 1: Find eligible students
    expect(screen.getByRole("heading", { name: "1. Find eligible students" })).toBeVisible();
    expect(
      screen.getByText("Students with Left status are excluded (not eligible for grading)."),
    ).toBeVisible();

    // Total eligible students: 101 (Alice - White), 102 (Bob - White), 103 (Charlie - Yellow stripe).
    // 104 is LEFT (excluded). 105 is already registered (excluded).
    // Total eligible matching: 3 students
    expect(screen.getByText("3 students match")).toBeVisible();

    // Section 2: Add whole rank groups
    expect(screen.getByRole("heading", { name: "2. Add whole rank groups" })).toBeVisible();
    expect(screen.getByTestId("bgc-add-group-1")).toBeVisible();
    expect(screen.getByTestId("bgc-add-group-2")).toBeVisible();

    // White group: destination rank is Yellow stripe, 2 eligible (1 active, 1 inactive)
    expect(screen.getAllByText(/1 active/)).toHaveLength(2);
    expect(screen.getByText("1 inactive")).toBeVisible();

    // Right tray: 0 selected initially
    expect(screen.getByTestId("bgc-cohort-count")).toHaveTextContent("0 candidates selected");
    expect(screen.getByTestId("bgc-register-candidates-btn")).toBeDisabled();
  });

  it("adds whole rank groups to cohort and updates selected count and progression", async () => {
    vi.stubGlobal("fetch", setupCohortMock());
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Build grading cohort" });

    // Click "Add all 2" on White rank group
    await user.click(screen.getByTestId("bgc-add-group-1"));

    // Right tray should update to 2 candidates selected
    expect(screen.getByTestId("bgc-cohort-count")).toHaveTextContent("2 candidates selected");

    // The register button updates and becomes enabled
    const registerBtn = screen.getByTestId("bgc-register-candidates-btn");
    expect(registerBtn).toHaveTextContent("Register 2 candidates");
    expect(registerBtn).toBeEnabled();

    // Left table White group button and individual student rows should now show "Added ✓"
    expect(screen.getByTestId("bgc-group-added-1")).toHaveTextContent("Added ✓");
    expect(screen.getByTestId("bgc-student-added-101")).toHaveTextContent("Added ✓");
    expect(screen.getByTestId("bgc-student-added-102")).toHaveTextContent("Added ✓");
  });

  it("renders matching eligible students table with details and individual add/remove buttons", async () => {
    vi.stubGlobal("fetch", setupCohortMock());
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Build grading cohort" });

    // Matching students table is visible with all 3 eligible students
    expect(screen.getByTestId("bgc-filtered-students-table")).toBeVisible();
    expect(screen.getByTestId("bgc-student-row-101")).toBeVisible();
    expect(screen.getByTestId("bgc-student-row-102")).toBeVisible();
    expect(screen.getByTestId("bgc-student-row-103")).toBeVisible();

    // Alice Smith details
    const aliceRow = screen.getByTestId("bgc-student-row-101");
    expect(aliceRow).toHaveTextContent("Alice Smith");
    expect(aliceRow).toHaveTextContent("KG-0101");
    expect(aliceRow).toHaveTextContent("White");
    expect(aliceRow).toHaveTextContent("Yellow stripe");
    expect(aliceRow).toHaveTextContent("18+");
    expect(aliceRow).toHaveTextContent("Active");

    // Click individual "+ Add" button for Alice
    await user.click(screen.getByTestId("bgc-add-student-101"));

    // Right tray updates to 1 candidate selected
    expect(screen.getByTestId("bgc-cohort-count")).toHaveTextContent("1 candidate selected");
    expect(screen.getByTestId("bgc-student-added-101")).toHaveTextContent("Added ✓");

    // Click "Added ✓" on Alice to remove her
    await user.click(screen.getByTestId("bgc-student-added-101"));
    expect(screen.getByTestId("bgc-cohort-count")).toHaveTextContent("0 candidates selected");
    expect(screen.getByTestId("bgc-add-student-101")).toHaveTextContent("+ Add");
  });

  it("filters eligible students by age group and updates matching student records and rank groups", async () => {
    vi.stubGlobal("fetch", setupCohortMock());
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Build grading cohort" });

    const ageSelect = screen.getByTestId("bgc-age-filter");

    // Filter to "8 and under" (AGE_8_AND_UNDER) - no active/eligible students match
    await user.selectOptions(ageSelect, "AGE_8_AND_UNDER");

    expect(screen.getByText("0 students match")).toBeVisible();
    expect(screen.getByTestId("bgc-empty-filtered")).toHaveTextContent(
      "No eligible students match the selected filters.",
    );
    expect(screen.getByText("No eligible students match the selected filters.", { selector: ".bgc-empty-td" })).toBeVisible();

    // Filter to "13-17" (AGE_13_TO_17) - Charlie Brown (103) matches
    await user.selectOptions(ageSelect, "AGE_13_TO_17");

    expect(screen.getByText("1 student matches")).toBeVisible();
    expect(screen.getByTestId("bgc-student-row-103")).toHaveTextContent("Charlie Brown");
    expect(screen.queryByTestId("bgc-student-row-101")).not.toBeInTheDocument();

    // Section 2 rank groups reflect the filtered student (Yellow stripe, Kids 0 | Adults 1)
    expect(screen.getByTestId("bgc-add-group-2")).toBeVisible();
    expect(screen.queryByTestId("bgc-add-group-1")).not.toBeInTheDocument();
    expect(screen.getByText("Kids 0 | Adults 1")).toBeVisible();

    // Filter back to "All ages"
    await user.selectOptions(ageSelect, "ALL");
    expect(screen.getByText("3 students match")).toBeVisible();
    expect(screen.getByTestId("bgc-student-row-101")).toBeVisible();
    expect(screen.getByTestId("bgc-student-row-102")).toBeVisible();
    expect(screen.getByTestId("bgc-student-row-103")).toBeVisible();
  });

  it("filters eligible students and adds filtered students to cohort", async () => {
    vi.stubGlobal("fetch", setupCohortMock());
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Build grading cohort" });

    // Search for "Charlie"
    const searchInput = screen.getByPlaceholderText("Search name or WKSA ID");
    await user.type(searchInput, "Charlie");

    // Matching count should now be 1 student
    expect(screen.getByText("1 student matches")).toBeVisible();

    // Click "Add all 1 filtered students"
    await user.click(screen.getByTestId("bgc-add-all-filtered-btn"));

    // Cohort tray updates to 1 candidate selected
    expect(screen.getByTestId("bgc-cohort-count")).toHaveTextContent("1 candidate selected");
    expect(screen.getByTestId("bgc-register-candidates-btn")).toHaveTextContent("Register 1 candidate");
  });

  it("opens review exceptions modal and allows removing an individual candidate", async () => {
    vi.stubGlobal("fetch", setupCohortMock());
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Build grading cohort" });

    // Add White rank group (contains Alice and Bob)
    await user.click(screen.getByTestId("bgc-add-group-1"));
    expect(screen.getByTestId("bgc-cohort-count")).toHaveTextContent("2 candidates selected");

    // Click "Review exceptions →"
    const reviewExceptionsButton = screen.getByTestId("bgc-review-exceptions-btn");
    await user.click(reviewExceptionsButton);

    // Modal opens
    expect(screen.getByRole("heading", { name: "Review cohort candidates (2)" })).toBeVisible();
    expect(screen.getByTestId("bgc-modal-done-btn")).toHaveFocus();
    expect(screen.getByText("Alice Smith", { selector: ".bgc-modal-student-name" })).toBeVisible();
    expect(screen.getByText("Bob Jones", { selector: ".bgc-modal-student-name" })).toBeVisible();

    // Remove Bob Jones (student 102)
    await user.click(screen.getByTestId("bgc-remove-student-102"));

    // Click Done
    await user.click(screen.getByTestId("bgc-modal-done-btn"));

    // Cohort count drops to 1
    expect(screen.getByTestId("bgc-cohort-count")).toHaveTextContent("1 candidate selected");
    expect(screen.getByTestId("bgc-register-candidates-btn")).toHaveTextContent("Register 1 candidate");
    expect(reviewExceptionsButton).toHaveFocus();
  });

  it("successfully submits bulk candidate registration and navigates to session detail", async () => {
    let capturedPayload: unknown = null;
    const fetchMock = setupCohortMock({
      bulkRegisterHandler: (body) => {
        capturedPayload = body;
        return jsonResponse(200, {
          created: [
            {
              candidate: {
                id: 601,
                session: 10,
                student: 101,
                student_display_name: "Alice Smith",
                student_wksa_id: "KG-0101",
                testing_for_rank: 2,
                testing_for_rank_name: "Yellow stripe",
                status: "ACTIVE",
                status_display: "Active",
                notes: "",
                registered_at: "2026-09-18T10:00:00Z",
                registered_by: 1,
                registered_by_display_name: "Master L. Tan",
              },
              assessment: {
                id: 701,
                candidate: 601,
                status: "NOT_STARTED",
                status_display: "Not started",
                candidate_student_display_name: "Alice Smith",
                candidate_student_wksa_id: "KG-0101",
                candidate_testing_for_rank_name: "Yellow stripe",
                summary_comments: "",
                positive_observations: "",
                started_at: null,
                completed_at: null,
                created_at: "2026-09-18T10:00:00Z",
                updated_at: "2026-09-18T10:00:00Z",
              },
            },
          ],
          errors: {},
        });
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Build grading cohort" });

    // Search and add Charlie (student 103)
    const searchInput = screen.getByPlaceholderText("Search name or WKSA ID");
    await user.type(searchInput, "Charlie");
    await user.click(screen.getByTestId("bgc-add-all-filtered-btn"));

    // Submit cohort
    await user.click(screen.getByTestId("bgc-register-candidates-btn"));

    await waitFor(() => {
      expect(capturedPayload).toEqual({
        session: 10,
        candidates: [{ student: 103, testing_for_rank: 3 }],
        generate_assessments: true,
      });
    });

    // Navigated to /gradings/10
    expect(window.location.pathname).toBe("/gradings/10");
  });

  it("handles partial registration failure by switching to Exception Resolver (SCR-018)", async () => {
    const fetchMock = setupCohortMock({
      bulkRegisterHandler: () => {
        return jsonResponse(200, {
          created: [
            {
              candidate: {
                id: 601,
                session: 10,
                student: 101,
                student_display_name: "Alice Smith",
                student_wksa_id: "KG-0101",
                testing_for_rank: 2,
                testing_for_rank_name: "Yellow stripe",
                status: "ACTIVE",
                status_display: "Active",
                notes: "",
                registered_at: "2026-09-18T10:00:00Z",
                registered_by: 1,
                registered_by_display_name: "Master L. Tan",
              },
              assessment: null,
            },
          ],
          errors: {
            "1": ["Student is already registered for this session."],
          },
        });
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Build grading cohort" });

    // Add White rank group (contains Alice and Bob)
    await user.click(screen.getByTestId("bgc-add-group-1"));

    // Submit cohort
    await user.click(screen.getByTestId("bgc-register-candidates-btn"));

    // Screen transitions to Exception Resolver (SCR-018)
    expect(await screen.findByRole("heading", { name: "Resolve flagged candidates" })).toBeVisible();
    expect(screen.getByText("1 registered")).toBeVisible();
    expect(screen.getByText("1 flagged")).toBeVisible();
    expect(screen.getByText("1 candidate needs attention")).toBeVisible();

    // Flagged table shows Bob Jones and error message
    expect(screen.getByText("Bob Jones")).toBeVisible();
    expect(screen.getByText("Student is already registered for this session.")).toBeVisible();
    expect(screen.getByText("No retry needed")).toBeVisible();

    // Finish and view session button navigates back
    await user.click(screen.getByTestId("bgc-finish-view-session-btn"));
    expect(window.location.pathname).toBe("/gradings/10");
  });
});

// Candidate Assessment Workspace Screen (/gradings/:sessionId/assessments/:candidateId)
describe("Candidate Assessment Workspace Screen (/gradings/:sessionId/assessments/:candidateId)", () => {
  const mockSession: GradingSession = {
    id: 10,
    title: "Autumn Grading",
    grading_date: "2026-10-15",
    location: "Main Dojang",
    status: "OPEN",
    status_display: "Open",
    notes: "",
    cancellation_reason: "",
    created_by: "7d3c55f4-e9e7-4b2b-b5d0-5fc9e899df17",
    created_by_email: "casey@example.com",
    created_at: "2026-09-18T10:00:00Z",
    updated_at: "2026-09-18T10:00:00Z",
  };

  const mockCandidate: GradingCandidate = {
    id: 101,
    session: 10,
    session_title: "Autumn Grading",
    student: 1,
    student_display_name: "Alex Carter",
    student_wksa_id: "KG-0264",
    testing_for_rank: 2,
    testing_for_rank_code: "YELLOW",
    testing_for_rank_name: "Yellow",
    age_band: "AGE_9_TO_12",
    age_band_display: "Junior (9–12)",
    status: "REGISTERED",
    status_display: "Registered",
    notes: "",
    created_at: "2026-09-18T10:00:00Z",
    updated_at: "2026-09-18T10:00:00Z",
  };

  const mockStudent: StudentListItem = {
    id: 1,
    first_name: "Alex",
    last_name: "Carter",
    wksa_id: "KG-0264",
    current_rank: 1,
    current_rank_code: "YELLOW_STRIPE",
    current_rank_name: "Yellow stripe belt",
    age_band: "AGE_9_TO_12",
    age_band_display: "Junior (9–12)",
    status: "ACTIVE",
    status_display: "Active",
  };

  const mockAssessment: CandidateAssessment = {
    id: 501,
    candidate: 101,
    candidate_student_name: "Alex Carter",
    candidate_student_wksa_id: "KG-0264",
    testing_for_rank_code: "YELLOW",
    testing_for_rank_name: "Yellow",
    age_band: "AGE_9_TO_12",
    age_band_display: "Junior (9–12)",
    status: "IN_PROGRESS",
    status_display: "In progress",
    generated_by: "7d3c55f4-e9e7-4b2b-b5d0-5fc9e899df17",
    generated_by_email: "casey@example.com",
    generated_at: "2026-09-18T10:00:00Z",
    started_at: "2026-09-18T10:05:00Z",
    completed_at: null,
    notes: "",
    item_counts: { total: 3, required: 3, met: 1, not_met: 1, not_assessed: 1 },
    created_at: "2026-09-18T10:00:00Z",
    updated_at: "2026-09-18T10:05:00Z",
  };

  const mockItem1: CandidateAssessmentItem = {
    id: 1001,
    assessment: 501,
    source_requirement: 1,
    source_item: 1,
    source_rank: 2,
    source_age_band: "AGE_9_TO_12",
    item_code: "ETIQUETTE_01",
    item_name: "Etiquette & Bowing",
    korean_name: "예의",
    category: "ETIQUETTE",
    category_display: "Etiquette",
    requirement_sequence: 1,
    required: true,
    start_number: null,
    end_number: null,
    display_range: "",
    requirement_notes: "Proper bow, respect for flags and instructors",
    result: "MET",
    result_display: "Met",
    assessor: "7d3c55f4-e9e7-4b2b-b5d0-5fc9e899df17",
    assessor_email: "casey@example.com",
    assessed_at: "2026-09-18T10:10:00Z",
    assessor_notes: "",
    created_at: "2026-09-18T10:00:00Z",
    updated_at: "2026-09-18T10:10:00Z",
  };

  const mockItem2: CandidateAssessmentItem = {
    id: 1002,
    assessment: 501,
    source_requirement: 2,
    source_item: 2,
    source_rank: 2,
    source_age_band: "AGE_9_TO_12",
    item_code: "KICKING_01",
    item_name: "Ap Cha Gi (Front Kick)",
    korean_name: "앞차기",
    category: "KICKING",
    category_display: "Kicking",
    requirement_sequence: 2,
    required: true,
    start_number: null,
    end_number: null,
    display_range: "",
    requirement_notes: "Full chamber, ball of foot contact",
    result: "NOT_MET",
    result_display: "Not Met",
    assessor: "7d3c55f4-e9e7-4b2b-b5d0-5fc9e899df17",
    assessor_email: "casey@example.com",
    assessed_at: "2026-09-18T10:15:00Z",
    assessor_notes: "Guard dropped on turn",
    created_at: "2026-09-18T10:00:00Z",
    updated_at: "2026-09-18T10:15:00Z",
  };

  const mockItem3: CandidateAssessmentItem = {
    id: 1003,
    assessment: 501,
    source_requirement: 3,
    source_item: 3,
    source_rank: 2,
    source_age_band: "AGE_9_TO_12",
    item_code: "KICKING_02",
    item_name: "Yup Cha Gi (Side Kick)",
    korean_name: "옆차기",
    category: "KICKING",
    category_display: "Kicking",
    requirement_sequence: 3,
    required: true,
    start_number: null,
    end_number: null,
    display_range: "",
    requirement_notes: "Pivot on base foot, blade of foot strike",
    result: "NOT_ASSESSED",
    result_display: "Not Assessed",
    assessor: null,
    assessor_email: "",
    assessed_at: null,
    assessor_notes: "",
    created_at: "2026-09-18T10:00:00Z",
    updated_at: "2026-09-18T10:00:00Z",
  };

  beforeEach(() => {
    window.history.replaceState({}, "", "/gradings/10/assessments/101");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders candidate assessment workspace with dual-pane layout, sub-rail, and items", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/gradings/sessions/10/")) {
        return jsonResponse(200, mockSession);
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockCandidate] });
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockStudent] });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    // Candidate header
    expect(await screen.findByRole("heading", { name: "Alex Carter" })).toBeVisible();
    expect(screen.getByText("KG-0264")).toBeVisible();
    expect(screen.getByText("Junior (9–12)")).toBeVisible();
    expect(screen.getByText("In progress")).toBeVisible();

    // Progress ledger
    expect(screen.getByText("2 / 3")).toBeVisible();
    expect(screen.getByText(/Required items assessed \(67%\)/)).toBeVisible();
    expect(screen.getByText("1 Met")).toBeVisible();
    expect(screen.getByText("1 Not Met")).toBeVisible();
    expect(screen.getByText("1 Not Assessed")).toBeVisible();
    expect(screen.getByText(/Required items assessed/).closest('[role="status"]')).not.toBeNull();

    // Category rail has Etiquette and Kicking
    expect(screen.getByTestId("caw-cat-tab-ETIQUETTE")).toBeVisible();
    expect(screen.getByTestId("caw-cat-tab-KICKING")).toBeVisible();

    // "Complete assessment" button is disabled because 1 required item remains
    const completeBtn = screen.getByTestId("caw-complete-assessment-btn");
    expect(completeBtn).toBeDisabled();
    expect(completeBtn).toHaveTextContent("Complete assessment (1 required remaining)");
  });

  // The completion review is its own route now, so it is reachable by a typed
  // URL rather than only through the scoring screen's gated button. It has to
  // refuse on its own rather than render an incomplete record.
  it("refuses the completion review route while required items remain unassessed", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/gradings/sessions/10/")) {
        return jsonResponse(200, mockSession);
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockCandidate] });
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockStudent] });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.replaceState({}, "", "/gradings/10/assessments/101/review");

    render(<App />);

    expect(await screen.findByTestId("caw-review-unavailable")).toBeVisible();
    expect(screen.getByText(/1 required item remains unassessed/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Review & Complete Assessment" })).toBeNull();
    expect(screen.getByRole("link", { name: /Return to scoring/ })).toHaveAttribute(
      "href",
      "/gradings/10/assessments/101",
    );
  });

  it("updates item evaluation via segmented controls with immediate auto-save", async () => {
    let patchedItemId: number | null = null;
    let patchedBody: Record<string, unknown> | null = null;

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/gradings/sessions/10/")) {
        return jsonResponse(200, mockSession);
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockCandidate] });
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockStudent] });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/1003/") && init?.method === "PATCH") {
        patchedItemId = 1003;
        patchedBody = JSON.parse(String(init?.body));
        return jsonResponse(200, {
          ...mockItem3,
          result: (patchedBody?.result as CandidateAssessmentItemResult) ?? "MET",
          assessor: authUser.id,
          assessor_email: authUser.email,
          assessed_at: "2026-09-18T10:20:00Z",
        });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    // Item 1003 (Yup Cha Gi) is currently NOT_ASSESSED. Click "Met"
    const metBtn = screen.getByTestId("btn-met-1003");
    await user.click(metBtn);

    // Verify PATCH was made
    expect(patchedItemId).toBe(1003);
    expect(patchedBody).toEqual({ result: "MET" });
  });

  it("switches categories via the left sub-rail", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockCandidate] });
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockStudent] });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockAssessment] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    // Click "Etiquette" category tab
    const etiquetteTab = screen.getByTestId("caw-cat-tab-ETIQUETTE");
    await user.click(etiquetteTab);

    // Etiquette item is displayed
    expect(screen.getByText("Etiquette & Bowing")).toBeVisible();
    // Kicking items are not displayed when filtered to Etiquette
    expect(screen.queryByText("Ap Cha Gi (Front Kick)")).not.toBeInTheDocument();

    // Click "Kicking" category tab
    const kickingTab = screen.getByTestId("caw-cat-tab-KICKING");
    await user.click(kickingTab);

    // Kicking items are displayed
    expect(screen.getByText("Ap Cha Gi (Front Kick)")).toBeVisible();
    expect(screen.getByText("Yup Cha Gi (Side Kick)")).toBeVisible();
  });

  it("transitions to Completion Review (SCR-020) and confirms completion", async () => {
    // Assessment with all 3 items assessed (2 Met, 1 Not Met, 0 Not Assessed)
    const completedItemsAssessment: CandidateAssessment = {
      ...mockAssessment,
      item_counts: { total: 3, required: 3, met: 2, not_met: 1, not_assessed: 0 },
    };
    const allAssessedItem3: CandidateAssessmentItem = {
      ...mockItem3,
      result: "MET",
      assessor: authUser.id,
      assessor_email: authUser.email,
      assessed_at: "2026-09-18T10:20:00Z",
    };

    let completedPayload: Record<string, unknown> | null = null;

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockCandidate] });
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockStudent] });
      }
      if (url.includes("/api/gradings/assessments/501/") && init?.method === "PATCH") {
        completedPayload = JSON.parse(String(init?.body));
        return jsonResponse(200, {
          ...completedItemsAssessment,
          status: "COMPLETED",
          status_display: "Completed",
          notes: (completedPayload?.notes as string) ?? "",
          completed_at: "2026-09-18T10:30:00Z",
        });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, {
          count: 1,
          next: null,
          previous: null,
          results: [completedItemsAssessment],
        });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, allAssessedItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Alex Carter" });

    // "Complete assessment" is ready and enabled
    const completeBtn = screen.getByTestId("caw-complete-assessment-btn");
    expect(completeBtn).toBeEnabled();
    expect(completeBtn).toHaveTextContent("Complete assessment →");

    // Click to enter review mode
    await user.click(completeBtn);

    // Review mode renders (SCR-020)
    expect(await screen.findByRole("heading", { name: "Review & Complete Assessment" })).toBeVisible();
    expect(screen.getByText("Evaluation Rollup")).toBeVisible();
    expect(screen.getByText("Category Breakdown")).toBeVisible();
    expect(screen.getByText("Attention: 1 Item Not Met")).toBeVisible();
    expect(screen.getByTestId("flagged-item-1002")).toBeVisible();
    expect(screen.getByText('"Guard dropped on turn"')).toBeVisible();

    // Enter general assessment notes
    const notesInput = screen.getByLabelText("General Assessment Notes");
    await user.type(notesInput, "Strong etiquette and balance, focus on guard discipline during spinning kicks.");

    // Click "Confirm & complete assessment"
    const confirmBtn = screen.getByTestId("confirm-complete-assessment-btn");
    await user.click(confirmBtn);

    // Verify completion payload
    await waitFor(() => {
      expect(completedPayload).toEqual({
        status: "COMPLETED",
        notes: "Strong etiquette and balance, focus on guard discipline during spinning kicks.",
      });
    });

    // Navigates back to session roster
    expect(window.location.pathname).toBe("/gradings/10");
  });

  it("handles NOT_STARTED assessment by offering start button", async () => {
    const notStartedAssessment: CandidateAssessment = {
      ...mockAssessment,
      status: "NOT_STARTED",
      status_display: "Not started",
      started_at: null,
      item_counts: { total: 3, required: 3, met: 0, not_met: 0, not_assessed: 3 },
    };

    let startPayload: Record<string, unknown> | null = null;

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, mockSession);
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockCandidate] });
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [mockStudent] });
      }
      if (url.includes("/api/gradings/assessments/501/") && init?.method === "PATCH") {
        startPayload = JSON.parse(String(init?.body));
        return jsonResponse(200, {
          ...notStartedAssessment,
          status: "IN_PROGRESS",
          status_display: "In progress",
          started_at: "2026-09-18T10:15:00Z",
        });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, {
          count: 1,
          next: null,
          previous: null,
          results: [notStartedAssessment],
        });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [
            { ...mockItem1, result: "NOT_ASSESSED", assessor: null, assessor_email: "", assessed_at: null },
            { ...mockItem2, result: "NOT_ASSESSED", assessor: null, assessor_email: "", assessed_at: null },
            mockItem3,
          ],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    // Prompt banner is displayed
    expect(await screen.findByTestId("caw-not-started-banner")).toBeVisible();
    expect(screen.getByText("Assessment Ready To Begin")).toBeVisible();

    // Start assessment button
    const startBtn = screen.getByTestId("start-assessment-btn");
    await user.click(startBtn);

    expect(startPayload).toEqual({ status: "IN_PROGRESS" });
  });

  it("prepares a missing assessment snapshot before offering start", async () => {
    const draftSession = {
      ...mockSession,
      status: "DRAFT" as const,
      status_display: "Draft",
    };
    const generatedAssessment: CandidateAssessment = {
      ...mockAssessment,
      status: "NOT_STARTED",
      status_display: "Not started",
      started_at: null,
    };
    let generationRequested = false;

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, draftSession);
      if (
        url.includes("/api/gradings/candidates/101/generate-assessment/") &&
        init?.method === "POST"
      ) {
        generationRequested = true;
        return jsonResponse(201, generatedAssessment);
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, {
          count: 1,
          next: null,
          previous: null,
          results: [mockCandidate],
        });
      }
      if (url.includes("/api/students/")) {
        return jsonResponse(200, {
          count: 1,
          next: null,
          previous: null,
          results: [mockStudent],
        });
      }
      if (url.includes("/api/gradings/assessments/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 3,
          next: null,
          previous: null,
          results: [mockItem1, mockItem2, mockItem3],
        });
      }
      return jsonResponse(404, { detail: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByTestId("caw-missing-assessment-banner")).toBeVisible();
    expect(screen.queryByTestId("caw-not-started-banner")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("generate-assessment-btn"));

    await waitFor(() => expect(generationRequested).toBe(true));
    expect(await screen.findByTestId("caw-not-started-banner")).toBeVisible();
  });
});
