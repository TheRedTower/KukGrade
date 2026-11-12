import { afterEach, vi } from "vitest";

import type {
  AuthUser,
  CandidateAssessmentItem,
  CandidateAssessmentSummary,
  Choices,
  GradingSession,
  GradingSessionStatus,
  SiteSettings,
} from "./api";

/** /api/choices/ as the server serves it. */
export const CHOICES: Choices = {
  session_statuses: [
    { value: "DRAFT", label: "Draft" },
    { value: "OPEN", label: "Open" },
    { value: "LOCKED", label: "Locked" },
    { value: "COMPLETED", label: "Completed" },
    { value: "CANCELLED", label: "Cancelled" },
  ],
  student_statuses: [
    {
      value: "ACTIVE",
      label: "Active",
      description: "In regular training. Can be registered for gradings, one at a time.",
    },
    {
      value: "INACTIVE",
      label: "Inactive",
      description:
        "On a temporary break, such as medical leave. Inactive blocks nothing: the student can still be registered, and all history is kept.",
    },
    { value: "LEFT", label: "Left", description: "Has left. Cannot be registered for gradings; all history is kept." },
  ],
  candidate_statuses: [
    { value: "REGISTERED", label: "Registered" },
    { value: "WITHDRAWN", label: "Withdrawn" },
    { value: "COMPLETED", label: "Completed" },
  ],
  assessment_statuses: [
    { value: "NOT_STARTED", label: "Not started" },
    { value: "IN_PROGRESS", label: "In progress" },
    { value: "COMPLETED", label: "Completed" },
  ],
  item_results: [
    { value: "NOT_ASSESSED", label: "Not assessed" },
    { value: "MET", label: "Met" },
    { value: "NOT_MET", label: "Not met" },
  ],
  outcomes: [
    { value: "PASS", label: "Pass" },
    { value: "CONDITIONAL", label: "Conditional" },
    { value: "FAIL", label: "Fail" },
  ],
  import_kinds: [
    { value: "STUDENT_ROSTER", label: "Students" },
    { value: "LEGACY_GRADINGS", label: "Past gradings" },
  ],
  finished_import_statuses: [
    { value: "COMMITTED", label: "Imported" },
    { value: "CANCELLED", label: "Cancelled" },
    { value: "EXPIRED", label: "Expired" },
  ],
  import_row_outcomes: [
    { value: "READY", label: "Ready" },
    { value: "REVIEW_REQUIRED", label: "Needs attention" },
    { value: "SKIP_EXISTING", label: "Already in KukGrade" },
    { value: "EXCLUDED", label: "Left out" },
  ],
  roles: [
    { value: "instructor", label: "Instructor" },
    { value: "administrator", label: "Administrator" },
  ],
  authorities: [
    {
      value: "can_make_final_grading_decision",
      label: "Make final grading decisions",
      description: "Allow this user to make final decisions on student gradings.",
    },
    {
      value: "can_promote_student",
      label: "Promote students",
      description: "Allow this user to promote students to the next rank.",
    },
    {
      value: "can_override_locked_session",
      label: "Override locked sessions",
      description: "Allow this user to make authorised corrections after locking.",
    },
    {
      value: "can_view_grading_audit_log",
      label: "View grading audit log",
      description: "Allow this user to see grading, syllabus and assessment audit events (not user management).",
    },
  ],
  staff_ranks: [
    { value: 12, label: "JKN" },
    { value: 13, label: "KSN" },
    { value: 14, label: "PSBN" },
    { value: 15, label: "SBN" },
    { value: 16, label: "PKJN" },
  ],
};

