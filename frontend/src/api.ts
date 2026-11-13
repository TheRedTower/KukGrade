import createClient from "openapi-fetch";

import type { components, operations, paths } from "./api/schema";

// Generated from backend/schema.yml (`npm run generate:types`) rather than
// hand-maintained, so these cannot silently drift from the serializers. Regenerate after any serializer change.
// Every request and response body is declared in the schema; the only
// hand-written API shape is the error envelope.
type Schemas = components["schemas"];
/** A list endpoint's query parameters, as its schema declares them. */
type ListQuery<Op extends keyof operations> = NonNullable<operations[Op]["parameters"]["query"]>;
export type AuthUser = components["schemas"]["User"];
export type UserRole = components["schemas"]["RoleEnum"];
export type ManagedUser = components["schemas"]["UserManagement"];
/** A managed user with the temporary password just issued for them, shown once. */
export type IssuedTemporaryPassword = components["schemas"]["IssuedTemporaryPassword"];

export type GradingSession = components["schemas"]["GradingSession"];
export type GradingSessionStatus = components["schemas"]["GradingSessionStatusEnum"];
export type GradingCandidate = Schemas["GradingCandidate"];
/** A candidate as a session's roster serves them: with assessment, outcome and next action. */
export type GradingCandidateRoster = Schemas["GradingCandidateRoster"];
export type CandidateAssessment = components["schemas"]["CandidateAssessment"];
export type CandidateAssessmentItem = components["schemas"]["CandidateAssessmentItem"];
export type CandidateAssessmentItemResult = components["schemas"]["ResultEnum"];
export type CandidateOutcome = components["schemas"]["CandidateOutcome"];
export type KeptStagedDecision = Schemas["KeptStagedDecision"];
export type CandidateOutcomeOutcome = components["schemas"]["CandidateOutcomeOutcomeEnum"];
export type Promotion = components["schemas"]["Promotion"];
export type CategoryAssessmentSummary = Schemas["AssessmentCategorySummary"];
export type CandidateAssessmentSummary = Schemas["CandidateAssessmentSummary"];
export type AuditEvent = components["schemas"]["AuditEvent"];
export type AuditSubject = components["schemas"]["AuditSubject"];
export type AuditAction = components["schemas"]["ActionEnum"];
export type AuditEntity = components["schemas"]["AuditEntityEnum"];
export type StudentListItem = components["schemas"]["StudentList"];
export type StudentDetail = components["schemas"]["Student"];
export type StudentStatus = components["schemas"]["StudentStatusEnum"];
export type Rank = components["schemas"]["Rank"];
export type EffectiveSyllabusRequirement = components["schemas"]["EffectiveSyllabusRequirement"];
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
type FieldErrors = { [field: string]: string[] | FieldErrors };

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

  constructor(message: string, status: number, code?: string, fields?: FieldErrors) {
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

/**
 * Only a genuine "you are not signed in" answer from the server counts as
 * anonymous. A dropped connection or a 5xx is not
 * evidence about the viewer's session, and treating it as one signed people
 * out mid-grading.
 */
export function isAnonymousResponse(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 401 || (error.status === 403 && error.code === "authentication_required"))
  );
}

/** What a person sees when a request never reached the server. */
export const NETWORK_ERROR = "KukGrade could not be reached. Check your connection and try again.";

/**
 * The line to show for any failed request: the server's reason, the network
 * error (fetch rejects with a TypeError when it gets no answer), or `fallback`.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return err.nonFieldMessages[0] || err.message || fallback;
  }
  if (err instanceof TypeError) return NETWORK_ERROR;
  return fallback;
}

function csrfToken(): string | undefined {
  return document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith("csrftoken="))
    ?.split("=")[1];
}

/** A query string with every present parameter; empty values are left out. */
function searchOf(params: object = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  return search.toString();
}

/**
 * Every request goes through this one client, typed from the schema: its
 * path, parameters, body and answer are the schema's, so no call restates
 * them. Same origin, with the session cookie and Django's CSRF token on every
 * unsafe method. `fetch` is looked up on each call, not kept from load.
 */
