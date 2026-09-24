import type { components } from "./api/schema";

const DEFAULT_API_BASE_URL = "http://localhost:8000";

// Generated from backend/schema.yml (`npm run generate:types`) rather than
// hand-maintained, so these cannot silently drift from the serializers - see
// the 2026-09-14 decision log entry. Regenerate after any serializer change.
// Every request and response body is declared in the schema; the only
// hand-written API shapes are the error envelope and the page envelope.
type Schemas = components["schemas"];
export type AuthUser = components["schemas"]["User"];
export type UserRole = components["schemas"]["RoleEnum"];
export type ManagedUser = Omit<components["schemas"]["UserManagement"], "password">;

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type GradingSession = components["schemas"]["GradingSession"];
export type GradingSessionStatus = components["schemas"]["GradingSessionStatusEnum"];
export type GradingCandidate = Schemas["GradingCandidate"];
export type CandidateAssessment = components["schemas"]["CandidateAssessment"];
export type CandidateAssessmentStatus = components["schemas"]["CandidateAssessmentStatusEnum"];
export type CandidateAssessmentItem = components["schemas"]["CandidateAssessmentItem"];
export type CandidateAssessmentItemResult = components["schemas"]["ResultEnum"];
export type CandidateOutcome = components["schemas"]["CandidateOutcome"];
export type CandidateOutcomeOutcome = components["schemas"]["CandidateOutcomeOutcomeEnum"];
export type Promotion = components["schemas"]["Promotion"];
export type CandidateAssessmentSummary = Schemas["CandidateAssessmentSummary"];
export type AuditEvent = components["schemas"]["AuditEvent"];
export type AuditAction = components["schemas"]["ActionEnum"];
export type StudentListItem = components["schemas"]["StudentList"];
export type StudentDetail = components["schemas"]["Student"];
export type StudentStatus = components["schemas"]["StudentStatusEnum"];
export type Rank = components["schemas"]["Rank"];
export type SyllabusItem = components["schemas"]["SyllabusItem"];
export type EffectiveSyllabusRequirement =
  components["schemas"]["EffectiveSyllabusRequirement"];
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

