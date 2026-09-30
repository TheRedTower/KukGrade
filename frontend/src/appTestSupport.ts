import { afterEach, vi } from "vitest";

import type {
  AuthUser,
  CandidateAssessmentItem,
  CandidateAssessmentSummary,
  GradingSession,
} from "./api";

export const authUser = {
  id: "7d3c55f4-e9e7-4b2b-b5d0-5fc9e899df17",
  email: "casey@example.com",
  first_name: "Casey",
  last_name: "Instructor",
  full_name: "Casey Instructor",
  role_display: "Instructor",
  can_make_final_grading_decision: false,
  can_promote_student: false,
  can_override_locked_session: false,
  can_view_grading_audit_log: false,
  can_manage_users: false,
  can_import_data: false,
  can_reconcile_imported_history: false,
  can_delete_students: false,
  can_delete_assessments: false,
  can_delete_any_session: false,
  can_read_audit_log: false,
  must_change_password: false,
} satisfies AuthUser;

// What /api/auth/me/ reports for an account in the Administrator group.
export const ADMINISTRATOR_CAPABILITIES = {
  can_manage_users: true,
  can_import_data: true,
  can_reconcile_imported_history: true,
  can_delete_students: true,
  can_delete_assessments: true,
  can_delete_any_session: true,
  can_read_audit_log: true,
} satisfies Partial<AuthUser>;

export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

export function emptyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => undefined,
  } as Response;
}

export function authRequiredResponse(): Response {
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

// Mirrors gradings.services.candidate_assessment_summary so each test's item
// fixture stays the single source of truth for its own counts.
export function assessmentSummaryFor(items: CandidateAssessmentItem[]): CandidateAssessmentSummary {
  const block = (subset: CandidateAssessmentItem[]): CandidateAssessmentSummary["overall"] => {
    const required = subset.filter((item) => item.required);
    const requiredNotAssessed = required.filter(
      (item) => item.result === "NOT_ASSESSED",
    ).length;
    return {
      total: subset.length,
      required: required.length,
      met: subset.filter((item) => item.result === "MET").length,
      not_met: subset.filter((item) => item.result === "NOT_MET").length,
      not_assessed: subset.filter((item) => item.result === "NOT_ASSESSED").length,
      required_met: required.filter((item) => item.result === "MET").length,
      required_not_assessed: requiredNotAssessed,
      all_required_assessed: requiredNotAssessed === 0,
    };
  };
  const categories = Array.from(new Set(items.map((item) => item.category))).map(
    (category) => ({
      category,
      ...block(items.filter((item) => item.category === category)),
    }),
  );
  return { overall: block(items), categories };
}

/** What every endpoint but /api/auth/me/ answers for a signed-in user: an empty page. */
export function signedInResponse(url: string, user: AuthUser): Response {
  return url.includes("/api/auth/me/")
    ? jsonResponse(200, user)
    : jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
}

export function fetchSignedInAs(user: AuthUser) {
  return vi.fn().mockImplementation(async (url: string) => signedInResponse(url, user));
}

/**
 * The sessions endpoints as the server answers them for the filters the app
 * sends: several statuses, a start date, an ordering and a page size, plus
 * the list of years. Search and paging are not modelled.
 */
export function sessionsResponse(url: string, sessions: GradingSession[]): Response {
  const query = new URL(url, "http://localhost");
  if (query.pathname.endsWith("/sessions/years/")) {
    const years = new Set(sessions.map((s) => Number(s.grading_date.slice(0, 4))));
    return jsonResponse(200, { years: [...years].sort((a, b) => b - a) });
  }
  const statuses = query.searchParams.get("status")?.split(",");
  const from = query.searchParams.get("grading_date_from");
  const size = Number(query.searchParams.get("page_size") ?? sessions.length);
  const rows = sessions
    .filter((s) => !statuses || statuses.includes(s.status ?? ""))
    .filter((s) => !from || s.grading_date >= from)
    .sort((a, b) =>
      query.searchParams.get("ordering") === "grading_date"
        ? a.grading_date.localeCompare(b.grading_date)
        : b.grading_date.localeCompare(a.grading_date),
    );
  return jsonResponse(200, {
    count: rows.length,
    next: null,
    previous: null,
    results: rows.slice(0, size),
  });
}
