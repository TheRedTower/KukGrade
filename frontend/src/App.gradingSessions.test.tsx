import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type {
  AuthUser,
  GradingSession,
} from "./api";
import {
  authUser,
  ADMINISTRATOR_CAPABILITIES,
  jsonResponse,
  sessionsResponse,
} from "./appTestSupport";

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
      candidate_count: 5,
      completed_assessment_count: 3,
      awaiting_decision_count: 1,
      can_be_deleted: false,
      location: "Riverside Dojang",
      notes: "",
    },
    {
      id: 2,
      title: "Summer Grading",
      grading_date: "2026-06-20",
      status: "LOCKED",
      status_display: "Locked",
      candidate_count: 0,
      completed_assessment_count: 0,
      awaiting_decision_count: 0,
      can_be_deleted: false,
      location: "Riverside Dojang",
      notes: "",
    },
    {
      id: 3,
      title: "Spring Grading",
      grading_date: "2026-03-21",
      status: "COMPLETED",
      status_display: "Completed",
      candidate_count: 0,
      completed_assessment_count: 0,
      awaiting_decision_count: 0,
      can_be_deleted: false,
      location: "Riverside Dojang",
      notes: "",
    },
  ] satisfies GradingSession[];

  function makeFetch(sessions: GradingSession[] = testSessions) {
    return vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, authUser);
      }
      if (url.includes("/api/gradings/sessions/")) {
        return sessionsResponse(url, sessions);
      }
      return jsonResponse(404, {});
    });
  }

  it("shows each session's served progress without asking for its candidates", async () => {
    const fetchMock = makeFetch();
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const card = await screen.findByRole("region", { name: "Current grading session" });
    expect(within(card).getByText("3 / 5")).toBeVisible();
    expect(within(card).getByText("Awaiting final decision").previousElementSibling).toHaveTextContent(
      "1",
    );
    const table = await screen.findByRole("table", { name: "Grading sessions" });
    expect(within(table).getByText("3 of 5 complete")).toBeVisible();
    const requested = fetchMock.mock.calls.map(([url]) => String(url));
    expect(requested.some((url) => url.includes("/api/gradings/candidates/"))).toBe(false);
    expect(requested.some((url) => url.includes("/api/gradings/assessments/"))).toBe(false);
  });

  beforeEach(() => {
    window.history.replaceState({}, "", "/gradings");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("offers Delete only on the sessions the server says can be deleted", async () => {
    const sessions = [
      { ...testSessions[1], id: 11, title: "Locked But Deletable", can_be_deleted: true },
      { ...testSessions[2], id: 12, title: "Completed And Kept", can_be_deleted: false },
      {
        ...testSessions[1],
        id: 13,
        title: "Draft Yet Kept",
        status: "DRAFT",
        status_display: "Draft",
        can_be_deleted: false,
      },
    ] satisfies GradingSession[];
    vi.stubGlobal("fetch", makeFetch(sessions));

    render(<App />);

    await screen.findByRole("table", { name: "Grading sessions" });
    expect(screen.getByRole("button", { name: "Delete session Locked But Deletable" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Delete session Completed And Kept/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete session Draft Yet Kept/ })).not.toBeInTheDocument();
  });

  it("takes the years and the current session from their own small requests, not the whole history", async () => {
    const fetchMock = makeFetch([
      ...testSessions,
      { ...testSessions[2], id: 4, title: "Old Grading", grading_date: "2024-03-01" },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const years = await screen.findByRole("combobox", { name: "Year" });
    await waitFor(() =>
      expect(within(years).getAllByRole("option").map((option) => option.textContent)).toEqual([
        "All years",
        "2026",
        "2024",
      ]),
    );
    const card = await screen.findByRole("region", { name: "Current grading session" });
    expect(within(card).getByText("Autumn Grading")).toBeVisible();
    const requested = fetchMock.mock.calls.map(([url]) => String(url));
    expect(requested.some((url) => url.includes("page_size=200"))).toBe(false);
    expect(requested.some((url) => url.includes("status=OPEN") && url.includes("page_size=1"))).toBe(true);
    expect(requested.filter((url) => url.includes("/sessions/years/"))).toHaveLength(1);
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
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
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
      ...ADMINISTRATOR_CAPABILITIES,
      role_display: "Administrator",
    } satisfies AuthUser;
    const emptyAdminFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
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
      candidate_count: 0,
      completed_assessment_count: 0,
      awaiting_decision_count: 0,
      can_be_deleted: false,
      location: "Riverside Dojang",
      notes: "",
    } satisfies GradingSession;

    const filterFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/")) {
        return sessionsResponse(url, [...testSessions, cancelledSession]);
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", filterFetch);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Gradings" });
    expect((await screen.findAllByText("Autumn Grading")).length).toBeGreaterThanOrEqual(1);

    const statusSelect = screen.getByRole("combobox", { name: "Status" });
    await user.selectOptions(statusSelect, "CANCELLED");
    expect(await screen.findByText("Cancelled Test Grading")).toBeVisible();

    // A status nothing has: the screen says so and offers a reset.
    await user.selectOptions(statusSelect, "DRAFT");
    expect(
      await screen.findByText("No grading sessions match the selected filters."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(statusSelect).toHaveValue("ALL");
    expect(await screen.findByText("Summer Grading")).toBeVisible();
  });

  it("allows deleting a cancelled session with no starts from the sessions list", async () => {
    const cancelledSession = {
      id: 4,
      title: "Cancelled Empty Grading",
      grading_date: "2025-09-13",
      status: "CANCELLED",
      status_display: "Cancelled",
      candidate_count: 0,
      completed_assessment_count: 0,
      awaiting_decision_count: 0,
      can_be_deleted: true,
      location: "Riverside Dojang",
      notes: "",
    } satisfies GradingSession;

    const deleteFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/4/") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url.includes("/api/gradings/sessions/")) {
        return sessionsResponse(url, [cancelledSession]);
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
      candidate_count: 0,
      completed_assessment_count: 0,
      awaiting_decision_count: 0,
      can_be_deleted: true,
      location: "Riverside Dojang",
      notes: "",
    } satisfies GradingSession;

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authUser);
      if (url.includes("/api/gradings/sessions/")) {
        return sessionsResponse(url, [cancelledSession]);
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
      candidate_count: 0,
      completed_assessment_count: 0,
      awaiting_decision_count: 0,
      can_be_deleted: true,
      location: "Riverside Dojang",
      notes: "",
    } satisfies GradingSession;

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
        return sessionsResponse(url, [cancelledSession]);
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

    const backdrop = document.querySelector(".dialog-backdrop");
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
    ...ADMINISTRATOR_CAPABILITIES,
    role_display: "Administrator",
    can_make_final_grading_decision: false,
    can_read_audit_log: true,
    can_promote_student: true,
    can_override_locked_session: true,
    can_view_grading_audit_log: false,
    must_change_password: false,
  } satisfies AuthUser;

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
    const instructorUser = { ...authUser, email: "instructor@example.com" } satisfies AuthUser;
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

    expect(within(previewTable).getByText("Saturday, 12 December 2026")).toBeVisible();

    // Type location
    await user.type(screen.getByLabelText(/location/i), "Riverside Dojang");
    expect(within(previewTable).getByText("Riverside Dojang")).toBeVisible();

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

  it("says what the server said when it has no field to put it against", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/") && options?.method === "POST") {
        return jsonResponse(400, {
          error: {
            code: "validation_error",
            message: "Some details need correcting.",
            fields: { non_field_errors: ["A grading is already planned for that day."] },
          },
        });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { name: "Create grading session" });
    await user.type(screen.getByLabelText(/session title/i), "Spring Grading");
    await user.selectOptions(screen.getByRole("combobox", { name: "Grading day" }), "20");
    await user.selectOptions(screen.getByRole("combobox", { name: "Grading month" }), "03");
    await user.selectOptions(screen.getByRole("combobox", { name: "Grading year" }), "2027");
    await user.click(screen.getByRole("button", { name: "Create draft session" }));

    expect(await screen.findByText("A grading is already planned for that day.")).toBeVisible();
  });

  it("successfully creates a grading session and navigates to /gradings", async () => {
    const createdSession = {
      id: 99,
      title: "Spring Grading 2027",
      grading_date: "2027-03-20",
      status: "DRAFT",
      status_display: "Draft",
      candidate_count: 0,
      completed_assessment_count: 0,
      awaiting_decision_count: 0,
      can_be_deleted: false,
      location: "Riverside Central Dojang",
      notes: "High rank candidates expected",
    } satisfies GradingSession;

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
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
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
    await user.type(screen.getByLabelText(/location/i), "Riverside Central Dojang");
    await user.type(screen.getByLabelText(/staff notes/i), "High rank candidates expected");

    await user.click(screen.getByRole("button", { name: "Create draft session" }));

    await waitFor(() => {
      expect(postBody).toEqual({
        title: "Spring Grading 2027",
        grading_date: "2027-03-20",
        location: "Riverside Central Dojang",
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

    // And the breadcrumb, from the form again
    window.history.pushState({}, "", "/gradings/new");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await screen.findByRole("heading", { name: "Create grading session" });
    await user.click(screen.getByRole("button", { name: "Gradings" }));
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