const api = createClient<paths>({
  baseUrl: window.location.origin,
  credentials: "include",
  fetch: (request) => globalThis.fetch(request),
  querySerializer: searchOf,
});

api.use({
  onRequest({ request }) {
    if (["GET", "HEAD", "OPTIONS", "TRACE"].includes(request.method)) return undefined;
    const token = csrfToken();
    if (token) request.headers.set("X-CSRFToken", decodeURIComponent(token));
    return request;
  },
});

/** The error envelope's fields, when the answer carried one. */
function envelopeOf(body: unknown): ApiErrorBody["error"] {
  return typeof body === "object" && body !== null ? (body as ApiErrorBody).error : undefined;
}

/**
 * The answer's body, or an ApiError with the server's reason. A body that is
 * not JSON (a proxy error, a gateway timeout) keeps the general message. A
 * request that never reached the server rejects with fetch's own TypeError.
 */
async function answer<D>(call: Promise<{ data?: D; error?: unknown; response: Response }>): Promise<D> {
  const { data, error, response } = await call;
  if (!response.ok) {
    const envelope = envelopeOf(error);
    throw new ApiError(
      envelope?.message ?? "Something went wrong. Try again in a moment.",
      response.status,
      envelope?.code,
      envelope?.fields,
    );
  }
  return data as D;
}

/** An answer with no body (204): only whether it succeeded. */
async function done(call: Promise<{ error?: unknown; response: Response }>): Promise<void> {
  await answer(call);
}

// The largest page a list serves, as the site settings say (`largest_page_size`).
// Asking for it keeps a read of every page to as few requests as it can be.
// Until the settings are read, or if they cannot be, a list is asked for at the
// server's own page size: more requests, never fewer rows, as the pages are
// followed to the end.
let largestPage: number | undefined;

/** Sets the largest page size, as the site settings arrive (queries.ts). */
export function setLargestPage(size: number | undefined): void {
  largestPage = size;
}

/** The largest page a list serves, or undefined for the server's own page size. */
export function largestPageSize(): number | undefined {
  return largestPage;
}

type Page<T> = { count: number; next?: string | null; results: T[] };

async function collectAllPages<T>(loadPage: (page: number) => Promise<Page<T>>) {
  let page = 1;
  let response = await loadPage(page);
  const results: T[] = [...response.results];

  while (response.next) {
    page += 1;
    response = await loadPage(page);
    results.push(...response.results);
  }

  return { count: response.count, next: null, previous: null, results };
}

export type SiteSettings = Schemas["SiteSettings"];

export function getSiteSettings() {
  return answer(api.GET("/api/site/"));
}

export type Choices = Schemas["Choices"];

export function getChoices() {
  return answer(api.GET("/api/choices/"));
}

export type About = Schemas["About"];
export type Credit = Schemas["Credit"];

export function getAbout() {
  return answer(api.GET("/api/about/"));
}

/** The licence, code of conduct or security policy, as the repository holds it. */
export function getAboutDocument(slug: string) {
  return answer(api.GET("/api/about/documents/{slug}/", { params: { path: { slug } } }));
}

export function getPledge() {
  return answer(api.GET("/api/about/pledge/"));
}

export function getCredits() {
  return answer(api.GET("/api/about/credits/"));
}

/** The full third-party licence notices, a text file the browser opens itself. */
export function creditsNoticesUrl(): string {
  return "/api/about/credits/notices/";
}

export function getCurrentUser() {
  return answer(api.GET("/api/auth/me/"));
}

/** Your own first and last name - the only things a user edits about themselves. */
export function updateCurrentUser(body: Schemas["PatchedSelfProfileRequest"]) {
  return answer(api.PATCH("/api/auth/me/", { body }));
}

export function loginUser(email: string, password: string) {
  return answer(api.POST("/api/auth/login/", { body: { email, password } }));
}

export function logoutUser() {
  return done(api.POST("/api/auth/logout/"));
}

