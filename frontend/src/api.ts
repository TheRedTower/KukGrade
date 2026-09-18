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
export type CandidateAssessmentItem = components["schemas"]["CandidateAssessmentItem"];
export type CandidateAssessmentItemResult = components["schemas"]["ResultEnum"];
export type CandidateOutcome = components["schemas"]["CandidateOutcome"];
export type CandidateOutcomeStatus = components["schemas"]["CandidateOutcomeStatusEnum"];
export type CandidateOutcomeOutcome = components["schemas"]["CandidateOutcomeOutcomeEnum"];
export type OverallAssessmentSummary = {
  total: number;
  required: number;
  met: number;
  not_met: number;
  not_assessed: number;
  required_met: number;
  required_not_met: number;
  required_not_assessed: number;
  all_required_assessed: boolean;
  all_required_met: boolean;
};
export type CategoryAssessmentSummary = {
  category: string;
  total: number;
  required: number;
  met: number;
  not_met: number;
  not_assessed: number;
  required_met: number;
  required_not_met: number;
  required_not_assessed: number;
  all_required_assessed: boolean;
  all_required_met: boolean;
};
export type CandidateAssessmentSummary = {
  overall: OverallAssessmentSummary;
  categories: CategoryAssessmentSummary[];
};
export type AuditEvent = components["schemas"]["AuditEvent"];
export type StudentListItem = components["schemas"]["StudentList"];
export type StudentDetail = components["schemas"]["Student"];
export type StudentStatus = components["schemas"]["StudentStatusEnum"];
export type Rank = components["schemas"]["Rank"];
export type SyllabusRequirement = components["schemas"]["SyllabusRequirement"];
export type AgeBandEnum = components["schemas"]["AgeBandEnum"];

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
  page?: number;
  page_size?: number;
  status?: string;
  grading_date?: string;
  grading_date_from?: string;
  grading_date_to?: string;
}): Promise<PaginatedResponse<GradingSession>> {
  const searchParams = new URLSearchParams();
  if (params?.page !== undefined) searchParams.set("page", String(params.page));
  if (params?.page_size !== undefined) searchParams.set("page_size", String(params.page_size));
  if (params?.status) searchParams.set("status", params.status);
  if (params?.grading_date) searchParams.set("grading_date", params.grading_date);
  if (params?.grading_date_from) searchParams.set("grading_date_from", params.grading_date_from);
  if (params?.grading_date_to) searchParams.set("grading_date_to", params.grading_date_to);
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<GradingSession>>(
    `/api/gradings/sessions/${query ? `?${query}` : ""}`,
  );
}

export interface CreateGradingSessionPayload {
  title: string;
  grading_date: string;
  status?: GradingSessionStatus;
  location?: string;
  notes?: string;
}

