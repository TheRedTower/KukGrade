import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { setClubTimeZone, todayIsoDate } from "./dates";
import type {
  AuthUser,
} from "./api";
import {
  authUser,
  ADMINISTRATOR_CAPABILITIES,
  fetchSignedInAs,
  jsonResponse,
  signedInResponse,
  ABOUT,
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
      within(screen.getByRole("complementary", { name: "Sidebar" })).getByRole("img", {
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

describe("The sidebar", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
    document.cookie = "csrftoken=test-csrf-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setClubTimeZone(undefined);
    window.localStorage.clear();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  function stubSite(user: AuthUser = authUser) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) =>
        url.includes("/api/site/")
          ? jsonResponse(200, { club_name: "Kuk Sool Won Testville", time_zone: "Europe/London" })
          : signedInResponse(url, user),
      ),
    );
  }

  it("takes the brand to the dashboard from any page", async () => {
    window.history.replaceState({}, "", "/students");
    vi.stubGlobal("fetch", fetchSignedInAs(authUser));
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("link", { name: "KukGrade, go to the dashboard" }));
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeVisible();
    expect(window.location.pathname).toBe("/");
  });

  it("names the club and the signed-in person", async () => {
    stubSite();

    render(<App />);

    expect(await screen.findByText("Kuk Sool Won Testville")).toBeVisible();
    expect(screen.getByText("CI")).toBeVisible();
    expect(screen.getByText("Casey Instructor")).toBeVisible();
    expect(screen.getByRole("link", { name: "Casey Instructor, Instructor: your account" })).toHaveAttribute(
      "href",
      "/settings/account",
    );
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("links the version to About and the project to GitHub in a new tab", async () => {
    stubSite();

    render(<App />);

    expect(await screen.findByRole("link", { name: "KukGrade 0.2.0" })).toHaveAttribute(
      "href",
      "/settings/about",
    );
    const github = screen.getByRole("link", { name: /^GitHub/ });
    expect(github).toHaveAttribute("href", ABOUT.repository_url);
    expect(github).toHaveAttribute("target", "_blank");
    expect(github).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("collapses to a strip of icons that keeps every name, and remembers it", async () => {
    stubSite();
    const user = userEvent.setup();

    const { unmount } = render(<App />);
    await screen.findByText("Casey Instructor");
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "Students" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "About KukGrade, version 0.2.0" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /KukGrade on GitHub/ })).toHaveAttribute("target", "_blank");
    expect(screen.queryByText("Casey Instructor")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("kukgrade-sidebar")).toBe("icons");

    // A reload comes back as a strip; expanding brings the person's card back.
    unmount();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
    expect(window.localStorage.getItem("kukgrade-sidebar")).toBeNull();
  });

  it("loads the club time zone before rendering a collapsed sidebar", async () => {
    window.localStorage.setItem("kukgrade-sidebar", "icons");
    setClubTimeZone(undefined);
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url.includes("/api/site/")
        ? jsonResponse(200, { club_name: "Test club", time_zone: "Pacific/Auckland" })
        : signedInResponse(url, authUser),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Overview" });
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/site/"))).toBe(true);
    expect(todayIsoDate(new Date("2026-10-21T12:30:00Z"))).toBe("2026-10-22");
  });

  it("folds behind a Menu button on a phone, and never collapses there", async () => {
    stubSite();
    const real = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...real(query),
      matches: query.includes("max-width: 56rem"),
    })) as typeof window.matchMedia;
    window.localStorage.setItem("kukgrade-sidebar", "icons");
    const user = userEvent.setup();

    try {
      render(<App />);

      const menu = await screen.findByRole("button", { name: "Menu" });
      expect(menu).toHaveAttribute("aria-expanded", "false");
      await user.click(menu);
      expect(menu).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("Casey Instructor")).toBeVisible();
      expect(screen.queryByRole("button", { name: /sidebar/ })).not.toBeInTheDocument();
      // Choosing a page closes the menu again.
      await user.click(screen.getByRole("link", { name: "Students" }));
      expect(await screen.findByRole("heading", { name: "Students" })).toBeVisible();
      expect(menu).toHaveAttribute("aria-expanded", "false");
      // Choosing a page closes the menu again.
      await user.click(screen.getByRole("link", { name: "Students" }));
      expect(await screen.findByRole("heading", { name: "Students" })).toBeVisible();
      expect(menu).toHaveAttribute("aria-expanded", "false");
    } finally {
      window.matchMedia = real;
    }
  });
});
