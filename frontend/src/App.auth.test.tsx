import { onlineManager } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type {
  AuthUser,
} from "./api";
import {
  authUser,
  jsonResponse,
  emptyResponse,
  authRequiredResponse,
} from "./appTestSupport";

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

  it("returns to sign-in when a screen's request finds the session has ended", async () => {
    window.history.replaceState({}, "", "/students");
    // Signed in when the app loads; the session then expires, so the
    // students request is the first to hear it.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) =>
        url.includes("/api/auth/me/") ? jsonResponse(200, authUser) : authRequiredResponse(),
      ),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeVisible();
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

  it("never shows one account's data to the next person on this browser", async () => {
    window.history.replaceState({}, "", "/students");
    const dana = {
      ...authUser,
      id: "1a0e2f3c-1111-4222-8333-444455556666",
      email: "dana@example.com",
      first_name: "Dana",
      last_name: "Instructor",
      full_name: "Dana Instructor",
    } satisfies AuthUser;

    // Casey's roster request is still in flight when Casey signs out. Without
    // cancellation it resolves into the emptied cache, and Dana is shown
    // Casey's students on arrival.
    let releaseCaseyRoster: (response: Response) => void = () => {};
    const caseyRosterInFlight = new Promise<Response>((resolve) => {
      releaseCaseyRoster = resolve;
    });
    const rosterOf = (name: string) =>
      jsonResponse(200, {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: 1,
            wksa_id: "UK-1001",
            first_name: name,
            last_name: "Student",
            current_rank: 1,
            current_rank_code: "W",
            current_rank_name: "White Belt",
            status: "ACTIVE",
            status_display: "Active",
            can_be_graded: true,
            age_band: "AGE_18_AND_OVER",
            age_band_display: "18+",
          },
        ],
      });

    let signedInAs: AuthUser | null = authUser;
    let rosterRequests = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return signedInAs ? jsonResponse(200, signedInAs) : authRequiredResponse();
      }
      if (url.includes("/api/auth/logout/")) {
        signedInAs = null;
        return emptyResponse(204);
      }
      if (url.includes("/api/auth/login/")) {
        signedInAs = dana;
        return jsonResponse(200, dana);
      }
      if (url.includes("/api/students/")) {
        rosterRequests += 1;
        return rosterRequests === 1 ? caseyRosterInFlight : rosterOf("Dana-Only");
      }
      return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Students" });
    await user.click(
      screen.getByRole("button", { name: "Casey Instructor, Instructor" }),
    );
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { name: "Welcome back" });

    // Casey's roster lands after the cache was cleared.
    releaseCaseyRoster(rosterOf("Casey-Only"));

    await user.type(screen.getByLabelText("Email address"), "dana@example.com");
    await user.type(screen.getByLabelText("Password"), "StrongPass123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByText("Dana Instructor");
    await user.click(screen.getByRole("link", { name: "Students" }));
    await screen.findByRole("heading", { name: "Students" });

    expect(await screen.findByText(/Dana-Only/)).toBeVisible();
    expect(screen.queryByText(/Casey-Only/)).not.toBeInTheDocument();
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

  it.each([
    ["succeeds", () => jsonResponse(200, authUser)],
    ["fails", () => jsonResponse(502, { error: { code: "error", message: "Bad gateway" } })],
  ])(
    "keeps the signed-in screen mounted when the reconnect re-check %s",
    async (_outcome, recheckResponse) => {
      let meCalls = 0;
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/auth/me/")) {
          meCalls += 1;
          if (meCalls === 1) return jsonResponse(200, authUser);
          // A real re-check takes time; the screen must not change meanwhile.
          await new Promise((settle) => setTimeout(settle, 20));
          return recheckResponse();
        }
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<App />);
      const heading = await screen.findByRole("heading", { name: "Overview" });

      // Losing and regaining the network makes TanStack Query refetch.
      act(() => {
        onlineManager.setOnline(false);
        onlineManager.setOnline(true);
      });
      await waitFor(() => expect(meCalls).toBe(2));
      await act(async () => {
        await new Promise((settle) => setTimeout(settle, 50));
      });

      // The same element, not a remounted copy: on-screen state survived.
      expect(heading.isConnected).toBe(true);
      expect(screen.queryByText("Loading KukGrade")).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Can’t reach KukGrade" })).not.toBeInTheDocument();
    },
  );

  it("signs the viewer out when the reconnect re-check says the session has ended", async () => {
    let meCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/auth/me/")) {
          meCalls += 1;
          return meCalls === 1 ? jsonResponse(200, authUser) : authRequiredResponse();
        }
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }),
    );

    render(<App />);
    await screen.findByRole("heading", { name: "Overview" });
    act(() => {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeVisible();
    expect(window.location.pathname).toBe("/login");
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
    expect(screen.getByRole("img", { name: "KukGrade" })).toBeInTheDocument();
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

describe("Mandatory password change", () => {
  const forcedUser = {
    ...authUser,
    must_change_password: true,
  } satisfies AuthUser;

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
    expect(screen.getByRole("img", { name: "KukGrade" })).toBeVisible();

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