/** /api/site/ as the server serves it, with a made-up club. */
export const SITE: SiteSettings = {
  club_name: "Kuk Sool Won Testville",
  time_zone: "Europe/London",
  imports: {
    max_bytes: 5 * 1024 * 1024,
    max_rows: 1000,
    rows_kept_for_days: 30,
    bulk_link_limit: 500,
    kinds: [
      {
        kind: "STUDENT_ROSTER",
        file_types: [
          { value: "xlsx", label: "Excel" },
          { value: "csv", label: "CSV" },
        ],
        steps: [
          { value: "CHOOSE_FILE", label: "Choose file" },
          { value: "MATCH", label: "Match columns" },
          { value: "REVIEW", label: "Review rows" },
          { value: "CONFIRM", label: "Confirm" },
          { value: "RESULTS", label: "Results" },
        ],
      },
      {
        kind: "LEGACY_GRADINGS",
        file_types: [{ value: "xlsx", label: "Excel" }],
        steps: [
          { value: "CHOOSE_FILE", label: "Choose file" },
          { value: "MATCH", label: "Match ranks" },
          { value: "REVIEW", label: "Review records" },
          { value: "CONFIRM", label: "Confirm" },
          { value: "RESULTS", label: "Results" },
        ],
      },
    ],
    template_headers: ["WKSA ID", "First Name", "Last Name", "Date of Birth", "Current Rank", "Status"],
  },
  password_policy: { min_length: 16, max_length: 64, character_rules: [], checked_on_save: [] },
  wksa_id: { hint: "", forms: [] },
};

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

/**
 * The server's answer, readable any number of times, so one answer can stand
 * for every call a mock returns it to.
 */
export function jsonResponse(status: number, body: unknown): Response {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => text,
  } as Response;
}

/**
 * Stand in for the server. The app sends a Request; `respond` is called as
 * fetch(path, init) with its path and query, method, headers, credentials
 * and body as text, so a test reads a request as it was sent.
 */
export function stubFetch(respond: (url: string, init: RequestInit) => unknown): void {
  vi.stubGlobal("fetch", async (request: Request) => {
    const url = new URL(request.url);
    return respond(url.pathname + url.search, {
      method: request.method,
      headers: request.headers,
      credentials: request.credentials,
      ...(request.body ? { body: await request.text() } : {}),
    });
  });
}

/**
 * A signed-out visitor's answer to any request: the setup check says a
 * deployment that is already set up, as it would to anyone; everything else
 * says not signed in.
 */
export function signedOutResponse(url: string): Response {
  return url.includes("/api/setup/") ? jsonResponse(200, { setup_needed: false }) : authRequiredResponse();
}

export function emptyResponse(status: number): Response {
  return jsonResponse(status, undefined);
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
    const requiredNotAssessed = required.filter((item) => item.result === "NOT_ASSESSED").length;
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
  const categories = Array.from(new Set(items.map((item) => item.category))).map((category) => ({
    category,
    ...block(items.filter((item) => item.category === category)),
  }));
  const overall = block(items);
  // As if the assessment is in progress in an open session.
  return { overall, can_complete: overall.required_not_assessed === 0, categories };
}

// Mirrors an item's served rules (gradings.assessment_services
// item_change_needs_reason and item_mark_can_be_cleared) for a fixture.
export function itemServed<T extends CandidateAssessmentItem>(item: T, { locked = false, completed = false } = {}): T {
  const scored = item.result === "MET" || item.result === "NOT_MET";
  return {
    ...item,
    reason_required: scored || item.changes.length > 0 || locked,
    can_clear: scored && !(completed && item.required),
  };
}

// What a save answers: the item as marked, with its change now in the log,
// so its next change says why.
export function itemSaved<T extends CandidateAssessmentItem>(item: T, result: T["result"], options = {}): T {
  return { ...itemServed({ ...item, result }, options), reason_required: true };
}

// Mirrors the session's served capabilities (gradings.serializers
// GradingSessionSerializer) for an instructor, so a fixture states its status
// once. `withOverride` is a viewer holding the locked-session override.
export function sessionServed(status: GradingSessionStatus, { withOverride = false } = {}) {
  const roster = status === "DRAFT" || status === "OPEN";
  return {
    withdrawn_count: 0,
    roster_open: roster,
    marking_open: status === "OPEN",
    decisions_open: status === "LOCKED",
    can_open: status === "DRAFT",
    can_lock: status === "OPEN",
    can_complete: status === "LOCKED",
    can_cancel: roster || (status === "LOCKED" && withOverride),
    cancel_reason_required: status === "LOCKED",
  };
}

