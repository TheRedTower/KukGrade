import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { AuthUser } from "./api";
import {
  ADMINISTRATOR_CAPABILITIES,
  authUser,
  fetchSignedInAs,
  jsonResponse,
  signedInResponse,
} from "./appTestSupport";

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
  window.history.replaceState({}, "", "/settings");
  window.localStorage.clear();
  window.localStorage.setItem("kukgrade-has-signed-in", "true");
  document.cookie = "csrftoken=test-csrf-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});

describe("Settings", () => {
  it("opens on Account, with a tab for each part", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeVisible();
    await waitFor(() => expect(window.location.pathname).toBe("/settings/account"));
    const tabs = screen.getByRole("navigation", { name: "Settings sections" });
    await waitFor(() =>
      expect(within(tabs).getByRole("link", { name: "Account" })).toHaveAttribute("aria-current", "page"),
    );
    expect(within(tabs).getByRole("link", { name: "Appearance" })).toBeVisible();
    expect(within(tabs).getByRole("link", { name: "About" })).toBeVisible();
  });

  it("sends an unknown tab back to Account", async () => {
    window.history.replaceState({}, "", "/settings/nonsense");
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));

    render(<App />);

    await screen.findByRole("heading", { name: "Settings" });
    await waitFor(() => expect(window.location.pathname).toBe("/settings/account"));
  });
});

describe("Settings: Account", () => {
  it("shows the email and says none of the Master capabilities are granted to a standard instructor", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));

    render(<App />);

    expect(await screen.findByText("casey@example.com")).toBeVisible();
    expect(screen.getByText("Capabilities are independent of your role.")).toBeVisible();
    expect(screen.getAllByText("Not granted")).toHaveLength(4);
    expect(screen.queryByText("Granted")).not.toBeInTheDocument();
  });

  it("shows granted capabilities for an Authorised Master", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(masterUser));

    render(<App />);

    await screen.findByText("casey@example.com");
    expect(screen.getByText("Granted")).toBeVisible();
    expect(screen.getAllByText("Not granted")).toHaveLength(3);
  });

  it("shows granted promotion and override for an Administrator", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(adminUser));

    render(<App />);

    await screen.findByText("admin@example.com");
    expect(screen.getAllByText("Granted")).toHaveLength(2);
    expect(screen.getAllByText("Not granted")).toHaveLength(2);
  });

  it("saves your own name, and the sidebar shows it straight away", async () => {
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

    const save = await screen.findByRole("button", { name: "Save name" });
    expect(save).toBeDisabled();
    const lastName = screen.getByLabelText("Last name");
    await user.clear(lastName);
    await user.type(lastName, "  Park ");
    await user.click(save);

    expect(await screen.findByText("Your name is saved.")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Casey Park, Instructor: your account" }),
    ).toBeVisible();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patch?.[0]).toContain("/api/auth/me/");
    expect(JSON.parse(patch?.[1]?.body as string)).toEqual({ first_name: "Casey", last_name: "Park" });
  });

  it("keeps what you typed, with the server's message, when saving the name fails", async () => {
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

    const lastName = await screen.findByLabelText("Last name");
    await user.type(lastName, "x");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Last name is too long.");
    expect(lastName).toHaveValue("Instructorx");
    expect(screen.getByRole("button", { name: "Save name" })).toBeEnabled();
  });

  it("changes your own password, behind the current one", async () => {
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

    await user.click(await screen.findByRole("button", { name: "Change password…" }));
    // A wrong current password is the server's to refuse; the form stays.
    await user.type(screen.getByLabelText("Current password"), "Wrong-Pass-2026!");
    await user.type(screen.getByLabelText("New password"), "Brand-New-Pass-2026!");
    await user.type(screen.getByLabelText("Confirm new password"), "Brand-New-Pass-2026!");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("Current password is incorrect.")).toBeVisible();

    const current = screen.getByLabelText("Current password");
    await user.clear(current);
    await user.type(current, "Current-Pass-2026!");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Your password has been changed.");
    expect(screen.queryByLabelText(/^Current password/)).not.toBeInTheDocument();
    const sent = fetchMock.mock.calls
      .filter(([url]) => String(url).includes("/api/auth/change-password/"))
      .map(([, init]) => JSON.parse(init?.body as string));
    expect(sent.at(-1)).toEqual({
      current_password: "Current-Pass-2026!",
      new_password: "Brand-New-Pass-2026!",
    });
  });

  it("can be cancelled without changing anything", async () => {
    vi.stubGlobal("fetch", fetchMock());
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Change password…" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change password…" })).toBeVisible();

    function fetchMock() {
      return fetchSignedInAs(authUser);
    }
  });

  it("says an error the server raises against no password field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/auth/change-password/")) {
          return jsonResponse(400, {
            error: {
              code: "validation_error",
              message: "This user no longer exists.",
              fields: { user: ["This user no longer exists."] },
            },
          });
        }
        return signedInResponse(url, authUser);
      }),
    );
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Change password…" }));
    await user.type(screen.getByLabelText("Current password"), "Current-Pass-2026!");
    await user.type(screen.getByLabelText("New password"), "Brand-New-Pass-2026!");
    await user.type(screen.getByLabelText("Confirm new password"), "Brand-New-Pass-2026!");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This user no longer exists.");
  });
});

