import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type {
  AuditEvent,
  AuthUser,
  CandidateAssessment,
  GradingSession,
} from "./api";
import {
  authUser,
  ADMINISTRATOR_CAPABILITIES,
  jsonResponse,
  assessmentSummaryFor,
  sessionsResponse,
} from "./appTestSupport";

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
      if (url.includes("/api/audit-events/labels/")) {
        return jsonResponse(200, { actions: [], entities: [] });
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

    // Recent activity is the audit log's feed: someone who may not read the
    // log is shown no section at all, not an empty one.
    expect(screen.queryByText("Recent activity")).not.toBeInTheDocument();
    expect(screen.queryByText("No recent activity recorded.")).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/api/audit-events/")),
    ).toBe(false);
  });

  it("shows an audit reader that there is no recent activity", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, { ...authUser, can_read_audit_log: true });
      }
      return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByText("No recent activity recorded.")).toBeVisible();
  });

  // KG-A19: an event's status comes from its action and structured outcome,
  // never from words in its summary.
  it("labels activity by what happened, not by words in the summary", async () => {
    const event = (
      id: number,
      action: AuditEvent["action"],
      action_display: string,
      summary: string,
      metadata: Record<string, unknown> = {},
    ) =>
      ({
        id,
        occurred_at: new Date().toISOString(),
        action,
        action_display,
        entity_type: "CandidateOutcome",
        entity_type_display: "Outcome",
        entity_id: String(id),
        actor_email: "master@example.com",
        actor_name: "Morgan Master",
        summary,
        metadata,
      }) satisfies AuditEvent;
    const events = [
      event(1, "USER_UPDATED", "User updated", "Password reset for someone@example.com."),
      event(2, "OUTCOME_PROPOSED", "Outcome proposed", "Outcome proposed as PASS.", {
        after: { proposed_outcome: "PASS" },
      }),
      event(3, "OUTCOME_FINALISED", "Outcome finalised", "Final decision FAIL, overriding a proposed PASS.", {
        final_outcome: "FAIL",
      }),
      event(4, "OUTCOME_FINALISED", "Outcome finalised", "Final decision CONDITIONAL.", {
        final_outcome: "CONDITIONAL",
      }),
      event(5, "CANDIDATE_WITHDRAWN", "Candidate withdrawn", "Withdrawn: did not attend."),
      event(6, "PROMOTION_RECORDED", "Promotion recorded", "Promoted to Yellow."),
      event(7, "SESSION_UPDATED", "Grading session updated", "Notes: everyone should pass."),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/auth/me/")) return jsonResponse(200, { ...authUser, can_read_audit_log: true });
        if (url.includes("/api/gradings/sessions/")) {
          return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
        }
        if (url.includes("/api/audit-events/labels/")) {
        return jsonResponse(200, { actions: [], entities: [] });
      }
      if (url.includes("/api/audit-events/")) {
          return jsonResponse(200, { count: events.length, next: null, previous: null, results: events });
        }
        return jsonResponse(404, {});
      }),
    );

    render(<App />);

    const ledger = await screen.findByRole("table", { name: "Recent activity" });
    const statusOf = (summary: string) =>
      within(ledger).getByText(summary).closest("tr")!.querySelector(".status-pill-badge")!;
    expect(statusOf("Password reset for someone@example.com.")).toHaveTextContent("User updated");
    expect(statusOf("Password reset for someone@example.com.")).toHaveClass("status-pill-neutral");
    expect(statusOf("Outcome proposed as PASS.")).toHaveTextContent("Outcome proposed · Pass");
    expect(statusOf("Outcome proposed as PASS.")).toHaveClass("status-pill-in-progress");
    const overridden = statusOf("Final decision FAIL, overriding a proposed PASS.");
    expect(overridden).toHaveTextContent("Outcome finalised · Fail");
    expect(overridden).toHaveClass("status-pill-warning");
    expect(statusOf("Final decision CONDITIONAL.")).toHaveTextContent("Outcome finalised · Conditional");
    expect(statusOf("Withdrawn: did not attend.")).toHaveClass("status-pill-warning");
    expect(statusOf("Promoted to Yellow.")).toHaveClass("status-pill-approved");
    expect(statusOf("Notes: everyone should pass.")).toHaveClass("status-pill-neutral");
    expect(within(ledger).queryByText("Approved")).not.toBeInTheDocument();
    expect(within(ledger).getAllByText("Morgan Master")).toHaveLength(events.length);
  });

  it("renders active session, attention items, upcoming grading, and recent ledger activity", async () => {
    const openSession = {
      id: 101,
      title: "Spring Grading 2026",
      grading_date: "2026-05-15",
      status: "OPEN",
      status_display: "Open",
      // Served counts: the one completed assessment is already decided, so
      // nothing awaits a decision even though the list shows it completed.
      candidate_count: 2,
      completed_assessment_count: 1,
      awaiting_decision_count: 0,
      can_be_deleted: false,
      location: "Colchester Dojang",
    } satisfies GradingSession;

    const upcomingSession = {
      id: 102,
      title: "Summer Grading 2026",
      grading_date: "2099-08-20",
      status: "DRAFT",
      status_display: "Draft",
      candidate_count: 0,
      completed_assessment_count: 0,
      awaiting_decision_count: 0,
      can_be_deleted: false,
      location: "Ipswich Central",
    } satisfies GradingSession;

    const assessments = [
      {
        id: 401,
        candidate: 201,
        candidate_student_name: "Student One",
        status: "COMPLETED",
        status_display: "Completed",
        generated_by_email: authUser.email,
        overall: assessmentSummaryFor([]).overall,
        generated_at: "2026-05-15T09:30:00Z",
        started_at: "2026-05-15T10:00:00Z",
        completed_at: "2026-05-15T11:00:00Z",
      },
      {
        id: 402,
        candidate: 202,
        candidate_student_name: "Student Two",
        status: "IN_PROGRESS",
        status_display: "In Progress",
        generated_by_email: authUser.email,
        overall: assessmentSummaryFor([]).overall,
        generated_at: "2026-05-15T09:30:00Z",
        started_at: "2026-05-15T10:30:00Z",
        completed_at: null,
      },
    ] satisfies CandidateAssessment[];

    const auditEvents = [
      {
        id: 501,
        occurred_at: new Date().toISOString(),
        action: "ASSESSMENT_COMPLETED",
        action_display: "Assessment Completed",
        entity_type: "CandidateAssessment",
        entity_type_display: "Assessment",
        entity_id: "401",
        actor_email: authUser.email,
        actor_name: "Casey Instructor",
        summary: "Assessment complete (ready for review)",
        metadata: {},
      },
      {
        id: 502,
        occurred_at: new Date().toISOString(),
        action: "ASSESSMENT_STARTED",
        action_display: "Assessment Started",
        entity_type: "CandidateAssessment",
        entity_type_display: "Assessment",
        entity_id: "402",
        actor_email: authUser.email,
        actor_name: "Casey Instructor",
        summary: "Assessment started on the mat",
        metadata: {},
      },
    ] satisfies AuditEvent[];

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, { ...authUser, ...ADMINISTRATOR_CAPABILITIES });
      }
      if (url.includes("/api/gradings/sessions/")) {
        return sessionsResponse(url, [openSession, upcomingSession]);
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
        return jsonResponse(200, {
          count: 2,
          next: null,
          previous: null,
          results: assessments,
        });
      }
      if (url.includes("/api/audit-events/labels/")) {
        return jsonResponse(200, { actions: [], entities: [] });
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
    expect(screen.getByText("Awaiting final decision").previousElementSibling).toHaveTextContent(
      "0",
    );
    expect(screen.getByRole("button", { name: /Open session/i })).toBeVisible();

    // Needs attention card
    expect(await screen.findByText("Student One")).toBeVisible();
    expect(screen.getByText("Assessment complete · Awaiting lock")).toBeVisible();
    expect(screen.getByText("Student Two")).toBeVisible();
    expect(screen.getByText("Assessment in progress · Scoring pending")).toBeVisible();

    // Upcoming card
    expect(screen.getByText("Summer Grading 2026")).toBeVisible();
    expect(screen.getByText("Ipswich Central")).toBeVisible();

    // Two small requests for the two sessions shown, never the whole history.
    const requested = fetchMock.mock.calls.map(([url]) => String(url));
    expect(requested.some((url) => url.includes("page_size=200"))).toBe(false);
    expect(requested.some((url) => url.includes("status=OPEN") && url.includes("page_size=1"))).toBe(true);
    expect(
      requested.some((url) => url.includes("ordering=grading_date") && url.includes("page_size=2")),
    ).toBe(true);

    // Recent activity table
    expect(await screen.findByText("Assessment complete (ready for review)")).toBeVisible();
    expect(screen.getByText("Assessment started on the mat")).toBeVisible();
    expect(screen.getByRole("button", { name: /View all activity/i })).toBeVisible();

    // An attention item opens that candidate's assessment, not a list to
    // search: the finished one at its record, the unfinished one to score.
    await userEvent.setup().click(screen.getByText("Student One"));
    expect(window.location.pathname).toBe("/gradings/101/assessments/201/review");
  });

  it("offers the audit feed by audit-log grant, not by staff flags", async () => {
    async function auditRequested(user: AuthUser): Promise<boolean> {
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/auth/me/")) {
          return jsonResponse(200, user);
        }
        if (url.includes("/api/gradings/sessions/") || url.includes("/api/audit-events/")) {
          return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
        }
        return jsonResponse(404, {});
      });
      vi.stubGlobal("fetch", fetchMock);
      const view = render(<App />);
      expect(await screen.findByRole("heading", { name: "Overview" })).toBeVisible();
      await screen.findByText("No upcoming gradings");
      const requested = fetchMock.mock.calls.some(([url]) => String(url).includes("/api/audit-events/"));
      view.unmount();
      return requested;
    }

    expect(await auditRequested({ ...authUser, can_read_audit_log: true })).toBe(true);
    expect(await auditRequested({ ...authUser, can_read_audit_log: false })).toBe(false);
  });

  it("navigates to gradings and audit when action links are clicked", async () => {
    const openSession = {
      id: 101,
      title: "Spring Grading 2026",
      grading_date: "2026-05-15",
      status: "OPEN",
      status_display: "Open",
      candidate_count: 0,
      completed_assessment_count: 0,
      awaiting_decision_count: 0,
      can_be_deleted: false,
      location: "Colchester Dojang",
    } satisfies GradingSession;

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/auth/me/")) {
        return jsonResponse(200, { ...authUser, ...ADMINISTRATOR_CAPABILITIES });
      }
      if (url.includes("/api/gradings/sessions/")) {
        return jsonResponse(200, { count: 1, next: null, previous: null, results: [openSession] });
      }
      if (url.includes("/api/gradings/assessments/") && !url.includes("/summary/")) {
        return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes("/api/audit-events/labels/")) {
        return jsonResponse(200, { actions: [], entities: [] });
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
    expect(window.location.pathname).toBe("/gradings/101");

    // Navigate back to overview
    window.history.replaceState({}, "", "/");
    await user.click(screen.getByRole("link", { name: "Overview" }));

    // Click "View all activity →"
    const viewAllButton = await screen.findByRole("button", { name: /View all activity/i });
    await user.click(viewAllButton);
    expect(window.location.pathname).toBe("/audit");
  });
});