export type SetupDetails = Schemas["SetupRequest"];

/** Whether the deployment still needs its first administrator. */
export function getSetupStatus() {
  return answer(api.GET("/api/setup/"));
}

/** Create the first administrator and sign them in. */
export function completeSetup(body: SetupDetails) {
  return answer(api.POST("/api/setup/", { body }));
}

export function changePassword(currentPassword: string, newPassword: string) {
  return done(
    api.POST("/api/auth/change-password/", {
      body: { current_password: currentPassword, new_password: newPassword },
    }),
  );
}

export function getManagedUsers(query?: ListQuery<"users_list">) {
  return answer(api.GET("/api/users/", { params: { query } }));
}

export function getManagedUser(id: string) {
  return answer(api.GET("/api/users/{id}/", { params: { path: { id } } }));
}

export function createManagedUser(body: Schemas["UserManagementRequest"]) {
  return answer(api.POST("/api/users/", { body }));
}

export function deleteManagedUser(id: string) {
  return done(api.DELETE("/api/users/{id}/", { params: { path: { id } } }));
}

export function updateManagedUser(id: string, body: Schemas["PatchedUserManagementRequest"]) {
  return answer(api.PATCH("/api/users/{id}/", { params: { path: { id } }, body }));
}

export type UserAuthorityPayload = Schemas["PatchedUserAuthorityRequest"];

export function updateManagedUserAuthority(id: string, body: UserAuthorityPayload) {
  return answer(api.PATCH("/api/users/{id}/authority/", { params: { path: { id } }, body }));
}

export function resetManagedUserPassword(id: string) {
  return answer(api.POST("/api/users/{id}/set-password/", { params: { path: { id } } }));
}

export function getGradingSessions(query?: ListQuery<"gradings_sessions_list">) {
  return answer(api.GET("/api/gradings/sessions/", { params: { query } }));
}

export function getAllGradingSessions(query: Omit<ListQuery<"gradings_sessions_list">, "page" | "page_size"> = {}) {
  return collectAllPages((page) => getGradingSessions({ ...query, page, page_size: largestPage }));
}

export async function getGradingSessionYears(): Promise<number[]> {
  const body = await answer(api.GET("/api/gradings/sessions/years/"));
  return body.years;
}

export function createGradingSession(body: Schemas["GradingSessionRequest"]) {
  return answer(api.POST("/api/gradings/sessions/", { body }));
}

export function getGradingSession(id: number) {
  return answer(api.GET("/api/gradings/sessions/{id}/", { params: { path: { id } } }));
}

export function updateGradingSession(id: number, body: Schemas["PatchedGradingSessionRequest"]) {
  return answer(api.PATCH("/api/gradings/sessions/{id}/", { params: { path: { id } }, body }));
}

/** Hide a finished session from the lists; nothing is erased. */
export function archiveGradingSession(id: number) {
  return answer(api.POST("/api/gradings/sessions/{id}/archive/", { params: { path: { id } } }));
}

/** Bring an archived session back into the lists. */
export function restoreGradingSession(id: number) {
  return answer(api.POST("/api/gradings/sessions/{id}/restore/", { params: { path: { id } } }));
}

export function deleteGradingSession(id: number) {
  return done(api.DELETE("/api/gradings/sessions/{id}/", { params: { path: { id } } }));
}

function getGradingCandidates(query?: ListQuery<"gradings_candidates_list">) {
  return answer(api.GET("/api/gradings/candidates/", { params: { query } }));
}

export function getGradingCandidate(id: number) {
  return answer(api.GET("/api/gradings/candidates/{id}/", { params: { path: { id } } }));
}

export function getAllGradingCandidates(query: Omit<ListQuery<"gradings_candidates_list">, "page" | "page_size"> = {}) {
  return collectAllPages((page) => getGradingCandidates({ ...query, page, page_size: largestPage }));
}

/** Move a registration to another draft or open session. */
export function moveGradingCandidate(id: number, session: number) {
  return answer(api.PATCH("/api/gradings/candidates/{id}/", { params: { path: { id } }, body: { session } }));
}

