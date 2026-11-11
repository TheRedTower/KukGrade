import type { QueryClient } from "@tanstack/react-query";

/** An id as a screen has it: from the address, so possibly not there yet. */
type Id = number | undefined;

/**
 * The name of everything the app reads and keeps, in one place, so a screen
 * that reads a list and one that changes it agree on what it is called. Each
 * name starts with its family, so refreshing the family (`all()`) refreshes
 * every list in it. A lint rule refuses a key written anywhere else.
 */
export const keys = {
  gradingSessions: {
    all: () => ["gradingSessions"] as const,
    detail: (id: Id) => ["gradingSessions", "detail", id] as const,
    current: () => ["gradingSessions", "current"] as const,
    upcoming: (today: string) => ["gradingSessions", "upcoming", today] as const,
    years: () => ["gradingSessions", "years"] as const,
    page: (...filters: unknown[]) => ["gradingSessions", "page", ...filters] as const,
    moveTargets: () => ["gradingSessions", "move-targets"] as const,
  },
  gradingCandidates: {
    all: () => ["gradingCandidates"] as const,
    session: (sessionId: Id) => ["gradingCandidates", sessionId] as const,
    board: (sessionId: Id) => ["gradingCandidates", sessionId, "board"] as const,
    search: (sessionId: Id, term: string) => ["gradingCandidates", sessionId, "search", term] as const,
    detail: (candidateId: Id) => ["gradingCandidates", "detail", candidateId] as const,
  },
  candidateAssessments: {
    all: () => ["candidateAssessments"] as const,
    byCandidate: (candidateId: Id) => ["candidateAssessments", "byCandidate", candidateId] as const,
    attention: (sessionId: Id) => ["candidateAssessments", "attention", sessionId] as const,
  },
  candidateAssessmentSummary: (assessmentId: Id) => ["candidateAssessmentSummary", assessmentId] as const,
  candidateAssessmentItems: (assessmentId: Id) => ["candidateAssessmentItems", assessmentId] as const,
  /** The writes of one assessment's marks, counted while any is in flight. */
  assessmentItemWrite: (assessmentId: Id) => ["assessmentItemWrite", assessmentId] as const,
  assessmentNotesDrafts: () => ["assessmentNotesDraft"] as const,
  assessmentNotesDraft: (assessmentId: Id) => ["assessmentNotesDraft", assessmentId] as const,
  stagedDecisions: (sessionId: Id) => ["stagedDecisions", sessionId] as const,
  promotionEligibility: (sessionId: Id) => ["promotionEligibility", sessionId] as const,
  withdrawalReasons: () => ["withdrawalReasons"] as const,
  students: {
    all: () => ["students"] as const,
    list: (...filters: unknown[]) => ["students", "list", ...filters] as const,
    detail: (id: Id) => ["students", "detail", id] as const,
    rankHistory: (id: Id) => ["students", "rankHistory", id] as const,
    gradingHistory: (id: Id) => ["students", "gradingHistory", id] as const,
    eligible: (...filters: unknown[]) => ["students", "eligible", ...filters] as const,
    linkSearch: (search: string) => ["students", "linkSearch", search] as const,
  },
  auditEvents: {
    all: () => ["auditEvents"] as const,
    recent: () => ["auditEvents", "recent"] as const,
    user: (id: string) => ["auditEvents", "user", id] as const,
    log: (...filters: unknown[]) => ["auditEvents", "log", ...filters] as const,
  },
  auditLabels: () => ["auditLabels"] as const,
  auditSubject: (subject: string) => ["auditSubject", subject] as const,
  imports: {
    all: () => ["imports"] as const,
    batch: (batchId: Id) => ["imports", "batch", batchId] as const,
    unfinished: () => ["imports", "unfinished"] as const,
    past: (...filters: unknown[]) => ["imports", "past", ...filters] as const,
    /** Every finished historical import, for the record screens' import filter. */
    historical: () => ["imports", "historical"] as const,
    legacyPreview: (batchId: Id) => ["imports", "legacyPreview", batchId] as const,
    rows: (batchId: Id) => ["imports", "rows", batchId] as const,
    rowsPage: (batchId: Id, ...filters: unknown[]) => ["imports", "rows", batchId, ...filters] as const,
    rowsPreview: (batchId: Id) => ["imports", "rows", batchId, "preview"] as const,
    rowsWithRank: (batchId: Id, text: string | undefined) => ["imports", "rows", batchId, "rank", text] as const,
    secondLook: (batchId: Id) => ["imports", "rows", batchId, "secondLook"] as const,
  },
  legacyRecords: {
    all: () => ["legacyRecords"] as const,
    browse: (...filters: unknown[]) => ["legacyRecords", "browse", ...filters] as const,
    detail: (id: Id) => ["legacyRecords", "detail", id] as const,
    group: (groupKey: string, batch: Id) => ["legacyRecords", "group", groupKey, batch] as const,
    /** How many still await a student: every import, or one. */
    awaitingLinkCount: (...batch: number[]) => ["legacyRecords", "awaitingLinkCount", ...batch] as const,
  },
  legacyPeople: {
    all: () => ["legacyPeople"] as const,
    summary: (batchId: Id) => ["legacyPeople", "summary", batchId] as const,
    list: (...filters: unknown[]) => ["legacyPeople", "list", ...filters] as const,
    unlinked: (batchId: Id) => ["legacyPeople", batchId, "unlinked"] as const,
  },
  managedUsers: {
    all: () => ["managedUsers"] as const,
    page: (...filters: unknown[]) => ["managedUsers", ...filters] as const,
  },
  /** One account: its own family, so refreshing the list leaves it as just saved. */
  managedUser: (id: string) => ["managedUser", id] as const,
  currentUser: () => ["currentUser"] as const,
  setupStatus: () => ["setupStatus"] as const,
  ranks: () => ["ranks"] as const,
  ageBands: () => ["ageBands"] as const,
  effectiveSyllabus: (rankCode: string, ageBand: string | null) => ["effectiveSyllabus", rankCode, ageBand] as const,
  siteSettings: () => ["siteSettings"] as const,
  choices: () => ["choices"] as const,
  about: () => ["about"] as const,
  aboutDocument: (slug: string) => ["aboutDocument", slug] as const,
  pledge: () => ["pledge"] as const,
  credits: () => ["credits"] as const,
};