describe("Settings: Appearance", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/settings/appearance");
  });

  it("chooses the theme for this browser", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Settings" });
    await user.click(screen.getByRole("button", { name: "Dark" }));

    expect(window.localStorage.getItem("kukgrade-theme")).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    await user.click(screen.getByRole("button", { name: "System" }));
    expect(window.localStorage.getItem("kukgrade-theme")).toBeNull();
  });

  it("sets whether the sidebar is open or a strip of icons, and the sidebar follows", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));
    const user = userEvent.setup();

    render(<App />);

    const sidebarChoice = within(await screen.findByRole("group", { name: "Sidebar" }));
    expect(sidebarChoice.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "true");
    await user.click(sidebarChoice.getByRole("button", { name: "Icons only" }));

    expect(sidebarChoice.getByRole("button", { name: "Icons only" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    expect(window.localStorage.getItem("kukgrade-sidebar")).toBe("icons");
  });
});

describe("Settings: About", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/settings/about");
  });

  it("shows the version and what to quote when asking for help", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));

    render(<App />);

    const details = within(await screen.findByRole("region", { name: "Version details" }));
    expect(await details.findByText("Europe/London")).toBeVisible();
    expect(details.getByText("5198f1b")).toBeVisible();
    expect(details.getByText("Ready")).toBeVisible();
    expect(details.getAllByText("0.1.0")).toHaveLength(2);
    expect(screen.getByText("To be decided. The terms will appear here, with a link to the full text.")).toBeVisible();
    expect(screen.getByText(/does not look for updates by itself/)).toBeVisible();
  });

  it("links to the source and the issues page, each in a new tab", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));

    render(<App />);

    const links = within(await screen.findByRole("region", { name: "Links" }));
    expect(links.getByRole("link", { name: /Source on GitHub/ })).toHaveAttribute(
      "href",
      "https://github.com/TheRedTower/KukGrade",
    );
    const issues = links.getByRole("link", { name: /Report a problem/ });
    expect(issues).toHaveAttribute("href", "https://github.com/TheRedTower/KukGrade/issues");
    expect(issues).toHaveAttribute("target", "_blank");
    expect(issues).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("copies the details to paste into a request for help", async () => {
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));
    const user = userEvent.setup();

    render(<App />);

    await screen.findByText("Europe/London");
    await user.click(screen.getByRole("button", { name: "Copy details" }));

    expect(await screen.findByText("Copied.")).toBeVisible();
    const copied = await navigator.clipboard.readText();
    expect(copied).toContain("Server: 0.1.0");
    expect(copied).toContain("Commit: 5198f1b");
    expect(copied).toContain("Club time zone: Europe/London");
    expect(copied).toContain("Database: Ready");
  });

  it("says so when the details cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) =>
        url.includes("/api/about/")
          ? jsonResponse(500, { error: { code: "server_error", message: "Server error." } })
          : signedInResponse(url, authUser),
      ),
    );

    render(<App />);

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy details" })).toBeDisabled();
  });
});