/** Remove a registration while its session is draft or open. */
export function deleteGradingCandidate(id: number) {
  return done(api.DELETE("/api/gradings/candidates/{id}/", { params: { path: { id } } }));
}

export type BulkCandidateRegistrationPayload = Schemas["BulkCandidateRegistrationRequest"];
export type BulkCandidateRegistrationResponse = Schemas["BulkCandidateRegistrationResult"];

export function bulkRegisterCandidates(body: BulkCandidateRegistrationPayload) {
  return answer(api.POST("/api/gradings/candidates/bulk-register/", { body }));
}

export function generateCandidateAssessment(id: number) {
  return answer(api.POST("/api/gradings/candidates/{id}/generate-assessment/", { params: { path: { id } } }));
}

export function bulkGenerateCandidateAssessments(candidates: number[]) {
  return answer(api.POST("/api/gradings/candidates/bulk-generate-assessments/", { body: { candidates } }));
}

export function bulkUpdateCandidateStatus(body: Schemas["BulkCandidateStatusUpdateRequest"]) {
  return answer(api.POST("/api/gradings/candidates/bulk-update-status/", { body }));
}

export type WithdrawalReason = Schemas["WithdrawalReasonChoice"];

export type LockedCandidateWithdrawal = Schemas["LockedCandidateWithdrawalRequest"];

export function withdrawLockedCandidate(id: number, body: LockedCandidateWithdrawal) {
  return answer(api.POST("/api/gradings/candidates/{id}/withdraw/", { params: { path: { id } }, body }));
}

export function getCandidateAssessments(query?: ListQuery<"gradings_assessments_list">) {
  return answer(api.GET("/api/gradings/assessments/", { params: { query } }));
}

export function updateCandidateAssessment(id: number, body: Schemas["PatchedCandidateAssessmentRequest"]) {
  return answer(api.PATCH("/api/gradings/assessments/{id}/", { params: { path: { id } }, body }));
}

export function deleteCandidateAssessment(id: number) {
  return done(api.DELETE("/api/gradings/assessments/{id}/", { params: { path: { id } } }));
}

export function bulkStartCandidateAssessments(assessments: number[]) {
  return answer(api.POST("/api/gradings/assessments/bulk-start/", { body: { assessments } }));
}

function getCandidateAssessmentItems(query?: ListQuery<"gradings_assessment_items_list">) {
  return answer(api.GET("/api/gradings/assessment-items/", { params: { query } }));
}

export function getAllCandidateAssessmentItems(
  query: Omit<ListQuery<"gradings_assessment_items_list">, "page" | "page_size"> = {},
) {
  return collectAllPages((page) => getCandidateAssessmentItems({ ...query, page, page_size: largestPage }));
}

/** Mark an item; the answer carries the assessment's counts as the save left them. */
export function updateCandidateAssessmentItem(id: number, body: Schemas["PatchedCandidateAssessmentItemRequest"]) {
  return answer(api.PATCH("/api/gradings/assessment-items/{id}/", { params: { path: { id } }, body }));
}

/** Add a comment to an item. A comment is kept as written; a correction is another. */
export function addAssessmentItemComment(id: number, body: string) {
  return answer(
    api.POST("/api/gradings/assessment-items/{id}/comments/", { params: { path: { id } }, body: { body } }),
  );
}

export type PromotionEligibility = Schemas["PromotionEligibility"];

export function getPromotionEligibility(session: number) {
  return answer(api.GET("/api/gradings/outcomes/promotion-eligibility/", { params: { query: { session } } }));
}

/** The first proposal opens the candidate's outcome record; later ones revise it. */
export function proposeCandidateOutcome(id: number, body: Schemas["CandidateOutcomeProposalRequest"]) {
  return answer(api.POST("/api/gradings/candidates/{id}/propose-outcome/", { params: { path: { id } }, body }));
}