export const ABOUT = {
  version: "0.2.0",
  release: "0.2.0",
  commit: "5198f1b",
  built_at: "2026-10-21T09:30:00Z",
  time_zone: "Europe/London",
  database: "ok",
  repository_url: "https://github.com/example/kukgrade",
  issues_url: "https://github.com/example/kukgrade/issues",
  releases_url: "https://github.com/example/kukgrade/releases",
  support_email: "help@example.org",
  security_email: "security@example.org",
  licence: "AGPL-3.0-only",
  copyright: "Copyright © 2026 Example Owner",
};

const ABOUT_DOCUMENTS: Record<string, unknown> = {
  licence: {
    slug: "licence",
    title: "Licence",
    format: "text",
    content: "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n\nTERMS AND CONDITIONS",
    source_url: "https://github.com/example/kukgrade/blob/HEAD/LICENSE",
  },
  "code-of-conduct": {
    slug: "code-of-conduct",
    title: "Code of conduct",
    format: "markdown",
    content:
      "# Contributor Covenant Code of Conduct\n\n## Our Pledge\n\nBe kind.\n\n## Enforcement\n\nReport it to help@example.org.",
    source_url: "https://github.com/example/kukgrade/blob/HEAD/CODE_OF_CONDUCT.md",
  },
  security: {
    slug: "security",
    title: "Security",
    format: "markdown",
    content:
      "# Security Policy\n\n## Reporting a vulnerability\n\nWrite to [security](mailto:security@example.org).\n\n## Scope\n\nSee [the features](docs/features.md#roles) and [the site](https://example.org/).",
    source_url: "https://github.com/example/kukgrade/blob/HEAD/SECURITY.md",
  },
};

const ABOUT_PLEDGE = {
  title: "The Kuk Sool Won Pledge",
  points: [
    { english: "First promise.", korean: "첫째 맹세." },
    { english: "Second promise.", korean: "둘째 맹세." },
  ],
};

export const ABOUT_CREDITS = {
  available: true,
  server: [
    {
      name: "Django",
      version: "5.2.0",
      summary: "A web framework.",
      licence: "BSD-3-Clause",
      homepage: "https://www.djangoproject.com/",
    },
  ],
  browser: [{ name: "react", version: "19.0.0", summary: "A UI library.", licence: "MIT", homepage: "" }],
};

/** What every endpoint answers for a signed-in user: their account, the served choices and settings, the About pages, and otherwise an empty page. */
export function signedInResponse(url: string, user: AuthUser): Response {
  if (url.includes("/api/auth/me/")) return jsonResponse(200, user);
  if (url.includes("/api/choices/")) return jsonResponse(200, CHOICES);
  if (url.includes("/api/site/")) return jsonResponse(200, SITE);
  if (url.includes("/api/about/documents/")) {
    const slug = url.split("/documents/")[1].replace(/\/$/, "");
    return jsonResponse(200, ABOUT_DOCUMENTS[slug]);
  }
  if (url.includes("/api/about/pledge/")) return jsonResponse(200, ABOUT_PLEDGE);
  if (url.includes("/api/about/credits/")) return jsonResponse(200, ABOUT_CREDITS);
  if (url.includes("/api/about/")) return jsonResponse(200, ABOUT);
  if (url.includes("/api/audit-events/labels/")) {
    return jsonResponse(200, { actions: [], entities: [] });
  }
  return jsonResponse(200, { count: 0, next: null, previous: null, results: [] });
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
  const year = query.searchParams.get("year");
  const size = Number(query.searchParams.get("page_size") ?? sessions.length);
  const rows = sessions
    .filter((s) => !statuses || statuses.includes(s.status ?? ""))
    .filter((s) => !from || s.grading_date >= from)
    .filter((s) => !year || s.grading_date.startsWith(`${year}-`))
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