/**
 * What to read again after a change, for the changes more than one screen
 * makes. Each says which lists the change can make stale.
 */
export const refresh = {
  /** A candidate registered, withdrawn, moved, assessed or decided in a session. */
  sessionWork(queryClient: QueryClient, sessionId: Id) {
    void queryClient.invalidateQueries({ queryKey: keys.gradingCandidates.session(sessionId) });
  },
  /** A student promoted: their rank, the session's ledger, and the audit log. */
  afterPromotion(queryClient: QueryClient, sessionId: Id) {
    void queryClient.invalidateQueries({ queryKey: keys.promotionEligibility(sessionId) });
    void queryClient.invalidateQueries({ queryKey: keys.gradingCandidates.session(sessionId) });
    void queryClient.invalidateQueries({ queryKey: keys.students.all() });
    void queryClient.invalidateQueries({ queryKey: keys.auditEvents.all() });
  },
  /** An assessment started, changed or completed. */
  afterAssessmentChange(queryClient: QueryClient, candidateId: Id) {
    void queryClient.invalidateQueries({ queryKey: keys.candidateAssessments.byCandidate(candidateId) });
    void queryClient.invalidateQueries({ queryKey: keys.gradingCandidates.all() });
    void queryClient.invalidateQueries({ queryKey: keys.gradingSessions.all() });
  },
  /** A student's record or status changed: their page, every list, the audit log. */
  afterStudentChange(queryClient: QueryClient, studentId: Id) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.students.detail(studentId) }),
      queryClient.invalidateQueries({ queryKey: keys.students.list() }),
      queryClient.invalidateQueries({ queryKey: keys.auditEvents.all() }),
    ]);
  },
};