/**
 * Rollup for one assessment, reachable at any assessment status - scoring,
 * completion review and the adjudication board all read counts from here.
 */
export function getAssessmentSummary(id: number) {
  return answer(api.GET("/api/gradings/assessments/{id}/summary/", { params: { path: { id } } }));
}

/** The viewer's own decisions staged in a session and not yet recorded. */
export function getStagedDecisions(session: number) {
  return answer(api.GET("/api/gradings/outcomes/staged-decisions/", { params: { query: { session } } }));
}

/** `keepalive` lets a save sent as the page is left still reach the server. */
export function stageDecision(id: number, body: Schemas["StagedDecisionRequest"], keepalive = false) {
  return answer(api.PUT("/api/gradings/outcomes/{id}/staged-decision/", { params: { path: { id } }, body, keepalive }));
}

export function discardStagedDecision(id: number, revision: number, keepalive = false) {
  return done(
    api.DELETE("/api/gradings/outcomes/{id}/staged-decision/", {
      params: { path: { id }, query: { revision } },
      keepalive,
    }),
  );
}

export function finaliseCandidateOutcome(id: number, body: Schemas["CandidateOutcomeFinaliseRequest"]) {
  return answer(api.PATCH("/api/gradings/outcomes/{id}/finalise/", { params: { path: { id } }, body }));
}

/** The names of the audit event and record types, for the audit filters. */
export function getAuditLabels() {
  return answer(api.GET("/api/audit-events/labels/"));
}

/** What a record's history is of: its current name and where to open it. */
export function getAuditSubject(subject: string) {
  return answer(api.GET("/api/audit-events/subject/", { params: { query: { subject } } }));
}

export function getAuditEvents(query?: ListQuery<"audit_events_list">) {
  return answer(api.GET("/api/audit-events/", { params: { query } }));
}

export function getStudents(query?: ListQuery<"students_list">) {
  return answer(api.GET("/api/students/", { params: { query } }));
}

export function getAllStudents(query: Omit<ListQuery<"students_list">, "page" | "page_size"> = {}) {
  return collectAllPages((page) => getStudents({ ...query, page, page_size: largestPage }));
}

export function getRanks(query?: ListQuery<"ranks_list">) {
  return answer(api.GET("/api/ranks/", { params: { query } }));
}

export function getAgeBands() {
  return answer(api.GET("/api/syllabus/age-bands/"));
}

export function getAllEffectiveSyllabusRequirements(
  query: Omit<ListQuery<"syllabus_requirements_effective_list">, "page" | "page_size">,
) {
  return collectAllPages((page) =>
    answer(
      api.GET("/api/syllabus/requirements/effective/", {
        params: { query: { ...query, page, page_size: largestPage } },
      }),
    ),
  );
}

export function getStudent(id: number) {
  return answer(api.GET("/api/students/{id}/", { params: { path: { id } } }));
}

export function createStudent(body: Schemas["StudentRequest"]) {
  return answer(api.POST("/api/students/", { body }));
}

export type StudentRankHistory = Schemas["StudentRankHistory"];

export function getStudentRankHistory(id: number) {
  return answer(api.GET("/api/students/{id}/rank-history/", { params: { path: { id } } }));
}

export function updateStudent(id: number, body: Schemas["PatchedStudentRequest"]) {
  return answer(api.PATCH("/api/students/{id}/", { params: { path: { id } }, body }));
}

export function deleteStudent(id: number) {
  return done(api.DELETE("/api/students/{id}/", { params: { path: { id } } }));
}

export function promoteCandidateOutcome(id: number, body: Schemas["CandidatePromotionRequest"] = {}) {
  return answer(api.POST("/api/gradings/outcomes/{id}/promote/", { params: { path: { id } }, body }));
}

export function bulkPromoteCandidateOutcomes(body: Schemas["BulkPromotionRequest"]) {
  return answer(api.POST("/api/gradings/outcomes/bulk-promote/", { body }));
}

export type DataImportKind = Schemas["KindEnum"];
export type DataImportBatch = Schemas["ImportBatch"];
export type CreateDataImportBatchResponse = Schemas["ImportBatchCreated"];

