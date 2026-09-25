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
export type CategoryAssessmentSummary = Schemas["AssessmentCategorySummary"];
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
 * The error envelope is hand-written: `custom_exception_handler` builds it
 * outside DRF's serializer path, so the schema documents only 2xx responses.
 *
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

/** `path` with every present parameter appended; empty values are omitted. */
function withQuery(path: string, params: object = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
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
  return apiRequest<PaginatedResponse<ManagedUser>>(
    withQuery("/api/users/", params),
  );
}

export async function getManagedUser(id: string): Promise<ManagedUser> {
  return apiRequest<ManagedUser>(`/api/users/${id}/`);
}

export type CreateManagedUserPayload = Schemas["UserManagementRequest"];

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
  data: Schemas["PatchedUserManagementRequest"],
): Promise<ManagedUser> {
  return apiRequest<ManagedUser>(`/api/users/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export type UserAuthorityPayload = Schemas["PatchedUserAuthorityRequest"];

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
  return apiRequest<PaginatedResponse<GradingSession>>(
    withQuery("/api/gradings/sessions/", params),
  );
}

export async function getAllGradingSessions(
  params: Omit<GradingSessionListParams, "page" | "page_size"> = {},
): Promise<PaginatedResponse<GradingSession>> {
  return collectAllPages((page) =>
    getGradingSessions({ ...params, page, page_size: 200 }),
  );
}

export type CreateGradingSessionPayload = Schemas["GradingSessionRequest"];

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
  payload: Schemas["PatchedGradingSessionRequest"],
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
  return apiRequest<PaginatedResponse<GradingCandidate>>(
    withQuery("/api/gradings/candidates/", params),
  );
}

export async function getAllGradingCandidates(
  params: Omit<GradingCandidateListParams, "page" | "page_size"> = {},
): Promise<PaginatedResponse<GradingCandidate>> {
  return collectAllPages((page) =>
    getGradingCandidates({ ...params, page, page_size: 200 }),
  );
}

export type BulkCandidateRegistrationPayload = Schemas["BulkCandidateRegistrationRequest"];
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
  Schemas["LockedCandidateWithdrawalRequest"];

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
  return apiRequest<PaginatedResponse<CandidateAssessment>>(
    withQuery("/api/gradings/assessments/", params),
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
  return apiRequest<PaginatedResponse<CandidateAssessmentItem>>(
    withQuery("/api/gradings/assessment-items/", params),
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
  return apiRequest<PaginatedResponse<CandidateOutcome>>(
    withQuery("/api/gradings/outcomes/", params),
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

/**
 * Rollup for one assessment, reachable at any assessment status.
 *
 * `getCandidateAssessmentSummary` goes via the outcome, which cannot exist
 * until the session is `LOCKED` and the assessment `COMPLETED`. Scoring and
 * completion review need the same counts before that point. See FDR-046.
 */
export async function getAssessmentSummary(
  assessmentId: number,
): Promise<CandidateAssessmentSummary> {
  return apiRequest<CandidateAssessmentSummary>(
    `/api/gradings/assessments/${assessmentId}/summary/`,
  );
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
  return apiRequest<PaginatedResponse<AuditEvent>>(
    withQuery("/api/audit-events/", params),
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
  return apiRequest<PaginatedResponse<StudentListItem>>(
    withQuery("/api/students/", params),
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
  return apiRequest<PaginatedResponse<Rank>>(
    withQuery("/api/ranks/", params),
  );
}

export async function getSyllabusItems(params?: {
  page_size?: number;
}): Promise<PaginatedResponse<SyllabusItem>> {
  return apiRequest<PaginatedResponse<SyllabusItem>>(
    withQuery("/api/syllabus/items/", params),
  );
}

export async function getEffectiveSyllabusRequirements(params: {
  rank_code: string;
  age_band: string;
  page?: number;
  page_size?: number;
}): Promise<PaginatedResponse<EffectiveSyllabusRequirement>> {
  return apiRequest<PaginatedResponse<EffectiveSyllabusRequirement>>(
    withQuery("/api/syllabus/requirements/effective/", {
      ...params,
      page_size: params.page_size ?? 200,
    }),
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

export type CreateStudentPayload = Schemas["StudentRequest"];

export async function createStudent(
  payload: CreateStudentPayload,
): Promise<StudentDetail> {
  return apiRequest<StudentDetail>("/api/students/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type StudentRankHistory = Schemas["StudentRankHistory"];

export async function getStudentRankHistory(id: number): Promise<StudentRankHistory> {
  return apiRequest<StudentRankHistory>(`/api/students/${id}/rank-history/`);
}

export type UpdateStudentPayload = Schemas["PatchedStudentRequest"];

export async function updateStudent(
  id: number,
  payload: UpdateStudentPayload,
): Promise<StudentDetail> {
  return apiRequest<StudentDetail>(`/api/students/${id}/`, {
    method: "PATCH",
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
  return apiRequest<PaginatedResponse<Promotion>>(
    withQuery("/api/gradings/promotions/", params),
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
  return apiRequest<PaginatedResponse<LegacyGradingRecord>>(
    withQuery("/api/gradings/legacy-records/", params),
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