/** The best single message for a failed request, or `fallback`. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return err.nonFieldMessages[0] || err.message || fallback;
  }
  return fallback;
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

  // A FormData body (file upload) must keep the browser's own multipart
  // boundary in Content-Type - setting it to application/json here would
  // silently break every multipart upload.
  if (
    !headers.has("Content-Type") &&
    init.body !== undefined &&
    !(init.body instanceof FormData)
  ) {
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

async function collectAllPages<T>(
  loadPage: (page: number) => Promise<PaginatedResponse<T>>,
): Promise<PaginatedResponse<T>> {
  const results: T[] = [];
  let page = 1;
  let total = 0;

  for (;;) {
    const response = await loadPage(page);
    total = response.count;
    results.push(...response.results);
    if (!response.next) break;
    page += 1;
  }

  return { count: total, next: null, previous: null, results };
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

export async function getManagedUsers(params?: {
  search?: string;
  role?: UserRole;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}): Promise<PaginatedResponse<ManagedUser>> {
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set("search", params.search);
  if (params?.role) searchParams.set("role", params.role);
  if (params?.is_active !== undefined) {
    searchParams.set("is_active", String(params.is_active));
  }
  if (params?.page !== undefined) searchParams.set("page", String(params.page));
  if (params?.page_size !== undefined) {
    searchParams.set("page_size", String(params.page_size));
  }
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<ManagedUser>>(
    `/api/users/${query ? `?${query}` : ""}`,
  );
}

export async function getManagedUser(id: string): Promise<ManagedUser> {
  return apiRequest<ManagedUser>(`/api/users/${id}/`);
}

export type CreateManagedUserPayload = {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
  role?: UserRole;
  is_active?: boolean;
};

export async function createManagedUser(
  data: CreateManagedUserPayload,
): Promise<ManagedUser> {
  return apiRequest<ManagedUser>("/api/users/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteManagedUser(id: string): Promise<void> {
  await apiRequest<void>(`/api/users/${id}/`, {
    method: "DELETE",
  });
}

export async function updateManagedUser(
  id: string,
  data: Partial<
    Pick<ManagedUser, "email" | "first_name" | "last_name" | "role" | "is_active">
  >,
): Promise<ManagedUser> {
  return apiRequest<ManagedUser>(`/api/users/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export type UserAuthorityPayload = {
  can_make_final_grading_decision?: boolean;
  can_promote_student?: boolean;
  can_override_locked_session?: boolean;
  can_view_grading_audit_log?: boolean;
};

export async function updateManagedUserAuthority(
  id: string,
  data: UserAuthorityPayload,
): Promise<ManagedUser> {
  return apiRequest<ManagedUser>(`/api/users/${id}/authority/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function resetManagedUserPassword(
  id: string,
  password: string,
): Promise<void> {
  await apiRequest<void>(`/api/users/${id}/set-password/`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export type GradingSessionListParams = {
  page?: number;
  page_size?: number;
  status?: string;
  search?: string;
  grading_date?: string;
  grading_date_from?: string;
  grading_date_to?: string;
};

export async function getGradingSessions(
  params?: GradingSessionListParams,
): Promise<PaginatedResponse<GradingSession>> {
  const searchParams = new URLSearchParams();
  if (params?.page !== undefined) searchParams.set("page", String(params.page));
  if (params?.page_size !== undefined) searchParams.set("page_size", String(params.page_size));
  if (params?.status) searchParams.set("status", params.status);
  if (params?.search) searchParams.set("search", params.search);
  if (params?.grading_date) searchParams.set("grading_date", params.grading_date);
  if (params?.grading_date_from) searchParams.set("grading_date_from", params.grading_date_from);
  if (params?.grading_date_to) searchParams.set("grading_date_to", params.grading_date_to);
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<GradingSession>>(
    `/api/gradings/sessions/${query ? `?${query}` : ""}`,
  );
}

export async function getAllGradingSessions(
  params: Omit<GradingSessionListParams, "page" | "page_size"> = {},
): Promise<PaginatedResponse<GradingSession>> {
  return collectAllPages((page) =>
    getGradingSessions({ ...params, page, page_size: 200 }),
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

export type GradingCandidateListParams = {
  session?: number;
  student_wksa_id?: string;
  page?: number;
  page_size?: number;
};

export async function getGradingCandidates(
  params?: GradingCandidateListParams,
): Promise<PaginatedResponse<GradingCandidate>> {
  const searchParams = new URLSearchParams();
  if (params?.session !== undefined) searchParams.set("session", String(params.session));
  if (params?.student_wksa_id) searchParams.set("student_wksa_id", params.student_wksa_id);
  if (params?.page !== undefined) searchParams.set("page", String(params.page));
  if (params?.page_size !== undefined) searchParams.set("page_size", String(params.page_size));
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<GradingCandidate>>(
    `/api/gradings/candidates/${query ? `?${query}` : ""}`,
  );
}

export async function getAllGradingCandidates(
  params: Omit<GradingCandidateListParams, "page" | "page_size"> = {},
): Promise<PaginatedResponse<GradingCandidate>> {
  return collectAllPages((page) =>
    getGradingCandidates({ ...params, page, page_size: 200 }),
  );
}


export type BulkCandidateRegistrationPayload = Schemas["BulkCandidateRegistration"];
export type BulkCandidateRegistrationResponse =
  Schemas["BulkCandidateRegistrationResult"];

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

export async function generateCandidateAssessment(
  candidateId: number,
): Promise<CandidateAssessment> {
  return apiRequest<CandidateAssessment>(
    `/api/gradings/candidates/${candidateId}/generate-assessment/`,
    { method: "POST" },
  );
}

export async function bulkGenerateCandidateAssessments(
  candidateIds: number[],
): Promise<Schemas["BulkAssessmentGenerationResult"]> {
  return apiRequest("/api/gradings/candidates/bulk-generate-assessments/", {
    method: "POST",
    body: JSON.stringify({ candidates: candidateIds }),
  });
}

export async function bulkUpdateCandidateStatus(
  candidateIds: number[],
  status: GradingCandidate["status"],
): Promise<Schemas["BulkCandidateStatusUpdateResult"]> {
  return apiRequest("/api/gradings/candidates/bulk-update-status/", {
    method: "POST",
    body: JSON.stringify({ candidates: candidateIds, status }),
  });
}

export type LockedCandidateWithdrawal =
  components["schemas"]["LockedCandidateWithdrawal"];

export async function withdrawLockedCandidate(
  candidateId: number,
  payload: LockedCandidateWithdrawal,
): Promise<GradingCandidate> {
  return apiRequest<GradingCandidate>(
    `/api/gradings/candidates/${candidateId}/withdraw/`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export type CandidateAssessmentListParams = {
  session?: number;
  candidate?: number;
  status?: string;
  page?: number;
  page_size?: number;
};

export async function getCandidateAssessments(
  params?: CandidateAssessmentListParams,
): Promise<PaginatedResponse<CandidateAssessment>> {
  const searchParams = new URLSearchParams();
  if (params?.session !== undefined) searchParams.set("session", String(params.session));
  if (params?.candidate !== undefined) searchParams.set("candidate", String(params.candidate));
  if (params?.status) searchParams.set("status", params.status);
  if (params?.page !== undefined) searchParams.set("page", String(params.page));
  if (params?.page_size !== undefined) searchParams.set("page_size", String(params.page_size));
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<CandidateAssessment>>(
    `/api/gradings/assessments/${query ? `?${query}` : ""}`,
  );
}

export async function getAllCandidateAssessments(
  params: Omit<CandidateAssessmentListParams, "page" | "page_size"> = {},
): Promise<PaginatedResponse<CandidateAssessment>> {
  return collectAllPages((page) =>
    getCandidateAssessments({ ...params, page, page_size: 200 }),
  );
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

export async function deleteCandidateAssessment(id: number): Promise<void> {
  await apiRequest<void>(`/api/gradings/assessments/${id}/`, {
    method: "DELETE",
  });
}

export async function bulkStartCandidateAssessments(
  assessmentIds: number[],
): Promise<Schemas["BulkAssessmentStartResult"]> {
  return apiRequest("/api/gradings/assessments/bulk-start/", {
    method: "POST",
    body: JSON.stringify({ assessments: assessmentIds }),
  });
}

export type CandidateAssessmentItemListParams = {
  assessment?: number;
  candidate?: number;
  session?: number;
  category?: string;
  result?: string;
  required?: boolean;
  page?: number;
  page_size?: number;
};

export async function getCandidateAssessmentItems(
  params?: CandidateAssessmentItemListParams,
): Promise<PaginatedResponse<CandidateAssessmentItem>> {
  const searchParams = new URLSearchParams();
  if (params?.assessment !== undefined) searchParams.set("assessment", String(params.assessment));
  if (params?.candidate !== undefined) searchParams.set("candidate", String(params.candidate));
  if (params?.session !== undefined) searchParams.set("session", String(params.session));
  if (params?.category) searchParams.set("category", params.category);
  if (params?.result) searchParams.set("result", params.result);
  if (params?.required !== undefined) searchParams.set("required", String(params.required));
  if (params?.page !== undefined) searchParams.set("page", String(params.page));
  if (params?.page_size !== undefined) searchParams.set("page_size", String(params.page_size));
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<CandidateAssessmentItem>>(
    `/api/gradings/assessment-items/${query ? `?${query}` : ""}`,
  );
}

export async function getAllCandidateAssessmentItems(
  params: Omit<CandidateAssessmentItemListParams, "page" | "page_size"> = {},
): Promise<PaginatedResponse<CandidateAssessmentItem>> {
  return collectAllPages((page) =>
    getCandidateAssessmentItems({ ...params, page, page_size: 200 }),
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

export type CandidateOutcomeListParams = {
  session?: number;
  candidate?: number;
  page?: number;
  page_size?: number;
};

export async function getCandidateOutcomes(
  params?: CandidateOutcomeListParams,
): Promise<PaginatedResponse<CandidateOutcome>> {
  const searchParams = new URLSearchParams();
  if (params?.session !== undefined) searchParams.set("session", String(params.session));
  if (params?.candidate !== undefined) searchParams.set("candidate", String(params.candidate));
  if (params?.page !== undefined) searchParams.set("page", String(params.page));
  if (params?.page_size !== undefined) searchParams.set("page_size", String(params.page_size));
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<CandidateOutcome>>(
    `/api/gradings/outcomes/${query ? `?${query}` : ""}`,
  );
}

export async function getAllCandidateOutcomes(
  params: Omit<CandidateOutcomeListParams, "page" | "page_size"> = {},
): Promise<PaginatedResponse<CandidateOutcome>> {
  return collectAllPages((page) =>
    getCandidateOutcomes({ ...params, page, page_size: 200 }),
  );
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
  page?: number;
  page_size?: number;
  action?: AuditAction;
  entity_type?: string;
  entity_id?: string;
  actor?: string;
  occurred_from?: string;
  occurred_to?: string;
  search?: string;
}): Promise<PaginatedResponse<AuditEvent>> {
  const searchParams = new URLSearchParams();
  if (params?.page !== undefined) searchParams.set("page", String(params.page));
  if (params?.page_size !== undefined) searchParams.set("page_size", String(params.page_size));
  if (params?.action) searchParams.set("action", params.action);
  if (params?.entity_type) searchParams.set("entity_type", params.entity_type);
  if (params?.entity_id) searchParams.set("entity_id", params.entity_id);
  if (params?.actor) searchParams.set("actor", params.actor);
  if (params?.occurred_from) searchParams.set("occurred_from", params.occurred_from);
  if (params?.occurred_to) searchParams.set("occurred_to", params.occurred_to);
  if (params?.search) searchParams.set("search", params.search);
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

export async function getAllStudents(
  params: Omit<NonNullable<Parameters<typeof getStudents>[0]>, "page" | "page_size"> = {},
): Promise<PaginatedResponse<StudentListItem>> {
  return collectAllPages((page) => getStudents({ ...params, page, page_size: 200 }));
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


export async function getSyllabusItems(params?: {
  page_size?: number;
}): Promise<PaginatedResponse<SyllabusItem>> {
  const searchParams = new URLSearchParams();
  if (params?.page_size !== undefined) searchParams.set("page_size", String(params.page_size));
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<SyllabusItem>>(
    `/api/syllabus/items/${query ? `?${query}` : ""}`,
  );
}

export async function getEffectiveSyllabusRequirements(params: {
  rank_code: string;
  age_band: string;
  page?: number;
  page_size?: number;
}): Promise<PaginatedResponse<EffectiveSyllabusRequirement>> {
  const searchParams = new URLSearchParams();
  searchParams.set("rank_code", params.rank_code);
  searchParams.set("age_band", params.age_band);
  if (params.page !== undefined) searchParams.set("page", String(params.page));
  searchParams.set("page_size", String(params.page_size ?? 200));
  return apiRequest<PaginatedResponse<EffectiveSyllabusRequirement>>(
    `/api/syllabus/requirements/effective/?${searchParams.toString()}`,
  );
}

export async function getAllEffectiveSyllabusRequirements(
  params: Omit<Parameters<typeof getEffectiveSyllabusRequirements>[0], "page" | "page_size">,
): Promise<PaginatedResponse<EffectiveSyllabusRequirement>> {
  return collectAllPages((page) =>
    getEffectiveSyllabusRequirements({ ...params, page, page_size: 200 }),
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

export type StudentRankHistory = Schemas["StudentRankHistory"];

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

export async function deleteStudent(id: number): Promise<void> {
  await apiRequest<void>(`/api/students/${id}/`, {
    method: "DELETE",
  });
}

export async function getPromotions(params?: {
  session?: number;
  student?: number;
  page?: number;
  page_size?: number;
}): Promise<PaginatedResponse<Promotion>> {
  const query = new URLSearchParams();
  if (params?.session !== undefined) query.set("session", String(params.session));
  if (params?.student !== undefined) query.set("student", String(params.student));
  if (params?.page !== undefined) query.set("page", String(params.page));
  if (params?.page_size !== undefined) query.set("page_size", String(params.page_size));
  const qs = query.toString();
  return apiRequest<PaginatedResponse<Promotion>>(
    `/api/gradings/promotions/${qs ? `?${qs}` : ""}`,
  );
}

export async function getAllPromotions(
  params: { session?: number; student?: number } = {},
): Promise<PaginatedResponse<Promotion>> {
  return collectAllPages((page) =>
    getPromotions({ ...params, page, page_size: 200 }),
  );
}

export async function promoteCandidateOutcome(
  outcomeId: number,
  data?: { notes?: string },
): Promise<Promotion> {
  return apiRequest<Promotion>(`/api/gradings/outcomes/${outcomeId}/promote/`, {
    method: "POST",
    body: JSON.stringify(data || {}),
  });
}

export type BulkPromoteResponse = Schemas["BulkPromotionResult"];

export async function bulkPromoteCandidateOutcomes(
  data: { outcomes: number[] },
): Promise<BulkPromoteResponse> {
  return apiRequest<BulkPromoteResponse>(
    `/api/gradings/outcomes/bulk-promote/`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
  );
}

export type DataImportKind = Schemas["KindEnum"];
export type DataImportBatch = Schemas["ImportBatch"];
export type CreateDataImportBatchResponse = Schemas["ImportBatchCreated"];

export async function createDataImportBatch(
  file: File,
  kind: DataImportKind = "STUDENT_ROSTER",
): Promise<CreateDataImportBatchResponse> {
  const formData = new FormData();
  formData.append("kind", kind);
  formData.append("file", file);
  return apiRequest<CreateDataImportBatchResponse>("/api/data-imports/batches/", {
    method: "POST",
    body: formData,
  });
}

export type StudentImportRowResult = Schemas["StudentImportRowResult"];
export type StudentImportPreview = Schemas["StudentImportPreview"];
export type StudentImportRowCorrection = Partial<
  Record<
    "wksa_id" | "first_name" | "last_name" | "date_of_birth" | "current_rank" | "status",
    string
  >
>;
export type StudentImportRequestPayload = Schemas["StudentImportRequest"];

export async function previewStudentImport(
  batchId: number,
  payload: StudentImportRequestPayload,
): Promise<StudentImportPreview> {
  return apiRequest<StudentImportPreview>(
    `/api/data-imports/batches/${batchId}/preview/`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function commitStudentImport(
  batchId: number,
  payload: StudentImportRequestPayload,
): Promise<DataImportBatch> {
  return apiRequest<DataImportBatch>(
    `/api/data-imports/batches/${batchId}/commit/`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function cancelDataImportBatch(batchId: number): Promise<void> {
  return apiRequest<void>(`/api/data-imports/batches/${batchId}/cancel/`, {
    method: "POST",
  });
}

export type LegacyRecordKind = Schemas["RecordKindEnum"];
export type RankMappingSuggestion = Schemas["RankMappingSuggestion"];
export type LegacyImportPreview = Schemas["LegacyImportPreview"];
export type LegacyImportRequestPayload = Schemas["LegacyImportRequest"];

export async function previewLegacyGradingImport(
  batchId: number,
  payload: LegacyImportRequestPayload,
): Promise<LegacyImportPreview> {
  return apiRequest<LegacyImportPreview>(
    `/api/data-imports/batches/${batchId}/preview/`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function commitLegacyGradingImport(
  batchId: number,
  payload: LegacyImportRequestPayload,
): Promise<DataImportBatch> {
  return apiRequest<DataImportBatch>(
    `/api/data-imports/batches/${batchId}/commit/`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export type LegacyGradingRecord = Schemas["LegacyGradingRecord"];

export async function getLegacyGradingRecords(params?: {
  student?: number;
  linked?: boolean;
  voided?: boolean;
  record_kind?: LegacyRecordKind;
  source_batch?: number;
  page?: number;
  page_size?: number;
}): Promise<PaginatedResponse<LegacyGradingRecord>> {
  const searchParams = new URLSearchParams();
  if (params?.student !== undefined) searchParams.set("student", String(params.student));
  if (params?.linked !== undefined) searchParams.set("linked", String(params.linked));
  if (params?.voided !== undefined) searchParams.set("voided", String(params.voided));
  if (params?.record_kind) searchParams.set("record_kind", params.record_kind);
  if (params?.source_batch !== undefined) {
    searchParams.set("source_batch", String(params.source_batch));
  }
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.page_size) searchParams.set("page_size", String(params.page_size));
  const query = searchParams.toString();
  return apiRequest<PaginatedResponse<LegacyGradingRecord>>(
    `/api/gradings/legacy-records/${query ? `?${query}` : ""}`,
  );
}


export async function linkLegacyGradingRecord(
  id: number,
  studentId: number,
): Promise<LegacyGradingRecord> {
  return apiRequest<LegacyGradingRecord>(
    `/api/gradings/legacy-records/${id}/link-student/`,
    {
      method: "POST",
      body: JSON.stringify({ student: studentId }),
    },
  );
}

export async function unlinkLegacyGradingRecord(id: number): Promise<LegacyGradingRecord> {
  return apiRequest<LegacyGradingRecord>(
    `/api/gradings/legacy-records/${id}/unlink-student/`,
    { method: "POST" },
  );
}

export async function resolveLegacyCurrentRank(
  id: number,
  rankId: number | null,
): Promise<LegacyGradingRecord> {
  return apiRequest<LegacyGradingRecord>(
    `/api/gradings/legacy-records/${id}/resolve-current-rank/`,
    {
      method: "POST",
      body: JSON.stringify({ rank: rankId }),
    },
  );
}

export async function resolveLegacyTestingForRank(
  id: number,
  rankId: number | null,
): Promise<LegacyGradingRecord> {
  return apiRequest<LegacyGradingRecord>(
    `/api/gradings/legacy-records/${id}/resolve-testing-for-rank/`,
    {
      method: "POST",
      body: JSON.stringify({ rank: rankId }),
    },
  );
}

export async function voidLegacyGradingRecord(
  id: number,
  reason: string,
): Promise<LegacyGradingRecord> {
  return apiRequest<LegacyGradingRecord>(`/api/gradings/legacy-records/${id}/void/`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export type GradingHistoryItem = Schemas["GradingHistoryItem"];
export type StudentGradingHistory = Schemas["StudentGradingHistory"];

export async function getStudentGradingHistory(
  studentId: number,
): Promise<StudentGradingHistory> {
  return apiRequest<StudentGradingHistory>(
    `/api/students/${studentId}/grading-history/`,
  );
}
