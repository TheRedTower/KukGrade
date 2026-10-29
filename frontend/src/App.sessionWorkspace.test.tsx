import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type {
  AuthUser,
  CandidateAssessment,
  CandidateAssessmentItem,
  CandidateOutcome,
  GradingCandidate,
  GradingSession,
  StudentListItem,
} from "./api";
import {
  authUser,
  ADMINISTRATOR_CAPABILITIES,
  jsonResponse,
  assessmentSummaryFor,
} from "./appTestSupport";

describe("Grading Session Workspace Screen (/gradings/:id)", () => {
  const adminUser = {
    id: "7d3c55f4-e9e7-4b2b-b5d0-5fc9e899df17",
    email: "admin@example.com",
    first_name: "Alex",
    last_name: "Admin",
    full_name: "Alex Admin",
    ...ADMINISTRATOR_CAPABILITIES,
    role_display: "Administrator",
    // An administrator can never hold final-decision authority (2026-09-16).
    can_make_final_grading_decision: false,
    can_read_audit_log: true,
    can_promote_student: true,
    can_override_locked_session: true,
    can_view_grading_audit_log: false,
    must_change_password: false,
  } satisfies AuthUser;

  const masterUser = {
    ...authUser,
    can_make_final_grading_decision: true,
    can_read_audit_log: true,
  } satisfies AuthUser;

  const testSession = {
    id: 10,
    title: "Autumn Grading",
    grading_date: "2026-09-15",
    status: "OPEN" as const,
    status_display: "Open",
    candidate_count: 0,
    completed_assessment_count: 0,
    awaiting_decision_count: 0,
    can_be_deleted: false,
    location: "Riverside Dojang",
    notes: "Please arrive 15 minutes before the start time.",
  } satisfies GradingSession;

  // Outcomes are created only once a session is locked, so every proposal
  // test runs against this one.
  const lockedSession = {
    ...testSession,
    status: "LOCKED" as const,
    status_display: "Locked",
  } satisfies GradingSession;

  const testCandidates: GradingCandidate[] = [
    {
      id: 101,
      session: 10,
      student: 1,
      student_display_name: "Alex Carter",
      student_wksa_id: "UK-1001",
      from_rank: 2,
      from_rank_name: "Yellow Stripe",
      testing_for_rank: 3,
      testing_for_rank_name: "Yellow",
      age_band_display: "18+",
      status: "REGISTERED" as const,
      withdrawal_reason: "",
      withdrawal_reason_display: "",
      can_be_moved: false,
      can_be_removed: false,
      withdrawal_note: "",
    },
    {
      id: 102,
      session: 10,
      student: 2,
      student_display_name: "Brooke Ellis",
      student_wksa_id: "UK-1002",
      from_rank: 5,
      from_rank_name: "Blue",
      testing_for_rank: 6,
      testing_for_rank_name: "Red stripe",
      age_band_display: "18+",
      status: "REGISTERED" as const,
      withdrawal_reason: "",
      withdrawal_reason_display: "",
      can_be_moved: false,
      can_be_removed: false,
      withdrawal_note: "",
    },
    {
      id: 103,
      session: 10,
      student: 3,
      student_display_name: "Casey Nguyen",
      student_wksa_id: "UK-1003",
      from_rank: 6,
      from_rank_name: "Red stripe",
      testing_for_rank: 7,
      testing_for_rank_name: "Red",
      age_band_display: "18+",
      status: "REGISTERED" as const,
      withdrawal_reason: "",
      withdrawal_reason_display: "",
      can_be_moved: false,
      can_be_removed: false,
      withdrawal_note: "",
    },
  ];

  const testAssessments = [
    {
      id: 201,
      candidate: 101,
      candidate_student_name: "Alex Carter",
      status: "IN_PROGRESS" as const,
      status_display: "In progress",
      generated_by_email: adminUser.email,
      overall: assessmentSummaryFor([]).overall,
      generated_at: "2026-09-15T09:00:00Z",
      started_at: "2026-09-15T09:10:00Z",
      completed_at: null,
      notes: "",
    },
    {
      id: 202,
      candidate: 102,
      candidate_student_name: "Brooke Ellis",
      status: "COMPLETED" as const,
      status_display: "Completed",
      generated_by_email: adminUser.email,
      overall: assessmentSummaryFor([]).overall,
      generated_at: "2026-09-15T09:00:00Z",
      started_at: "2026-09-15T09:10:00Z",
      completed_at: "2026-09-15T10:00:00Z",
      notes: "",
    },
    {
      id: 203,
      candidate: 103,
      candidate_student_name: "Casey Nguyen",
      status: "NOT_STARTED" as const,
      status_display: "Not started",
      generated_by_email: adminUser.email,
      overall: assessmentSummaryFor([]).overall,
      generated_at: "2026-09-15T09:00:00Z",
      started_at: null,
      completed_at: null,
      notes: "",
    },
  ] satisfies CandidateAssessment[];

  const testOutcomes = [
    {
      id: 302,
      candidate: 102,
      status: "PROPOSED" as const,
      proposed_outcome: "PASS" as const,
      proposed_outcome_display: "Pass",
      proposed_by_name: "Alex Admin",
      proposed_at: "2026-09-15T10:05:00Z",
      proposal_notes: "Strong stances throughout.",
      final_outcome: null,
      final_outcome_display: "",
      decided_by_name: "",
      decided_at: null,
      decision_notes: "",
      conditional_requirements: "",
    },
  ] satisfies CandidateOutcome[];

  // A session locks only once every assessment is completed, which also
  // completes its candidate - the state every LOCKED test starts from.
  const completedAssessments = testAssessments.map((item) => ({
    ...item,
    status: "COMPLETED" as const,
    status_display: "Completed",
    started_at: item.started_at ?? "2026-09-15T09:10:00Z",
    completed_at: item.completed_at ?? "2026-09-15T10:00:00Z",
  })) satisfies CandidateAssessment[];
  const lockedCandidates = testCandidates.map((item) => ({
    ...item,
    status: "COMPLETED" as const,
  })) satisfies GradingCandidate[];

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
      can_be_graded: true,
      age_band: "AGE_18_AND_OVER",
      age_band_display: "18+",
      current_grading: null,
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
      can_be_graded: true,
      age_band: "AGE_18_AND_OVER",
      age_band_display: "18+",
      current_grading: null,
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
      can_be_graded: true,
      age_band: "AGE_18_AND_OVER",
      age_band_display: "18+",
      current_grading: null,
    },
  ] satisfies StudentListItem[];

  beforeEach(() => {
    window.history.replaceState({}, "", "/gradings/10");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.setItem("kukgrade-has-signed-in", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  // Defaults follow the session's status: an open session is mid-grading
  // with no outcomes yet; a locked one has every assessment completed and
  // the proposals made so far.
  function setupStandardMock(
    sessionOverrides: Partial<GradingSession> = {},
    assessmentRows?: CandidateAssessment[],
    authenticatedUser: AuthUser = adminUser,
    candidateRows?: GradingCandidate[],
  ) {
    const locked = sessionOverrides.status === "LOCKED";
    const assessments = assessmentRows ?? (locked ? completedAssessments : testAssessments);
    const candidates = candidateRows ?? (locked ? lockedCandidates : testCandidates);
    const outcomes: CandidateOutcome[] = locked ? testOutcomes : [];
    return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, authenticatedUser);
      if (url.includes("/api/gradings/withdrawal-reasons/")) {
        return jsonResponse(200, {
          count: 4,
          next: null,
          previous: null,
          results: [
            { code: "INJURY", name: "Injured during grading", note_required: false },
            { code: "WITHDREW", name: "Withdrew voluntarily", note_required: false },
            { code: "ABSENT", name: "Did not attend", note_required: false },
            { code: "OTHER", name: "Other", note_required: true },
          ],
        });
      }
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
          can_be_moved: false,
          can_be_removed: false,
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
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
        return jsonResponse(200, { count: assessments.length, next: null, previous: null, results: assessments });
      }
      if (url.includes("/api/gradings/outcomes/")) {
        return jsonResponse(200, { count: outcomes.length, next: null, previous: null, results: outcomes });
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
    expect(screen.getByText("Riverside Dojang")).toBeVisible();
    expect(screen.getByText("Open", { selector: ".badge--open" })).toBeVisible();

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
    expect(within(row1).getByText("Yellow Stripe")).toBeVisible();
    expect(within(row1).getByText("Yellow")).toBeVisible();
    expect(within(row1).getByText("In progress")).toBeVisible();
    expect(within(row1).getByText("Continue assessment →")).toBeVisible();

    // Candidate 2: Brooke Ellis
    const row2 = screen.getByTestId("candidate-row-102");
    expect(within(row2).getByText("Brooke Ellis")).toBeVisible();
    expect(within(row2).getByText("Blue")).toBeVisible();
    expect(within(row2).getByText("Red stripe")).toBeVisible();
    expect(within(row2).getByText("Completed")).toBeVisible();
    expect(within(row2).getByText("Not proposed")).toBeVisible();
    expect(within(row2).getByText("View record →")).toBeVisible();

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
    // Alex has started and Brooke has finished: neither can be a no-show.
    expect(within(dialog).queryByRole("checkbox", { name: /Alex Carter/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: /Brooke Ellis/ })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("checkbox", { name: /Casey Nguyen/ }));
    await user.click(within(dialog).getByRole("button", { name: "Mark selected as no-show" }));

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(([url, init]) =>
        String(url).includes("/api/gradings/candidates/bulk-update-status/") &&
        (init as RequestInit | undefined)?.method === "POST",
      );
      expect(JSON.parse((request?.[1] as RequestInit).body as string)).toEqual({
        candidates: [103],
        status: "WITHDRAWN",
        withdrawal_reason: "ABSENT",
      });
    });
    expect(await screen.findByText("1 candidate marked as no-show.")).toBeVisible();
  });

  it("requires a note before an Other withdrawal can be recorded", async () => {
    const fetchMock = setupStandardMock({ status: "LOCKED", status_display: "Locked" });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    const row = await screen.findByTestId("candidate-row-101");
    await user.click(within(row).getByRole("button", { name: "Withdraw candidate" }));
    const dialog = screen.getByRole("dialog", { name: "Withdraw Alex Carter" });
    await user.click(await within(dialog).findByRole("radio", { name: "Other" }));
    const submit = within(dialog).getByRole("button", { name: "Withdraw candidate" });

    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/What happened/), "Family emergency.");
    expect(submit).toBeEnabled();
  });

  it("allows an authorised Master to record a reasoned locked-session withdrawal", async () => {
    const fetchMock = setupStandardMock({ status: "LOCKED", status_display: "Locked" });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);

    const row = await screen.findByTestId("candidate-row-101");
    await user.click(within(row).getByRole("button", { name: "Withdraw candidate" }));
    const dialog = screen.getByRole("dialog", { name: "Withdraw Alex Carter" });
    await user.click(await within(dialog).findByRole("radio", { name: "Injured during grading" }));
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
      undefined,
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
        ...lockedCandidates[0],
        status: "WITHDRAWN" as const,
        withdrawal_reason: "INJURY" as const,
        withdrawal_reason_display: "Injured during grading",
        can_be_moved: false,
        can_be_removed: false,
        withdrawal_note: "Unable to continue safely.",
      },
      ...lockedCandidates.slice(1),
    ] satisfies GradingCandidate[];
    const fetchMock = setupStandardMock(
      { status: "LOCKED", status_display: "Locked" },
      undefined,
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

  it("shows a locked session's proposals and the decision a Master can review", async () => {
    vi.stubGlobal(
      "fetch",
      setupStandardMock({ status: "LOCKED", status_display: "Locked" }, undefined, masterUser),
    );

    render(<App />);

    const proposed = await screen.findByTestId("candidate-row-102");
    expect(within(proposed).getByText("Proposed: Pass")).toBeVisible();
    expect(within(proposed).getByRole("link", { name: "Review decision →" })).toHaveAttribute(
      "href",
      "/gradings/10/decisions?candidate=102",
    );
    expect(screen.getByTestId("propose-outcome-btn-101")).toHaveTextContent("Propose outcome →");
  });

  it("points the awaiting-decision banner at the served count and the decisions board", async () => {
    vi.stubGlobal(
      "fetch",
      setupStandardMock({
        status: "LOCKED",
        status_display: "Locked",
        awaiting_decision_count: 3,
      }),
    );

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });
    // The server's number, not a recount of proposals on this screen.
    expect(screen.getByText("3 candidates awaiting final decision")).toBeVisible();
    expect(screen.getByTestId("gsd-review-decisions-btn")).toHaveAttribute(
      "href",
      "/gradings/10/decisions",
    );
  });

  it("shows no awaiting-decision banner before the session is locked", async () => {
    vi.stubGlobal("fetch", setupStandardMock({ awaiting_decision_count: 1 }));

    render(<App />);

    await screen.findByRole("heading", { name: "Autumn Grading" });
    expect(screen.queryByText(/awaiting final decision/)).not.toBeInTheDocument();
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
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
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
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
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

    expect(await screen.findByText("Locked", { selector: ".badge--locked" })).toBeVisible();
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
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
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

    expect(await screen.findByText("Cancelled", { selector: ".badge--cancelled" })).toBeVisible();
  });

  it("renders clean zero-candidate empty state when session has no registered candidates", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, testSession);
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
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
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
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
      can_be_deleted: true,
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
        return jsonResponse(200, {
          ...testSession,
          status: "CANCELLED",
          status_display: "Cancelled",
          can_be_deleted: true,
        });
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, { count: testCandidates.length, next: null, previous: null, results: testCandidates });
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
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
      can_be_deleted: true,
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

  it("offers delete and the session's audit events exactly as the server and grants allow", async () => {
    const fetchMock = setupStandardMock({ can_be_deleted: true });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { name: "Autumn Grading" });
    await user.click(screen.getByTestId("gsd-actions-btn"));

    // An open session an administrator may delete: offered, whatever the status.
    expect(screen.getByRole("menuitem", { name: "Delete session" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "View audit events" })).toHaveAttribute(
      "href",
      "/audit?entity_type=GradingSession&entity_id=10",
    );
  });

  it("hides the audit link from a user who cannot read the audit log", async () => {
    vi.stubGlobal(
      "fetch",
      setupStandardMock({}, testAssessments, { ...adminUser, can_read_audit_log: false }),
    );
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { name: "Autumn Grading" });
    await user.click(screen.getByTestId("gsd-actions-btn"));

    expect(screen.queryByRole("menuitem", { name: "View audit events" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete session" })).not.toBeInTheDocument();
  });

  it("requires a reason before a locked session can be cancelled", async () => {
    vi.stubGlobal("fetch", setupStandardMock({ status: "LOCKED", status_display: "Locked" }));
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { name: "Autumn Grading" });
    await user.click(screen.getByTestId("gsd-actions-btn"));
    await user.click(screen.getByRole("menuitem", { name: "Cancel session" }));

    const confirm = screen.getByTestId("gsd-modal-confirm-btn");
    expect(screen.getByLabelText("Cancellation reason (required)")).toBeVisible();
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("Cancellation reason (required)"), "Hall flooded.");
    expect(confirm).toBeEnabled();
  });

  it("hides delete for an instructor on a cancelled session with recorded assessment work", async () => {
    const instructorUser: AuthUser = authUser;
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

  it("offers no proposal while the session is open, only the completed record", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, testSession);
      if (url.includes("/api/gradings/candidates/")) return jsonResponse(200, { count: testCandidates.length, next: null, previous: null, results: testCandidates });
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) return jsonResponse(200, { count: testAssessments.length, next: null, previous: null, results: testAssessments });
      if (url.includes("/api/gradings/outcomes/")) return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      if (url.includes("/api/students/")) return jsonResponse(200, { count: testStudentsList.length, next: null, previous: null, results: testStudentsList });
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const row = await screen.findByTestId("candidate-row-102");

    expect(screen.queryByTestId("propose-outcome-btn-102")).not.toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "View record →" })).toHaveAttribute(
      "href",
      "/gradings/10/assessments/102/review",
    );
  });

  it("opens the proposal drawer with the sealed assessment evidence and submits a proposal", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, {
          ...adminUser,
          can_make_final_grading_decision: false,
        });
      }
      if (url.includes("/api/gradings/sessions/10/")) {
        return jsonResponse(200, lockedSession);
      }
      if (url.includes("/api/gradings/candidates/")) {
        return jsonResponse(200, {
          count: testCandidates.length,
          next: null,
          previous: null,
          results: testCandidates,
        });
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
        return jsonResponse(200, {
          count: testAssessments.length,
          next: null,
          previous: null,
          results: testAssessments,
        });
      }
      if (url.includes("/summary/")) {
        return jsonResponse(
          200,
          assessmentSummaryFor(
            Array.from({ length: 24 }, (_, i) => ({
              id: 1000 + i,
              category: "TECHNIQUE",
              required: true,
              result: "MET",
            })) as unknown as CandidateAssessmentItem[],
          ),
        );
      }
      if (url.includes("/api/gradings/assessment-items/")) {
        return jsonResponse(200, {
          count: 24,
          next: null,
          previous: null,
          results: Array.from({ length: 24 }, (_, i) => ({
            id: 1000 + i,
            item_code: `ITEM-${i}`,
            item_name: `Item ${i}`,
            category: "TECHNIQUE",
            category_display: "Techniques",
            category_is_core: false,
            required: true,
            result: "MET",
            result_display: "Met",
            position: i,
            assessor_email: "coach@example.com",
            assessed_at: null,
            // A positive observation on a met item must reach the proposer too.
            assessor_notes: i === 0 ? "Crisp, confident footwork" : "",
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

    // Candidate and the rank transition, from the candidate's own fields
    expect(within(drawer).getByRole("heading", { name: "Brooke Ellis" })).toBeVisible();
    expect(within(drawer).getByText("UK-1002")).toBeVisible();
    expect(drawer).toHaveTextContent(/Blue\s*→\s*Red stripe/);

    // The same served evidence the Master sees on the board - no percentage
    expect(await within(drawer).findByText("24 / 24 required met · none not met")).toBeVisible();
    expect(within(drawer).queryByText(/%/)).not.toBeInTheDocument();
    expect(await within(drawer).findByText("Crisp, confident footwork")).toBeVisible();
    expect(
      within(drawer).getByRole("link", { name: "Open the full assessment record" }),
    ).toHaveAttribute("href", "/gradings/10/assessments/102/review");

    // Pass / Conditional / Fail, Pass selected by default
    expect(within(drawer).getByRole("radio", { name: "Pass" })).toBeChecked();
    await user.click(within(drawer).getByRole("radio", { name: "Conditional" }));
    expect(within(drawer).getByRole("radio", { name: "Conditional" })).toBeChecked();
    expect(within(drawer).getByRole("radio", { name: "Fail" })).not.toBeChecked();

    await user.type(
      within(drawer).getByLabelText("Notes for the Master"),
      "Recommend re-testing form 3 within 2 weeks.",
    );
    expect(
      within(drawer).getByText(/A proposal does not finalise the grading or promote the candidate/),
    ).toBeVisible();

    await user.click(within(drawer).getByRole("button", { name: "Submit proposal" }));

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

  it("dismisses the proposal drawer on Cancel and Escape", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, lockedSession);
      if (url.includes("/api/gradings/candidates/")) return jsonResponse(200, { count: testCandidates.length, next: null, previous: null, results: testCandidates });
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) return jsonResponse(200, { count: testAssessments.length, next: null, previous: null, results: testAssessments });
      if (url.includes("/summary/")) return jsonResponse(200, assessmentSummaryFor([]));
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
    await user.click(within(reopenedDrawer).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByTestId("outcome-proposal-drawer")).not.toBeInTheDocument();

    // Open drawer again and dismiss via Escape key
    await user.click(proposeBtn);
    expect(await screen.findByTestId("outcome-proposal-drawer")).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("outcome-proposal-drawer")).not.toBeInTheDocument();
    expect(proposeBtn).toHaveFocus();
  });

  it("keeps the proposal drawer open with the server's reason when a proposal is refused", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, lockedSession);
      if (url.includes("/api/gradings/candidates/102/create-outcome/") && init?.method === "POST") {
        return jsonResponse(400, {
          error: { code: "validation_error", message: "The assessment is not completed." },
        });
      }
      if (url.includes("/api/gradings/candidates/")) return jsonResponse(200, { count: testCandidates.length, next: null, previous: null, results: testCandidates });
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) return jsonResponse(200, { count: testAssessments.length, next: null, previous: null, results: testAssessments });
      if (url.includes("/summary/")) return jsonResponse(200, assessmentSummaryFor([]));
      if (url.includes("/api/gradings/assessment-items/")) return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      if (url.includes("/api/gradings/outcomes/")) return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      if (url.includes("/api/students/")) return jsonResponse(200, { count: testStudentsList.length, next: null, previous: null, results: testStudentsList });
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await user.click(await screen.findByTestId("propose-outcome-btn-102"));
    const drawer = await screen.findByTestId("outcome-proposal-drawer");

    await user.click(within(drawer).getByRole("button", { name: "Submit proposal" }));

    expect(await within(drawer).findByRole("alert")).toHaveTextContent(
      "The assessment is not completed.",
    );
    expect(screen.getByTestId("outcome-proposal-drawer")).toBeVisible();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/propose/"))).toBe(false);
  });

  it("retries a refused proposal against the outcome it already created", async () => {
    const user = userEvent.setup();
    let proposeAttempts = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, lockedSession);
      if (url.includes("/api/gradings/candidates/102/create-outcome/") && init?.method === "POST") {
        return jsonResponse(201, { ...testOutcomes[0], id: 401, proposed_outcome: null });
      }
      if (url.includes("/api/gradings/outcomes/401/propose/") && init?.method === "PATCH") {
        proposeAttempts += 1;
        if (proposeAttempts === 1) {
          return jsonResponse(400, {
            error: { code: "validation_error", message: "Try again shortly." },
          });
        }
        return jsonResponse(200, { ...testOutcomes[0], id: 401, proposed_outcome: "PASS" });
      }
      if (url.includes("/api/gradings/candidates/")) return jsonResponse(200, { count: testCandidates.length, next: null, previous: null, results: testCandidates });
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) return jsonResponse(200, { count: testAssessments.length, next: null, previous: null, results: testAssessments });
      if (url.includes("/summary/")) return jsonResponse(200, assessmentSummaryFor([]));
      if (url.includes("/api/gradings/assessment-items/")) return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      if (url.includes("/api/gradings/outcomes/")) return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      if (url.includes("/api/students/")) return jsonResponse(200, { count: testStudentsList.length, next: null, previous: null, results: testStudentsList });
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await user.click(await screen.findByTestId("propose-outcome-btn-102"));
    const drawer = await screen.findByTestId("outcome-proposal-drawer");

    await user.click(within(drawer).getByRole("button", { name: "Submit proposal" }));
    expect(await within(drawer).findByRole("alert")).toHaveTextContent("Try again shortly.");

    await user.click(within(drawer).getByRole("button", { name: "Submit proposal" }));
    await waitFor(() => expect(screen.queryByTestId("outcome-proposal-drawer")).not.toBeInTheDocument());

    const creates = fetchMock.mock.calls.filter(
      ([url, init]) => String(url).includes("/create-outcome/") && init?.method === "POST",
    );
    expect(creates).toHaveLength(1);
    expect(proposeAttempts).toBe(2);
  });

  it("resumes with the outcome a lost creation response already made", async () => {
    const user = userEvent.setup();
    let created = false;
    const madeOutcome = { ...testOutcomes[0], id: 401, candidate: 102, proposed_outcome: null };
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, lockedSession);
      if (url.includes("/api/gradings/candidates/102/create-outcome/") && init?.method === "POST") {
        // The server made it; the response never arrived.
        created = true;
        throw new TypeError("Failed to fetch");
      }
      if (url.includes("/api/gradings/outcomes/401/propose/") && init?.method === "PATCH") {
        return jsonResponse(200, { ...madeOutcome, proposed_outcome: "PASS" });
      }
      if (url.includes("/api/gradings/candidates/")) return jsonResponse(200, { count: testCandidates.length, next: null, previous: null, results: testCandidates });
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) return jsonResponse(200, { count: testAssessments.length, next: null, previous: null, results: testAssessments });
      if (url.includes("/api/students/")) return jsonResponse(200, { count: testStudentsList.length, next: null, previous: null, results: testStudentsList });
      if (url.includes("/summary/")) return jsonResponse(200, assessmentSummaryFor([]));
      if (url.includes("/api/gradings/assessment-items/")) return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      if (url.includes("/api/gradings/outcomes/")) {
        const results = created ? [madeOutcome] : [];
        return jsonResponse(200, { count: results.length, next: null, previous: null, results });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await user.click(await screen.findByTestId("propose-outcome-btn-102"));
    const drawer = await screen.findByTestId("outcome-proposal-drawer");
    await user.click(within(drawer).getByRole("button", { name: "Submit proposal" }));

    await waitFor(() => expect(screen.queryByTestId("outcome-proposal-drawer")).not.toBeInTheDocument());
    const creates = fetchMock.mock.calls.filter(([url]) => String(url).includes("/create-outcome/"));
    expect(creates).toHaveLength(1);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/api/gradings/outcomes/401/propose/")),
    ).toBe(true);
    // Found by asking for that candidate's outcome, not by downloading the session's.
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/api/gradings/outcomes/?candidate=102")),
    ).toBe(true);
  });

  it("will not submit a proposal while its evidence failed to load", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) return jsonResponse(200, adminUser);
      if (url.includes("/api/gradings/sessions/10/")) return jsonResponse(200, lockedSession);
      if (url.includes("/api/gradings/candidates/")) return jsonResponse(200, { count: testCandidates.length, next: null, previous: null, results: testCandidates });
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) return jsonResponse(200, { count: testAssessments.length, next: null, previous: null, results: testAssessments });
      if (url.includes("/api/students/")) return jsonResponse(200, { count: testStudentsList.length, next: null, previous: null, results: testStudentsList });
      if (url.includes("/summary/")) return jsonResponse(500, {});
      if (url.includes("/api/gradings/assessment-items/")) return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      if (url.includes("/api/gradings/outcomes/")) return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await user.click(await screen.findByTestId("propose-outcome-btn-102"));
    const drawer = await screen.findByTestId("outcome-proposal-drawer");

    expect(await within(drawer).findByText(/could not be loaded/)).toBeVisible();
    expect(within(drawer).getByRole("button", { name: "Submit proposal" })).toBeDisabled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/create-outcome/"))).toBe(false);
  });
});
