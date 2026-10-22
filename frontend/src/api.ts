import type { components, operations } from "./api/schema";

const DEFAULT_API_BASE_URL = "http://localhost:8000";

// Generated from backend/schema.yml (`npm run generate:types`) rather than
// hand-maintained, so these cannot silently drift from the serializers - see
// the 2026-09-14 decision log entry. Regenerate after any serializer change.
// Every request and response body is declared in the schema; the only
// hand-written API shapes are the error envelope and the page envelope.
type Schemas = components["schemas"];
/** A list endpoint's query parameters, as its schema declares them. */
type ListQuery<Op extends keyof operations> = NonNullable<operations[Op]["parameters"]["query"]>;
export type AuthUser = components["schemas"]["User"];
export type UserRole = components["schemas"]["RoleEnum"];
export type ManagedUser = components["schemas"]["UserManagement"];
/** A managed user with the temporary password just issued for them, shown once. */
export type IssuedTemporaryPassword = components["schemas"]["IssuedTemporaryPassword"];

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
export type CandidateAssessmentItem = components["schemas"]["CandidateAssessmentItem"];
export type CandidateAssessmentItemResult = components["schemas"]["ResultEnum"];
export type CandidateOutcome = components["schemas"]["CandidateOutcome"];
export type CandidateOutcomeOutcome = components["schemas"]["CandidateOutcomeOutcomeEnum"];
export type Promotion = components["schemas"]["Promotion"];
export type CategoryAssessmentSummary = Schemas["AssessmentCategorySummary"];
export type CandidateAssessmentSummary = Schemas["CandidateAssessmentSummary"];
export type AuditEvent = components["schemas"]["AuditEvent"];
export type AuditAction = components["schemas"]["ActionEnum"];
export type AuditEntity = components["schemas"]["AuditEntityEnum"];
export type StudentListItem = components["schemas"]["StudentList"];
export type StudentDetail = components["schemas"]["Student"];
export type StudentStatus = components["schemas"]["StudentStatusEnum"];
export type Rank = components["schemas"]["Rank"];
export type EffectiveSyllabusRequirement =
  components["schemas"]["EffectiveSyllabusRequirement"];
export type AgeBandEnum = components["schemas"]["AgeBandEnum"];
export type AgeBand = components["schemas"]["AgeBand"];
export type Programme = components["schemas"]["ProgrammeEnum"];

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

