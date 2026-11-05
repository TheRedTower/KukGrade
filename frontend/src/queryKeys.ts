import type { QueryClient } from "@tanstack/react-query";

/** An id as a screen has it: from the address, so possibly not there yet. */
type Id = number | undefined;

/**
 * The name of every grading, student and audit list the app keeps, in one
 * place, so a screen that reads a list and one that changes it agree on what
 * it is called. Each name starts with its family, so refreshing the family
 * (`all()`) refreshes every list in it.
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
    detail: (candidateId: Id) => ["gradingCandidates", "detail", candidateId] as const,
  },
  candidateAssessments: {
    all: () => ["candidateAssessments"] as const,
    byCandidate: (candidateId: Id) => ["candidateAssessments", "byCandidate", candidateId] as const,
    attention: (sessionId: Id) => ["candidateAssessments", "attention", sessionId] as const,
  },
  candidateAssessmentSummary: (assessmentId: Id) => ["candidateAssessmentSummary", assessmentId] as const,
  candidateAssessmentItems: (assessmentId: Id) => ["candidateAssessmentItems", assessmentId] as const,
  candidateOutcomes: {
    all: () => ["candidateOutcomes"] as const,
    session: (sessionId: Id) => ["candidateOutcomes", sessionId] as const,
  },
  stagedDecisions: (sessionId: Id) => ["stagedDecisions", sessionId] as const,
  promotions: {
    all: () => ["promotions"] as const,
    session: (sessionId: Id) => ["promotions", sessionId] as const,
  },
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
    user: (id: Id | string) => ["auditEvents", "user", id] as const,
  },
};

/**
 * What to read again after a change, for the changes more than one screen
 * makes. Each says which lists the change can make stale.
 */
export const refresh = {
  /** A candidate registered, withdrawn, moved, assessed or decided in a session. */
  sessionWork(queryClient: QueryClient, sessionId: Id) {
    void queryClient.invalidateQueries({ queryKey: keys.gradingCandidates.session(sessionId) });
    void queryClient.invalidateQueries({ queryKey: keys.candidateOutcomes.session(sessionId) });
  },
  /** A student promoted: their rank, the session's ledger, and the audit log. */
  afterPromotion(queryClient: QueryClient, sessionId: Id) {
    void queryClient.invalidateQueries({ queryKey: keys.promotions.session(sessionId) });
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
