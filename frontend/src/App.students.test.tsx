import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type {
  Rank,
  StudentDetail,
  StudentListItem,
  StudentRankHistory,
} from "./api";
import {
  authUser,
  jsonResponse,
} from "./appTestSupport";

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
      { id: 1, code: "W", name: "White Belt", order: 1, belt_colour: "WHITE", stripe_colour: "", stripe_count: 0, next_rank: 2 },
      { id: 2, code: "YS", name: "Yellow Stripe", order: 2, belt_colour: "WHITE", stripe_colour: "YELLOW", stripe_count: 1, next_rank: 5 },
      { id: 5, code: "B", name: "Blue Belt", order: 5, belt_colour: "BLUE", stripe_colour: "", stripe_count: 0, next_rank: null },
    ] satisfies Rank[];

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
        can_be_graded: true,
        age_band: "AGE_18_AND_OVER",
        age_band_display: "18+",
        current_grading: {
          session: 42,
          session_title: "Spring Grading 2027",
          stage: "AWAITING_DECISION",
          stage_display: "Awaiting final decision",
        },
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
        can_be_graded: true,
        age_band: "AGE_18_AND_OVER",
        age_band_display: "18+",
        current_grading: null,
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
        can_be_graded: false,
        age_band: "AGE_18_AND_OVER",
        age_band_display: "18+",
        current_grading: null,
      },
    ] satisfies StudentListItem[];

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
    // Current grading is the served registration and its stage, linked to
    // the session; a student with none says so.
    expect(tableScope.getByRole("link", { name: "Spring Grading 2027" })).toHaveAttribute(
      "href",
      "/gradings/42",
    );
    expect(tableScope.getByText("Awaiting final decision")).toBeVisible();
    expect(tableScope.getAllByText("Not registered")).toHaveLength(2);
    expect(screen.queryByRole("columnheader", { name: "Next action" })).not.toBeInTheDocument();

    expect(tableScope.getByText("Clark Kent")).toBeVisible();
    expect(tableScope.getByText("UK-1002")).toBeVisible();
    expect(tableScope.getByText("Yellow Stripe")).toBeVisible();
    expect(tableScope.getByText("Inactive")).toBeVisible();
    expect(tableScope.queryByText("Follow up required")).not.toBeInTheDocument();

    expect(tableScope.getByText("Diana Prince")).toBeVisible();
    expect(tableScope.getByText("UK-1003")).toBeVisible();
    expect(tableScope.getByText("Blue Belt")).toBeVisible();
    expect(tableScope.getByText("Left")).toBeVisible();

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
          results: [{ id: 1, code: "W", name: "White Belt", order: 1, belt_colour: "WHITE", stripe_colour: "", stripe_count: 0, next_rank: null } satisfies Rank],
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
            can_be_graded: true,
            age_band: "AGE_18_AND_OVER",
            age_band_display: "18+",
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
    // One request for the typed name, not one per keystroke.
    const searched = fetchMock.mock.calls
      .map(([url]) => new URL(String(url), "http://localhost").searchParams.get("search"))
      .filter((value): value is string => value !== null);
    expect(searched).toEqual(["Nonexistent"]);
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
    { id: 1, code: "W", name: "White Belt", order: 1, belt_colour: "WHITE", stripe_colour: "", stripe_count: 0, next_rank: 2 },
    { id: 2, code: "YS", name: "Yellow Stripe", order: 2, belt_colour: "WHITE", stripe_colour: "YELLOW", stripe_count: 1, next_rank: 5 },
    { id: 5, code: "B", name: "Blue Belt", order: 5, belt_colour: "BLUE", stripe_colour: "", stripe_count: 0, next_rank: null },
  ] satisfies Rank[];

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
    expect(screen.getByText(/It cannot be changed after the record is created\./)).toBeVisible();

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
      if (url.includes("/api/site/")) {
        return jsonResponse(200, {
          club_name: "Test Club",
          password_policy: { min_length: 16, max_length: 64, character_rules: [], checked_on_save: [] },
          wksa_id: {
            school_prefix: "206-2",
            forms: [
              { code: "student", label: "Student ID", pattern: "x", example: "206-2-150" },
              { code: "black_belt", label: "Black belt ID", pattern: "x", example: "A-20819" },
            ],
          },
        });
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
          can_be_graded: true,
          age_band: "AGE_18_AND_OVER",
          age_band_display: "18+",
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
          can_be_graded: true,
          age_band: "AGE_18_AND_OVER",
          age_band_display: "18+",
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
    // The forms come from the server; the ID goes as typed, for it to tidy.
    expect(
      await screen.findByText(
        /A student ID such as 206-2-150, or a black belt ID such as A-20819\./,
      ),
    ).toBeVisible();
    await user.type(screen.getByLabelText(/WKSA ID/i), " a-20819");
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
      wksa_id: " a-20819",
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

    // And the breadcrumb, from the form again
    window.history.pushState({}, "", "/students/new");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(await screen.findByRole("heading", { name: "Add student" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Students" }));
    expect(window.location.pathname).toBe("/students");
  });
});

describe("Student detail screen (/students/:id)", () => {
  const testRanks = [
    { id: 1, code: "W", name: "White Belt", order: 1, belt_colour: "WHITE", stripe_colour: "", stripe_count: 0, next_rank: 2 },
    { id: 2, code: "YS", name: "Yellow Stripe", order: 2, belt_colour: "WHITE", stripe_colour: "YELLOW", stripe_count: 1, next_rank: 3 },
    { id: 3, code: "Y", name: "Yellow Belt", order: 3, belt_colour: "YELLOW", stripe_colour: "", stripe_count: 0, next_rank: null },
  ] satisfies Rank[];

  const testStudent = {
    id: 10,
    wksa_id: "UK-5001",
    first_name: "Alex",
    last_name: "Carter",
    date_of_birth: "2012-04-24",
    current_rank: 2,
    current_rank_name: "Yellow Stripe",
    status: "ACTIVE",
    status_display: "Active",
    age_band_display: "13-17",
    created_at: "2021-01-08T10:00:00Z",
  } satisfies StudentDetail;

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
    expect(screen.getByText("13-17")).toBeVisible();
    // `created_at` is a real timestamp and correctly renders in the reader's
    // own timezone - 10:00Z on the 8th is the 9th at UTC+14. Derived rather
    // than hard-coded so this asserts formatting, not the suite's timezone.
    const createdDay = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date("2021-01-08T10:00:00Z"));
    expect(screen.getByText(createdDay)).toBeVisible();
    // The record's creation date, never presented as when the student joined.
    expect(screen.getByText("Added to KukGrade")).toBeVisible();
    expect(screen.queryByText("Joined")).not.toBeInTheDocument();

    // Grading readiness card: states the status, and claims no requirement
    // KukGrade does not check.
    expect(screen.getByRole("heading", { name: "Grading readiness" })).toBeVisible();
    expect(screen.getByText("Yellow Belt")).toBeVisible();
    expect(screen.getByText("Can be registered")).toBeVisible();
    expect(screen.queryByText(/meets the standard requirements/)).not.toBeInTheDocument();

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
        from_rank_name: "White Belt",
        to_rank_name: "Yellow Stripe",
        session_title: "Winter Grading",
        promoted_at: "2025-12-12T14:30:00Z",
        effective_date: "2025-12-12",
      },
    ] satisfies StudentRankHistory["promotions"];

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
