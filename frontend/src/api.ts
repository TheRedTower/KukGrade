import type { components } from "./api/schema";

const DEFAULT_API_BASE_URL = "http://localhost:8000";

// Generated from backend/schema.yml (`npm run generate:types`) rather than
// hand-maintained, so these cannot silently drift from the serializers - see
// the 2026-09-14 decision log entry. Regenerate after any serializer change.
export type HealthResponse = components["schemas"]["HealthResponse"];
export type AuthUser = components["schemas"]["User"];
export type UserRole = components["schemas"]["RoleEnum"];

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type GradingSession = components["schemas"]["GradingSession"];
export type GradingSessionStatus = components["schemas"]["GradingSessionStatusEnum"];
export type GradingCandidate = components["schemas"]["GradingCandidate"];
export type CandidateAssessment = components["schemas"]["CandidateAssessment"];
export type CandidateAssessmentStatus = components["schemas"]["CandidateAssessmentStatusEnum"];
export type AuditEvent = components["schemas"]["AuditEvent"];
export type StudentListItem = components["schemas"]["StudentList"];
export type StudentDetail = components["schemas"]["Student"];
export type StudentStatus = components["schemas"]["StudentStatusEnum"];
export type Rank = components["schemas"]["Rank"];

/**
 * The error envelope itself has no generated equivalent: `custom_exception_handler`
 * builds it outside DRF's serializer-driven response path, so drf-spectacular
 * documents only the 2xx responses in backend/schema.yml - there is no 4xx
 * schema to generate this from. Hand-written until the views declare their
 * error responses explicitly (`@extend_schema(responses=...)`).
 */

/**
 * Per-field validation messages, mirroring the serializer's shape. Values are
 * message lists for ordinary fields; nested serializers nest further. Errors
 * raised at serializer level rather than against a field are keyed under
 * `non_field_errors`.
 */
export type FieldErrors = { [field: string]: string[] | FieldErrors };

export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    fields?: FieldErrors;
  };
};

export class ApiError extends Error {
  status: number;
  code?: string;
  fields?: FieldErrors;

  constructor(
    message: string,
    status: number,
    code?: string,
    fields?: FieldErrors,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  /** Messages for one field, or an empty array when it has no errors. */
  messagesFor(field: string): string[] {
    const value = this.fields?.[field];
    return Array.isArray(value) ? value : [];
  }

  /** Errors raised against the request as a whole rather than a field. */
  get nonFieldMessages(): string[] {
    return this.messagesFor("non_field_errors");
  }
}

function apiBaseUrl(): string {
  return (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(
    /\/$/,
    "",
  );
}

function csrfToken(): string | undefined {
  return document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith("csrftoken="))
    ?.split("=")[1];
}

async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = init.method?.toUpperCase() ?? "GET";
  const headers = new Headers(init.headers);

  if (!headers.has("Content-Type") && init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  if (!["GET", "HEAD", "OPTIONS", "TRACE"].includes(method)) {
    const token = csrfToken();
    if (token) {
      headers.set("X-CSRFToken", decodeURIComponent(token));
    }
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    let message = `API request failed with status ${response.status}`;
    let code: string | undefined;
    let fields: FieldErrors | undefined;
    try {
      const body = (await response.json()) as ApiErrorBody;
      message = body.error?.message ?? message;
      code = body.error?.code;
      fields = body.error?.fields;
    } catch {
      // Keep the status-derived message when the response is not JSON,
      // which is what a proxy error or a gateway timeout looks like.
    }
    throw new ApiError(message, response.status, code, fields);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function getHealth(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>("/api/health/");
}

export async function getCurrentUser(): Promise<AuthUser> {
  return apiRequest<AuthUser>("/api/auth/me/");
}

export async function loginUser(
  email: string,
  password: string,
): Promise<AuthUser> {
  return apiRequest<AuthUser>("/api/auth/login/", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logoutUser(): Promise<void> {
  await apiRequest<void>("/api/auth/logout/", {
    method: "POST",
  });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await apiRequest<void>("/api/auth/change-password/", {
    method: "POST",
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
}

export async function getGradingSessions(params?: {
  status?: string;
  grading_date?: string;
  grading_date_from?: string;
  grading_date_to?: string;
}): Promise<PaginatedResponse<GradingSession>> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.grading_date) searchParams.set("grading_date", params.grading_date);
  if (params?.grading_date_from) searchParams.set("grading_date_from", params.grading_date_from);
  if (params?.grading_date_to) searchParams.set("grading_date_to", params.grading_date_to);
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<GradingSession>>(
    `/api/gradings/sessions/${query ? `?${query}` : ""}`,
  );
}

export async function getGradingCandidates(params?: {
  session?: number;
  student_wksa_id?: string;
}): Promise<PaginatedResponse<GradingCandidate>> {
  const searchParams = new URLSearchParams();
  if (params?.session !== undefined) searchParams.set("session", String(params.session));
  if (params?.student_wksa_id) searchParams.set("student_wksa_id", params.student_wksa_id);
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<GradingCandidate>>(
    `/api/gradings/candidates/${query ? `?${query}` : ""}`,
  );
}

export async function getCandidateAssessments(params?: {
  session?: number;
  candidate?: number;
  status?: string;
}): Promise<PaginatedResponse<CandidateAssessment>> {
  const searchParams = new URLSearchParams();
  if (params?.session !== undefined) searchParams.set("session", String(params.session));
  if (params?.candidate !== undefined) searchParams.set("candidate", String(params.candidate));
  if (params?.status) searchParams.set("status", params.status);
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<CandidateAssessment>>(
    `/api/gradings/assessments/${query ? `?${query}` : ""}`,
  );
}

export async function getAuditEvents(params?: {
  limit?: number;
  offset?: number;
  action?: string;
  entity_type?: string;
}): Promise<PaginatedResponse<AuditEvent>> {
  const searchParams = new URLSearchParams();
  if (params?.limit !== undefined) searchParams.set("limit", String(params.limit));
  if (params?.offset !== undefined) searchParams.set("offset", String(params.offset));
  if (params?.action) searchParams.set("action", params.action);
  if (params?.entity_type) searchParams.set("entity_type", params.entity_type);
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<AuditEvent>>(
    `/api/audit-events/${query ? `?${query}` : ""}`,
  );
}

export async function getStudents(params?: {
  search?: string;
  status?: string;
  current_rank_code?: string;
  page?: number;
  page_size?: number;
}): Promise<PaginatedResponse<StudentListItem>> {
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set("search", params.search);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.current_rank_code) searchParams.set("current_rank_code", params.current_rank_code);
  if (params?.page !== undefined) searchParams.set("page", String(params.page));
  if (params?.page_size !== undefined) searchParams.set("page_size", String(params.page_size));
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<StudentListItem>>(
    `/api/students/${query ? `?${query}` : ""}`,
  );
}

export async function getRanks(params?: {
  page_size?: number;
}): Promise<PaginatedResponse<Rank>> {
  const searchParams = new URLSearchParams();
  if (params?.page_size !== undefined) searchParams.set("page_size", String(params.page_size));
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<Rank>>(
    `/api/ranks/${query ? `?${query}` : ""}`,
  );
}

export async function getStudent(id: number): Promise<StudentDetail> {
  return apiRequest<StudentDetail>(`/api/students/${id}/`);
}

