import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type {
  AgeBand,
  AuthUser,
  BulkCandidateRegistrationResponse,
  GradingCandidate,
  GradingSession,
  Rank,
  StudentListItem,
} from "./api";
import {
  ADMINISTRATOR_CAPABILITIES,
  jsonResponse,
} from "./appTestSupport";

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
    ...ADMINISTRATOR_CAPABILITIES,
    role_display: "Administrator",
    can_make_final_grading_decision: false,
    can_read_audit_log: true,
    can_promote_student: true,
    can_override_locked_session: true,
    can_view_grading_audit_log: false,
    must_change_password: false,
  } satisfies AuthUser;

  const testSession: GradingSession = {
    id: 10,
    title: "Autumn Grading",
    grading_date: "2026-10-15",
    location: "Colchester Dojang",
    status: "DRAFT",
    status_display: "Draft",
    candidate_count: 0,
    completed_assessment_count: 0,
    awaiting_decision_count: 0,
    can_be_deleted: false,
    notes: "",
  };

  const mockRanks: Rank[] = [
    {
      id: 1,
      code: "WHITE",
      name: "White",
      order: 1,
      belt_colour: "WHITE",
      stripe_colour: "",
      stripe_count: 0,
      next_rank: 2,
    },
    {
      id: 2,
      code: "YELLOW_STRIPE",
      name: "Yellow stripe",
      order: 2,
      belt_colour: "WHITE",
      stripe_colour: "YELLOW",
      stripe_count: 1,
      next_rank: 3,
    },
    {
      id: 3,
      code: "YELLOW",
      name: "Yellow",
      order: 3,
      belt_colour: "YELLOW",
      stripe_colour: "",
      stripe_count: 0,
      next_rank: null,
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
      can_be_graded: true,
      status_display: "Active",
      age_band: "AGE_18_AND_OVER",
      age_band_display: "18+",
      current_grading: null,
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
      can_be_graded: true,
      status_display: "Inactive",
      age_band: "AGE_18_AND_OVER",
      age_band_display: "18+",
      current_grading: null,
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
      can_be_graded: true,
      status_display: "Active",
      age_band: "AGE_13_TO_17",
      age_band_display: "13-17",
      current_grading: null,
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
      can_be_graded: false,
      status_display: "Left",
      age_band: "AGE_8_AND_UNDER",
      age_band_display: "8 and under",
      current_grading: null,
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
      can_be_graded: true,
      status_display: "Active",
      age_band: "AGE_18_AND_OVER",
      age_band_display: "18+",
      current_grading: null,
    },
  ];

  const mockExistingCandidate: GradingCandidate = {
    id: 501,
    session: 10,
    student: 105,
    student_display_name: "Eve Existing",
    student_wksa_id: "KG-0105",
    from_rank: 2,
    from_rank_name: "Yellow stripe",
    testing_for_rank: 3,
    testing_for_rank_name: "Yellow",
    age_band_display: "18+",
    status: "REGISTERED",
    withdrawal_reason: "",
    withdrawal_reason_display: "",
    can_be_moved: false,
    can_be_removed: false,
    withdrawal_note: "",
  };

  // A registration as the server returns it, for one of the students above.
  function registeredRow(studentId: number): GradingCandidate {
    const registered = mockStudents.find((s) => s.id === studentId)!;
    return {
      ...mockExistingCandidate,
      id: 600 + studentId,
      student: registered.id,
      student_display_name: `${registered.first_name} ${registered.last_name}`,
      student_wksa_id: registered.wksa_id,
      from_rank: registered.current_rank,
      from_rank_name: registered.current_rank_name,
    };
  }

  beforeEach(() => {
    window.history.replaceState({}, "", "/gradings/10/register");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  const mockAgeBands: AgeBand[] = [
    { code: "AGE_8_AND_UNDER", name: "8 and under", description: "Little Dragon ages 8 and under", programme: "JUNIOR", programme_display: "Junior & Little Dragon" },
    { code: "AGE_9_TO_12", name: "9-12", description: "Junior ages 9-12", programme: "JUNIOR", programme_display: "Junior & Little Dragon" },
    { code: "AGE_13_TO_17", name: "13-17", description: "Youth ages 13-17", programme: "ADULT", programme_display: "Adult & Youth" },
    { code: "AGE_18_AND_OVER", name: "18+", description: "Adult ages 18+", programme: "ADULT", programme_display: "Adult & Youth" },
  ];

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
      if (url.includes("/api/syllabus/age-bands/")) {
        return jsonResponse(200, { count: 4, next: null, previous: null, results: mockAgeBands });
      }
      if (url.includes("/api/ranks/")) {
        return jsonResponse(200, {
          count: mockRanks.length,
          next: null,
          previous: null,
          results: mockRanks,
        });
      }
      if (url.includes("/api/students/")) {
        const params = new URL(url, "http://localhost").searchParams;
        const search = (params.get("search") ?? "").toLowerCase();
        const statuses = params.get("status")?.split(",");
        const results = mockStudents.filter(
          (s) =>
            s.can_be_graded &&
            s.id !== mockExistingCandidate.student &&
            (!search || `${s.first_name} ${s.last_name} ${s.wksa_id}`.toLowerCase().includes(search)) &&
            (!params.get("current_rank") || s.current_rank === Number(params.get("current_rank"))) &&
            (!params.get("age_band") || s.age_band === params.get("age_band")) &&
            (!statuses || statuses.includes(s.status)),
        );
        return jsonResponse(200, { count: results.length, next: null, previous: null, results });
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
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
      screen.getByText(
        "Students who have left, or are still registered for another grading that has not reached its result, are not listed.",
      ),
    ).toBeVisible();

    // Total eligible students: 101 (Alice - White), 102 (Bob - White), 103 (Charlie - Yellow stripe).
    // 104 is LEFT (excluded). 105 is already registered (excluded).
    // Total eligible matching: 3 students
    expect(await screen.findByText("3 students match")).toBeVisible();

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

    expect(await screen.findByText("0 students match")).toBeVisible();
    expect(screen.getByTestId("bgc-empty-filtered")).toHaveTextContent(
      "No eligible students match the selected filters.",
    );
    expect(screen.getByText("No eligible students match the selected filters.", { selector: ".bgc-empty-td" })).toBeVisible();

    // Filter to "13-17" (AGE_13_TO_17) - Charlie Brown (103) matches
    await user.selectOptions(ageSelect, "AGE_13_TO_17");

    expect(await screen.findByText("1 student matches")).toBeVisible();
    expect(screen.getByTestId("bgc-student-row-103")).toHaveTextContent("Charlie Brown");
    expect(screen.queryByTestId("bgc-student-row-101")).not.toBeInTheDocument();

    // Section 2 rank groups reflect the filtered student (Yellow stripe, one adult-programme student)
    expect(screen.getByTestId("bgc-add-group-2")).toBeVisible();
    expect(screen.queryByTestId("bgc-add-group-1")).not.toBeInTheDocument();
    expect(screen.getByText("Junior & Little Dragon 0 | Adult & Youth 1")).toBeVisible();

    // Filter back to "All ages"
    await user.selectOptions(ageSelect, "ALL");
    expect(await screen.findByText("3 students match")).toBeVisible();
    expect(screen.getByTestId("bgc-student-row-101")).toBeVisible();
    expect(screen.getByTestId("bgc-student-row-102")).toBeVisible();
    expect(screen.getByTestId("bgc-student-row-103")).toBeVisible();
  });

  it("asks the server for the eligible students matching the filters instead of downloading the roster", async () => {
    const fetchMock = setupCohortMock();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { name: "Build grading cohort" });
    await screen.findByText("3 students match");

    await user.selectOptions(screen.getByTestId("bgc-age-filter"), "AGE_13_TO_17");
    await user.type(screen.getByPlaceholderText("Search name or WKSA ID"), "Char");
    // Typing is not yet a filter: "Add all" must not act on the stale list.
    expect(screen.getByTestId("bgc-add-all-filtered-btn")).toBeDisabled();
    const studentRequests = () =>
      fetchMock.mock.calls
        .map(([url]) => new URL(String(url), "http://localhost"))
        .filter((url) => url.pathname === "/api/students/");
    await waitFor(() => expect(studentRequests().at(-1)?.searchParams.get("search")).toBe("Char"));

    const requests = fetchMock.mock.calls.map(([url]) => new URL(String(url), "http://localhost"));
    const students = studentRequests();
    expect(students[0].searchParams.get("eligible_for_session")).toBe("10");
    expect(students.at(-1)?.searchParams.get("age_band")).toBe("AGE_13_TO_17");
    expect(students.at(-1)?.searchParams.get("search")).toBe("Char");
    expect(students.some((url) => url.searchParams.get("search") === "C")).toBe(false);
    expect(requests.some((url) => url.pathname === "/api/gradings/candidates/")).toBe(false);
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
    expect(await screen.findByText("1 student matches")).toBeVisible();
    await waitFor(() => expect(screen.getByTestId("bgc-add-all-filtered-btn")).toBeEnabled());

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
          created: [{ candidate: registeredRow(103), assessment: null }],
          errors: {},
        } satisfies BulkCandidateRegistrationResponse);
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("heading", { name: "Build grading cohort" });

    // Search and add Charlie (student 103)
    const searchInput = screen.getByPlaceholderText("Search name or WKSA ID");
    await user.type(searchInput, "Charlie");
    await screen.findByText("1 student matches");
    await waitFor(() => expect(screen.getByTestId("bgc-add-all-filtered-btn")).toBeEnabled());
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
          created: [{ candidate: registeredRow(101), assessment: null }],
          errors: {
            "1": ["Student is already registered for this session."],
          },
        } satisfies BulkCandidateRegistrationResponse);
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

  it("flags a student held by another grading without offering a retry", async () => {
    const heldElsewhere =
      "This student is already registered for 'Summer Grading', which has not reached its " +
      "result yet. A student is registered for one grading at a time; an administrator can " +
      "correct a registration made in error.";
    vi.stubGlobal(
      "fetch",
      setupCohortMock({
        bulkRegisterHandler: () =>
          jsonResponse(200, { created: [], errors: { "0": [heldElsewhere] } }),
      }),
    );
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { name: "Build grading cohort" });
    await user.click(screen.getByTestId("bgc-add-student-101"));
    await user.click(screen.getByTestId("bgc-register-candidates-btn"));

    expect(await screen.findByRole("heading", { name: "Resolve flagged candidates" })).toBeVisible();
    expect(screen.getByText(heldElsewhere)).toBeVisible();
    expect(screen.getByText("Registered for another grading")).toBeVisible();
    expect(screen.queryByText("No retry needed")).not.toBeInTheDocument();
  });
});