export function createDataImportBatch(file: File, kind: DataImportKind = "STUDENT_ROSTER") {
  // The schema writes a file as a binary string; the browser writes the
  // multipart body, with its own boundary.
  return answer(
    api.POST("/api/data-imports/batches/", {
      body: { kind, file: file as unknown as string },
      bodySerializer(fields) {
        const form = new FormData();
        form.append("kind", fields.kind);
        form.append("file", file);
        return form;
      },
    }),
  );
}

export type DataImportRow = Schemas["ImportRow"];

export function getDataImportBatches(query?: ListQuery<"data_imports_batches_list">) {
  return answer(api.GET("/api/data-imports/batches/", { params: { query } }));
}

/** Complete import choices for filters, regardless of how many were committed. */
export function getAllDataImportBatches(query: Omit<ListQuery<"data_imports_batches_list">, "page" | "page_size">) {
  return collectAllPages((page) => getDataImportBatches({ ...query, page, page_size: largestPage }));
}

export function getDataImportBatch(id: number) {
  return answer(api.GET("/api/data-imports/batches/{id}/", { params: { path: { id } } }));
}

/** What KukGrade filled in for a roster's added students, counted. */
export function getDataImportSecondLook(id: number) {
  return answer(api.GET("/api/data-imports/batches/{id}/second-look/", { params: { path: { id } } }));
}

export function getDataImportRows(batch_pk: number, query?: ListQuery<"data_imports_batches_rows_list">) {
  return answer(api.GET("/api/data-imports/batches/{batch_pk}/rows/", { params: { path: { batch_pk }, query } }));
}

/** Read a roster from another sheet of its workbook. */
export function chooseDataImportSheet(id: number, sheet: string) {
  return answer(api.POST("/api/data-imports/batches/{id}/sheet/", { params: { path: { id } }, body: { sheet } }));
}

/** Void every record a finished historical import made, with the reason. */
export function voidDataImportRecords(id: number, reason: string) {
  return answer(
    api.POST("/api/data-imports/batches/{id}/void-records/", { params: { path: { id } }, body: { reason } }),
  );
}

/** Match a roster's columns to KukGrade's fields; every row is checked again. */
export function saveDataImportMapping(id: number, body: Schemas["ImportMappingRequest"]) {
  return answer(api.POST("/api/data-imports/batches/{id}/mapping/", { params: { path: { id } }, body }));
}

/** Fix a roster row's values by field; null takes a fix away. */
export function correctDataImportRow(
  batch_pk: number,
  row_number: number,
  body: Schemas["PatchedImportRowCorrectionRequest"],
) {
  return answer(
    api.PATCH("/api/data-imports/batches/{batch_pk}/rows/{row_number}/", {
      params: { path: { batch_pk, row_number } },
      body,
    }),
  );
}

/** Leave a row out of the import, or bring it back. */
export function setDataImportRowExcluded(batch_pk: number, row_number: number, excluded: boolean) {
  return answer(
    api.POST("/api/data-imports/batches/{batch_pk}/rows/{row_number}/exclusion/", {
      params: { path: { batch_pk, row_number } },
      body: { excluded },
    }),
  );
}

/** Leave out every roster row still needing attention. */
export function leaveOutDataImportRowsNeedingAttention(batch_pk: number) {
  return answer(
    api.POST("/api/data-imports/batches/{batch_pk}/rows/leave-out-attention/", { params: { path: { batch_pk } } }),
  );
}

/** Import what the stored rows say, all or nothing. */
export function commitDataImport(id: number) {
  return answer(api.POST("/api/data-imports/batches/{id}/commit/", { params: { path: { id } } }));
}

export function cancelDataImportBatch(id: number) {
  return done(api.POST("/api/data-imports/batches/{id}/cancel/", { params: { path: { id } } }));
}

export type LegacyImportPreview = Schemas["LegacyImportPreview"];