type ApiErrorBody = {
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
    let message = "Something went wrong. Try again in a moment.";
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

export type SiteSettings = Schemas["SiteSettings"];

export async function getSiteSettings(): Promise<SiteSettings> {
  return apiRequest<SiteSettings>("/api/site/");
}

export type About = Schemas["About"];

export async function getAbout(): Promise<About> {
  return apiRequest<About>("/api/about/");
}

export async function getCurrentUser(): Promise<AuthUser> {
  return apiRequest<AuthUser>("/api/auth/me/");
}

export type SelfProfilePayload = Schemas["PatchedSelfProfileRequest"];

/** Your own first and last name - the only things a user edits about themselves. */
export async function updateCurrentUser(data: SelfProfilePayload): Promise<AuthUser> {
  return apiRequest<AuthUser>("/api/auth/me/", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
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

export type SetupDetails = Schemas["SetupRequest"];

/** Whether the deployment still needs its first administrator. */
export async function getSetupStatus(): Promise<Schemas["SetupStatus"]> {
  return apiRequest<Schemas["SetupStatus"]>("/api/setup/");
}

/** Create the first administrator and sign them in. */
export async function completeSetup(details: SetupDetails): Promise<AuthUser> {
  return apiRequest<AuthUser>("/api/setup/", {
    method: "POST",
    body: JSON.stringify(details),
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

export async function getManagedUsers(params?: ListQuery<"users_list">): Promise<PaginatedResponse<ManagedUser>> {
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
): Promise<IssuedTemporaryPassword> {
  return apiRequest<IssuedTemporaryPassword>("/api/users/", {
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

export async function resetManagedUserPassword(id: string): Promise<IssuedTemporaryPassword> {
  return apiRequest<IssuedTemporaryPassword>(`/api/users/${id}/set-password/`, {
    method: "POST",
  });
}

export async function getGradingSessions(
  params?: ListQuery<"gradings_sessions_list">,
): Promise<PaginatedResponse<GradingSession>> {
  return apiRequest<PaginatedResponse<GradingSession>>(
    withQuery("/api/gradings/sessions/", params),
  );
}

export async function getAllGradingSessions(
  params: Omit<ListQuery<"gradings_sessions_list">, "page" | "page_size"> = {},
): Promise<PaginatedResponse<GradingSession>> {
  return collectAllPages((page) =>
    getGradingSessions({ ...params, page, page_size: 200 }),
  );
}

export async function getGradingSessionYears(): Promise<number[]> {
  const body = await apiRequest<Schemas["GradingYears"]>(
    "/api/gradings/sessions/years/",
  );
  return body.years;
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

async function getGradingCandidates(
  params?: ListQuery<"gradings_candidates_list">,
): Promise<PaginatedResponse<GradingCandidate>> {
  return apiRequest<PaginatedResponse<GradingCandidate>>(
    withQuery("/api/gradings/candidates/", params),
  );
}

export async function getGradingCandidate(id: number): Promise<GradingCandidate> {
  return apiRequest<GradingCandidate>(`/api/gradings/candidates/${id}/`);
}

export async function getAllGradingCandidates(
  params: Omit<ListQuery<"gradings_candidates_list">, "page" | "page_size"> = {},
): Promise<PaginatedResponse<GradingCandidate>> {
  return collectAllPages((page) =>
    getGradingCandidates({ ...params, page, page_size: 200 }),
  );
}

/** Move a registration to another draft or open session. */
export async function moveGradingCandidate(
  id: number,
  sessionId: number,
): Promise<GradingCandidate> {
  return apiRequest<GradingCandidate>(`/api/gradings/candidates/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({ session: sessionId }),
  });
}

/** Remove a registration while its session is draft or open. */
export async function deleteGradingCandidate(id: number): Promise<void> {
  await apiRequest<void>(`/api/gradings/candidates/${id}/`, {
    method: "DELETE",
  });
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
  payload: Schemas["BulkCandidateStatusUpdateRequest"],
): Promise<Schemas["BulkCandidateStatusUpdateResult"]> {
  return apiRequest("/api/gradings/candidates/bulk-update-status/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type WithdrawalReason = Schemas["WithdrawalReason"];

export async function getWithdrawalReasons(): Promise<PaginatedResponse<WithdrawalReason>> {
  return apiRequest<PaginatedResponse<WithdrawalReason>>("/api/gradings/withdrawal-reasons/");
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

export async function getCandidateAssessments(
  params?: ListQuery<"gradings_assessments_list">,
): Promise<PaginatedResponse<CandidateAssessment>> {
  return apiRequest<PaginatedResponse<CandidateAssessment>>(
    withQuery("/api/gradings/assessments/", params),
  );
}

export async function getAllCandidateAssessments(
  params: Omit<ListQuery<"gradings_assessments_list">, "page" | "page_size"> = {},
): Promise<PaginatedResponse<CandidateAssessment>> {
  return collectAllPages((page) =>
    getCandidateAssessments({ ...params, page, page_size: 200 }),
  );
}

export async function updateCandidateAssessment(
  id: number,
  data: Schemas["PatchedCandidateAssessmentRequest"],
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

async function getCandidateAssessmentItems(
  params?: ListQuery<"gradings_assessment_items_list">,
): Promise<PaginatedResponse<CandidateAssessmentItem>> {
  return apiRequest<PaginatedResponse<CandidateAssessmentItem>>(
    withQuery("/api/gradings/assessment-items/", params),
  );
}

export async function getAllCandidateAssessmentItems(
  params: Omit<ListQuery<"gradings_assessment_items_list">, "page" | "page_size"> = {},
): Promise<PaginatedResponse<CandidateAssessmentItem>> {
  return collectAllPages((page) =>
    getCandidateAssessmentItems({ ...params, page, page_size: 200 }),
  );
}

/** Returns a completed assessment to in-progress while its session is open. */
export async function reopenCandidateAssessment(id: number): Promise<CandidateAssessment> {
  return apiRequest<CandidateAssessment>(`/api/gradings/assessments/${id}/reopen/`, {
    method: "POST",
  });
}

export async function updateCandidateAssessmentItem(
  id: number,
  data: Schemas["PatchedCandidateAssessmentItemRequest"],
): Promise<CandidateAssessmentItem> {
  return apiRequest<CandidateAssessmentItem>(`/api/gradings/assessment-items/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

async function getCandidateOutcomes(
  params?: ListQuery<"gradings_outcomes_list">,
): Promise<PaginatedResponse<CandidateOutcome>> {
  return apiRequest<PaginatedResponse<CandidateOutcome>>(
    withQuery("/api/gradings/outcomes/", params),
  );
}

export async function getAllCandidateOutcomes(
  params: Omit<ListQuery<"gradings_outcomes_list">, "page" | "page_size"> = {},
): Promise<PaginatedResponse<CandidateOutcome>> {
  return collectAllPages((page) =>
    getCandidateOutcomes({ ...params, page, page_size: 200 }),
  );
}

export type PromotionEligibility = Schemas["PromotionEligibility"];

export async function getPromotionEligibility(session: number): Promise<PromotionEligibility[]> {
  return apiRequest<PromotionEligibility[]>(
    withQuery("/api/gradings/outcomes/promotion-eligibility/", { session }),
  );
}

export async function createCandidateOutcome(candidateId: number): Promise<CandidateOutcome> {
  return apiRequest<CandidateOutcome>(`/api/gradings/candidates/${candidateId}/create-outcome/`, {
    method: "POST",
  });
}

export async function proposeCandidateOutcome(
  outcomeId: number,
  data: Schemas["PatchedCandidateOutcomeProposalRequest"],
): Promise<CandidateOutcome> {
  return apiRequest<CandidateOutcome>(`/api/gradings/outcomes/${outcomeId}/propose/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/**
 * Rollup for one assessment, reachable at any assessment status - scoring,
 * completion review and the adjudication board all read counts from here
 * (FDR-046).
 */
export async function getAssessmentSummary(
  assessmentId: number,
): Promise<CandidateAssessmentSummary> {
  return apiRequest<CandidateAssessmentSummary>(
    `/api/gradings/assessments/${assessmentId}/summary/`,
  );
}

export async function finaliseCandidateOutcome(
  outcomeId: number,
  data: Schemas["PatchedCandidateOutcomeFinaliseRequest"],
): Promise<CandidateOutcome> {
  return apiRequest<CandidateOutcome>(
    `/api/gradings/outcomes/${outcomeId}/finalise/`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
  );
}

/** The names of the audit event and record types, for the audit filters. */
export async function getAuditLabels(): Promise<Schemas["AuditLabels"]> {
  return apiRequest<Schemas["AuditLabels"]>("/api/audit-events/labels/");
}

export async function getAuditEvents(params?: ListQuery<"audit_events_list">): Promise<PaginatedResponse<AuditEvent>> {
  return apiRequest<PaginatedResponse<AuditEvent>>(
    withQuery("/api/audit-events/", params),
  );
}

export async function getStudents(params?: ListQuery<"students_list">): Promise<PaginatedResponse<StudentListItem>> {
  return apiRequest<PaginatedResponse<StudentListItem>>(
    withQuery("/api/students/", params),
  );
}

export async function getAllStudents(
  params: Omit<NonNullable<Parameters<typeof getStudents>[0]>, "page" | "page_size"> = {},
): Promise<PaginatedResponse<StudentListItem>> {
  return collectAllPages((page) => getStudents({ ...params, page, page_size: 200 }));
}

export async function getRanks(params?: ListQuery<"ranks_list">): Promise<PaginatedResponse<Rank>> {
  return apiRequest<PaginatedResponse<Rank>>(
    withQuery("/api/ranks/", params),
  );
}

export async function getAgeBands(): Promise<PaginatedResponse<AgeBand>> {
  return apiRequest<PaginatedResponse<AgeBand>>("/api/syllabus/age-bands/");
}

async function getEffectiveSyllabusRequirements(params: ListQuery<"syllabus_requirements_effective_list">): Promise<PaginatedResponse<EffectiveSyllabusRequirement>> {
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

async function getPromotions(params?: ListQuery<"gradings_promotions_list">): Promise<PaginatedResponse<Promotion>> {
  return apiRequest<PaginatedResponse<Promotion>>(
    withQuery("/api/gradings/promotions/", params),
  );
}

export async function getAllPromotions(
  params: Omit<ListQuery<"gradings_promotions_list">, "page" | "page_size"> = {},
): Promise<PaginatedResponse<Promotion>> {
  return collectAllPages((page) =>
    getPromotions({ ...params, page, page_size: 200 }),
  );
}

export async function promoteCandidateOutcome(
  outcomeId: number,
  data?: Schemas["CandidatePromotionRequest"],
): Promise<Promotion> {
  return apiRequest<Promotion>(`/api/gradings/outcomes/${outcomeId}/promote/`, {
    method: "POST",
    body: JSON.stringify(data || {}),
  });
}

export type BulkPromoteResponse = Schemas["BulkPromotionResult"];

export async function bulkPromoteCandidateOutcomes(
  data: Schemas["BulkPromotionRequest"],
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

export type DataImportRow = Schemas["ImportRow"];

export async function getDataImportBatches(
  params?: ListQuery<"data_imports_batches_list">,
): Promise<PaginatedResponse<DataImportBatch>> {
  return apiRequest<PaginatedResponse<DataImportBatch>>(
    withQuery("/api/data-imports/batches/", params),
  );
}

/** Complete import choices for filters, regardless of how many were committed. */
export async function getAllDataImportBatches(
  params: Omit<ListQuery<"data_imports_batches_list">, "page" | "page_size">,
): Promise<PaginatedResponse<DataImportBatch>> {
  return collectAllPages((page) => getDataImportBatches({ ...params, page, page_size: 200 }));
}

export async function getDataImportBatch(batchId: number): Promise<DataImportBatch> {
  return apiRequest<DataImportBatch>(`/api/data-imports/batches/${batchId}/`);
}

export async function getDataImportRows(
  batchId: number,
  params?: ListQuery<"data_imports_batches_rows_list">,
): Promise<PaginatedResponse<DataImportRow>> {
  return apiRequest<PaginatedResponse<DataImportRow>>(
    withQuery(`/api/data-imports/batches/${batchId}/rows/`, params),
  );
}

/** Read a roster from another sheet of its workbook. */
export async function chooseDataImportSheet(
  batchId: number,
  sheet: string,
): Promise<DataImportBatch> {
  return apiRequest<DataImportBatch>(`/api/data-imports/batches/${batchId}/sheet/`, {
    method: "POST",
    body: JSON.stringify({ sheet }),
  });
}

/** Void every record a finished historical import made, with the reason. */
export async function voidDataImportRecords(
  batchId: number,
  reason: string,
): Promise<Schemas["ImportRecordsVoided"]> {
  return apiRequest<Schemas["ImportRecordsVoided"]>(
    `/api/data-imports/batches/${batchId}/void-records/`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

export type DataImportMapping = Schemas["ImportMappingRequest"];
export type DataImportRowChanges = Schemas["PatchedImportRowCorrectionRequest"];

/** Match a roster's columns to KukGrade's fields; every row is checked again. */
export async function saveDataImportMapping(
  batchId: number,
  mapping: DataImportMapping,
): Promise<DataImportBatch> {
  return apiRequest<DataImportBatch>(`/api/data-imports/batches/${batchId}/mapping/`, {
    method: "POST",
    body: JSON.stringify(mapping),
  });
}

/** Fix a roster row's values by field; null takes a fix away. */
export async function correctDataImportRow(
  batchId: number,
  rowNumber: number,
  changes: DataImportRowChanges,
): Promise<DataImportRow> {
  return apiRequest<DataImportRow>(
    `/api/data-imports/batches/${batchId}/rows/${rowNumber}/`,
    { method: "PATCH", body: JSON.stringify(changes) },
  );
}

/** Leave a row out of the import, or bring it back. */
export async function setDataImportRowExcluded(
  batchId: number,
  rowNumber: number,
  excluded: boolean,
): Promise<DataImportRow> {
  return apiRequest<DataImportRow>(
    `/api/data-imports/batches/${batchId}/rows/${rowNumber}/exclusion/`,
    { method: "POST", body: JSON.stringify({ excluded }) },
  );
}

/** Leave out every roster row still needing attention. */
export async function leaveOutDataImportRowsNeedingAttention(
  batchId: number,
): Promise<DataImportBatch> {
  return apiRequest<DataImportBatch>(
    `/api/data-imports/batches/${batchId}/rows/leave-out-attention/`,
    { method: "POST" },
  );
}

/** Import what the stored rows say, all or nothing. */
export async function commitDataImport(batchId: number): Promise<DataImportBatch> {
  return apiRequest<DataImportBatch>(`/api/data-imports/batches/${batchId}/commit/`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function cancelDataImportBatch(batchId: number): Promise<void> {
  return apiRequest<void>(`/api/data-imports/batches/${batchId}/cancel/`, {
    method: "POST",
  });
}

export type LegacyImportPreview = Schemas["LegacyImportPreview"];

export async function previewLegacyGradingImport(
  batchId: number,
  payload: Schemas["LegacyImportRequest"],
): Promise<LegacyImportPreview> {
  return apiRequest<LegacyImportPreview>(
    `/api/data-imports/batches/${batchId}/preview/`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export type LegacyGradingRecord = Schemas["LegacyGradingRecord"];

export async function getLegacyGradingRecords(params?: ListQuery<"gradings_legacy_records_list">): Promise<PaginatedResponse<LegacyGradingRecord>> {
  return apiRequest<PaginatedResponse<LegacyGradingRecord>>(
    withQuery("/api/gradings/legacy-records/", params),
  );
}

export async function getLegacyGradingRecord(id: number): Promise<LegacyGradingRecord> {
  return apiRequest<LegacyGradingRecord>(`/api/gradings/legacy-records/${id}/`);
}

export async function linkLegacyGradingRecord(id: number, student: number, replace = false): Promise<LegacyGradingRecord> {
  return apiRequest<LegacyGradingRecord>(`/api/gradings/legacy-records/${id}/link-student/`, {
    method: "POST",
    body: JSON.stringify({ student, replace }),
  });
}

/** Every page of one historical name group, before choosing records to link. */
export async function getAllLegacyGradingRecords(
  params: Omit<ListQuery<"gradings_legacy_records_list">, "page" | "page_size">,
): Promise<PaginatedResponse<LegacyGradingRecord>> {
  return collectAllPages((page) => getLegacyGradingRecords({ ...params, page, page_size: 200 }));
}

export type LegacyPerson = Schemas["LegacyPerson"];

/** Historical records grouped by the name as written, with suggested students. */
export async function getLegacyPeople(
  params?: ListQuery<"gradings_legacy_records_people_list">,
): Promise<PaginatedResponse<LegacyPerson>> {
  return apiRequest<PaginatedResponse<LegacyPerson>>(
    withQuery("/api/gradings/legacy-records/people/", params),
  );
}

/** Link many records at once, all or nothing. */
export async function bulkLinkLegacyRecords(
  links: Schemas["LegacyRecordLinkRequest"][],
): Promise<LegacyGradingRecord[]> {
  return apiRequest<LegacyGradingRecord[]>("/api/gradings/legacy-records/bulk-link/", {
    method: "POST",
    body: JSON.stringify({ links }),
  });
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