export async function createGradingSession(
  payload: CreateGradingSessionPayload,
): Promise<GradingSession> {
  return apiRequest<GradingSession>("/api/gradings/sessions/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getGradingSession(
  id: number | string,
): Promise<GradingSession> {
  return apiRequest<GradingSession>(`/api/gradings/sessions/${id}/`);
}

export async function updateGradingSession(
  id: number | string,
  payload: Partial<CreateGradingSessionPayload> & { cancellation_reason?: string },
): Promise<GradingSession> {
  return apiRequest<GradingSession>(`/api/gradings/sessions/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteGradingSession(id: number | string): Promise<void> {
  await apiRequest<void>(`/api/gradings/sessions/${id}/`, {
    method: "DELETE",
  });
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

export async function updateGradingCandidate(
  id: number,
  payload: Partial<GradingCandidate>,
): Promise<GradingCandidate> {
  return apiRequest<GradingCandidate>(`/api/gradings/candidates/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export interface BulkCandidateRegistrationPayload {
  session: number;
  candidates: {
    student: number;
    testing_for_rank?: number;
    notes?: string;
  }[];
  generate_assessments?: boolean;
}

export interface BulkCandidateRegistrationResponse {
  created: {
    candidate: GradingCandidate;
    assessment: CandidateAssessment | null;
  }[];
  errors: Record<string, string[]>;
}

export async function bulkRegisterCandidates(
  payload: BulkCandidateRegistrationPayload,
): Promise<BulkCandidateRegistrationResponse> {
  return apiRequest<BulkCandidateRegistrationResponse>(
    "/api/gradings/candidates/bulk-register/",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
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

export async function getCandidateAssessment(id: number): Promise<CandidateAssessment> {
  return apiRequest<CandidateAssessment>(`/api/gradings/assessments/${id}/`);
}

export async function updateCandidateAssessment(
  id: number,
  data: {
    status?: CandidateAssessmentStatus;
    notes?: string;
  },
): Promise<CandidateAssessment> {
  return apiRequest<CandidateAssessment>(`/api/gradings/assessments/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getCandidateAssessmentItems(params?: {
  assessment?: number;
  candidate?: number;
  session?: number;
  category?: string;
  result?: string;
  required?: boolean;
  limit?: number;
  offset?: number;
}): Promise<PaginatedResponse<CandidateAssessmentItem>> {
  const searchParams = new URLSearchParams();
  if (params?.assessment !== undefined) searchParams.set("assessment", String(params.assessment));
  if (params?.candidate !== undefined) searchParams.set("candidate", String(params.candidate));
  if (params?.session !== undefined) searchParams.set("session", String(params.session));
  if (params?.category) searchParams.set("category", params.category);
  if (params?.result) searchParams.set("result", params.result);
  if (params?.required !== undefined) searchParams.set("required", String(params.required));
  if (params?.limit !== undefined) searchParams.set("limit", String(params.limit));
  if (params?.offset !== undefined) searchParams.set("offset", String(params.offset));
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<CandidateAssessmentItem>>(
    `/api/gradings/assessment-items/${query ? `?${query}` : ""}`,
  );
}

export async function updateCandidateAssessmentItem(
  id: number,
  data: {
    result?: CandidateAssessmentItemResult;
    assessor_notes?: string;
  },
): Promise<CandidateAssessmentItem> {
  return apiRequest<CandidateAssessmentItem>(`/api/gradings/assessment-items/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getCandidateOutcomes(params?: {
  session?: number;
  candidate?: number;
}): Promise<PaginatedResponse<CandidateOutcome>> {
  const searchParams = new URLSearchParams();
  if (params?.session !== undefined) searchParams.set("session", String(params.session));
  if (params?.candidate !== undefined) searchParams.set("candidate", String(params.candidate));
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<CandidateOutcome>>(
    `/api/gradings/outcomes/${query ? `?${query}` : ""}`,
  );
}

export async function getCandidateOutcome(id: number): Promise<CandidateOutcome> {
  return apiRequest<CandidateOutcome>(`/api/gradings/outcomes/${id}/`);
}

export async function createCandidateOutcome(candidateId: number): Promise<CandidateOutcome> {
  return apiRequest<CandidateOutcome>(`/api/gradings/candidates/${candidateId}/create-outcome/`, {
    method: "POST",
  });
}

export async function proposeCandidateOutcome(
  outcomeId: number,
  data: {
    proposed_outcome: CandidateOutcomeOutcome;
    proposal_notes?: string;
  },
): Promise<CandidateOutcome> {
  return apiRequest<CandidateOutcome>(`/api/gradings/outcomes/${outcomeId}/propose/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getCandidateAssessmentSummary(
  outcomeId: number,
): Promise<CandidateAssessmentSummary> {
  return apiRequest<CandidateAssessmentSummary>(
    `/api/gradings/outcomes/${outcomeId}/summary/`,
  );
}

export async function finaliseCandidateOutcome(
  outcomeId: number,
  data: {
    final_outcome: "PASS" | "CONDITIONAL" | "FAIL";
    decision_notes?: string;
    conditional_requirements?: string;
  },
): Promise<CandidateOutcome> {
  return apiRequest<CandidateOutcome>(
    `/api/gradings/outcomes/${outcomeId}/finalise/`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
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
  age_band?: string;
  page?: number;
  page_size?: number;
}): Promise<PaginatedResponse<StudentListItem>> {
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set("search", params.search);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.current_rank_code) searchParams.set("current_rank_code", params.current_rank_code);
  if (params?.age_band) searchParams.set("age_band", params.age_band);
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

export async function getSyllabusRequirements(params?: {
  rank_code?: string;
  age_band?: string;
  page_size?: number;
}): Promise<PaginatedResponse<SyllabusRequirement>> {
  const searchParams = new URLSearchParams();
  if (params?.rank_code) searchParams.set("rank_code", params.rank_code);
  if (params?.age_band) searchParams.set("age_band", params.age_band);
  if (params?.page_size !== undefined) searchParams.set("page_size", String(params.page_size));
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<SyllabusRequirement>>(
    `/api/syllabus/requirements/${query ? `?${query}` : ""}`,
  );
}

export async function getStudent(id: number): Promise<StudentDetail> {
  return apiRequest<StudentDetail>(`/api/students/${id}/`);
}

export type CreateStudentPayload = {
  first_name: string;
  last_name: string;
  wksa_id: string;
  date_of_birth: string;
  current_rank: number;
  status?: StudentStatus;
};

export async function createStudent(
  payload: CreateStudentPayload,
): Promise<StudentDetail> {
  return apiRequest<StudentDetail>("/api/students/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export type PromotionRankHistory = {
  id: number;
  from_rank: number;
  from_rank_code: string;
  from_rank_name: string;
  to_rank: number;
  to_rank_code: string;
  to_rank_name: string;
  session: number | null;
  session_title: string;
  grading_date: string;
  outcome: number | null;
  outcome_status: string;
  final_outcome: string;
  promoted_by: string | null;
  promoted_by_email: string;
  promoted_by_name: string;
  promoted_at: string;
  effective_date: string;
  notes: string;
};

export type StudentRankHistory = {
  student: number;
  student_display_name: string;
  student_wksa_id: string;
  current_rank: number;
  current_rank_code: string;
  current_rank_name: string;
  promotions: PromotionRankHistory[];
};

export async function getStudentRankHistory(id: number): Promise<StudentRankHistory> {
  return apiRequest<StudentRankHistory>(`/api/students/${id}/rank-history/`);
}

export type UpdateStudentPayload = {
  first_name?: string;
  last_name?: string;
  date_of_birth?: string;
  current_rank?: number;
  status?: StudentStatus;
};

export async function updateStudent(
  id: number,
  payload: UpdateStudentPayload,
): Promise<StudentDetail> {
  return apiRequest<StudentDetail>(`/api/students/${id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}