export function previewLegacyGradingImport(id: number, body: Schemas["LegacyImportRequest"]) {
  return answer(api.POST("/api/data-imports/batches/{id}/preview/", { params: { path: { id } }, body }));
}

export type LegacyGradingRecord = Schemas["LegacyGradingRecord"];

export function getLegacyGradingRecords(query?: ListQuery<"gradings_legacy_records_list">) {
  return answer(api.GET("/api/gradings/legacy-records/", { params: { query } }));
}

export function getLegacyGradingRecord(id: number) {
  return answer(api.GET("/api/gradings/legacy-records/{id}/", { params: { path: { id } } }));
}

export function linkLegacyGradingRecord(id: number, student: number, replace = false) {
  return answer(
    api.POST("/api/gradings/legacy-records/{id}/link-student/", {
      params: { path: { id } },
      body: { student, replace },
    }),
  );
}

/** Every page of one historical name group, before choosing records to link. */
export function getAllLegacyGradingRecords(
  query: Omit<ListQuery<"gradings_legacy_records_list">, "page" | "page_size">,
) {
  return collectAllPages((page) => getLegacyGradingRecords({ ...query, page, page_size: largestPage }));
}

export type LegacyPerson = Schemas["LegacyPerson"];

/** Historical records grouped by the name as written, with suggested students. */
export function getLegacyPeople(query?: ListQuery<"gradings_legacy_records_people_list">) {
  return answer(api.GET("/api/gradings/legacy-records/people/", { params: { query } }));
}

/** How many imported records still wait for a student, counted on the server. */
export function getLegacyRecordCounts(query?: ListQuery<"gradings_legacy_records_counts_retrieve">) {
  return answer(api.GET("/api/gradings/legacy-records/counts/", { params: { query } }));
}

/** How many names still wait to be linked, by how clear their suggested students are. */
export function getLegacyPeopleSummary(query?: ListQuery<"gradings_legacy_records_people_summary_retrieve">) {
  return answer(api.GET("/api/gradings/legacy-records/people-summary/", { params: { query } }));
}

/** Put names aside for now on the linking page; the viewer's own list, on the server. */
export async function setAsideNames(group_keys: string[]): Promise<string[]> {
  const kept = await answer(api.POST("/api/gradings/legacy-records/people/set-aside/", { body: { group_keys } }));
  return kept.group_keys;
}

export function putBackSetAsideName(group_key: string) {
  return done(api.DELETE("/api/gradings/legacy-records/people/set-aside/", { params: { query: { group_key } } }));
}

/** Link many records at once, all or nothing. */
export function bulkLinkLegacyRecords(links: Schemas["LegacyRecordLinkRequest"][]) {
  return answer(api.POST("/api/gradings/legacy-records/bulk-link/", { body: { links } }));
}

/** Unlink many records at once, all or nothing: Undo after a bulk link. */
export function bulkUnlinkLegacyRecords(records: Schemas["BulkUnlinkLegacyRecordsRequest"]["records"]) {
  return answer(api.POST("/api/gradings/legacy-records/bulk-unlink/", { body: { records } }));
}

export function unlinkLegacyGradingRecord(id: number) {
  return answer(api.POST("/api/gradings/legacy-records/{id}/unlink-student/", { params: { path: { id } } }));
}

export function resolveLegacyRank(id: number, field: Schemas["LegacyRankFieldEnum"], rank: number | null) {
  return answer(
    api.POST("/api/gradings/legacy-records/{id}/resolve-rank/", {
      params: { path: { id } },
      body: { field, rank },
    }),
  );
}

export function voidLegacyGradingRecord(id: number, reason: string) {
  return answer(api.POST("/api/gradings/legacy-records/{id}/void/", { params: { path: { id } }, body: { reason } }));
}

export type GradingHistoryItem = Schemas["GradingHistoryItem"];
export type StudentGradingHistory = Schemas["StudentGradingHistory"];

export function getStudentGradingHistory(id: number) {
  return answer(api.GET("/api/students/{id}/grading-history/", { params: { path: { id } } }));
}
