import type { CandidateAssessment, CandidateOutcome, GradingCandidateRoster, GradingSession } from "./api";
import { counted } from "./plural";

/** A candidate on the session screen, with what the roster carries about them. */
export interface EnrichedCandidate {
  candidate: GradingCandidateRoster;
  assessment?: CandidateAssessment;
  outcome?: CandidateOutcome;
}

/** A candidate as the attendance dialogs name them. */
export type AttendanceCandidate = {
  id: number;
  name: string;
  wksaId: string;
};

export type SessionAction = "LOCK" | "COMPLETE" | "CANCEL" | "DELETE" | "OPEN" | "ARCHIVE" | "RESTORE";

export function toAttendanceCandidate(item: EnrichedCandidate): AttendanceCandidate {
  return {
    id: item.candidate.id,
    name: item.candidate.student_display_name,
    wksaId: item.candidate.student_wksa_id,
  };
}

/** Each roster row as the candidate with their assessment and outcome. */
export function enrichCandidates(rows: GradingCandidateRoster[]): EnrichedCandidate[] {
  return rows.map((row) => ({
    candidate: row,
    assessment: row.assessment ?? undefined,
    outcome: row.outcome ?? undefined,
  }));
}

/**
 * The candidates in an assessment status, and, when a search is under way, only
 * those the server found. The words are the server's to match, as in every
 * list (`matching` is its answer: the ids that fit), so nothing here reads names.
 */
export function filterCandidates(
  items: EnrichedCandidate[],
  matching: ReadonlySet<number> | null,
  statusFilter: string,
): EnrichedCandidate[] {
  return items.filter((item) => {
    const matchesSearch = matching === null || matching.has(item.candidate.id);

    const assessmentStatus = item.assessment?.status || "NOT_STARTED";
    const withdrawn = item.candidate.status === "WITHDRAWN";
    const matchesStatus =
      statusFilter === "ALL" ||
      (statusFilter === "WITHDRAWN" ? withdrawn : !withdrawn && assessmentStatus === statusFilter);

    return matchesSearch && matchesStatus;
  });
}

/**
 * How a candidate's row words and links the next step. Which step it is comes
 * from the server (`next_action`), which knows where their assessment and
 * outcome stand and who is asking; this only decides the words and where it goes.
 */
export function nextActionFor(item: EnrichedCandidate, session: GradingSession) {
  const candidateId = item.candidate.id;
  const assessmentUrl = `/gradings/${session.id}/assessments/${candidateId}`;
  const decisionsUrl = `/gradings/${session.id}/decisions?candidate=${candidateId}`;
  switch (item.candidate.next_action) {
    case "PREPARE_ASSESSMENT":
      return { label: "Prepare assessment", url: assessmentUrl, opensProposalDrawer: false };
    case "START_ASSESSMENT":
      return { label: "Start assessment", url: assessmentUrl, opensProposalDrawer: false };
    case "CONTINUE_ASSESSMENT":
      return { label: "Continue assessment", url: assessmentUrl, opensProposalDrawer: false };
    case "VIEW_ASSESSMENT":
      return { label: "View record", url: `${assessmentUrl}/review`, opensProposalDrawer: false };
    case "PROPOSE_OUTCOME":
      return { label: "Propose outcome", url: assessmentUrl, opensProposalDrawer: true };
    case "REVIEW_PROPOSAL":
      return { label: "Review proposal", url: assessmentUrl, opensProposalDrawer: true };
    case "REVIEW_DECISION":
      return { label: "Review decision", url: decisionsUrl, opensProposalDrawer: false };
    case "VIEW_DECISION":
      return { label: "View record", url: decisionsUrl, opensProposalDrawer: false };
    case "PROMOTION_LEDGER":
      return { label: "Promotion ledger", url: `/gradings/${session.id}/promotions`, opensProposalDrawer: false };
    case "NONE":
      return { label: "No further action", url: null, opensProposalDrawer: false };
  }
}

/** The title and the question of the dialog that confirms a lifecycle action. */
export function confirmDetails(action: SessionAction, session: GradingSession, registeredCount: number) {
  switch (action) {
    case "DELETE":
      return {
        title: "Delete Grading Session",
        message: session.has_recorded_work
          ? `Are you sure you want to permanently delete ${session.title}? This erases its registrations and every assessment recorded in it. This action cannot be undone.`
          : `Are you sure you want to permanently delete ${session.title}? This action cannot be undone.`,
      };
    case "ARCHIVE":
      return {
        title: "Archive Grading Session",
        message:
          "Archiving hides this session from the list of gradings. Nothing is erased: its results, decisions and promotions stay, and you can restore it at any time.",
      };
    case "RESTORE":
      return {
        title: "Restore Grading Session",
        message: "Restoring puts this session back in the list of gradings.",
      };
    case "CANCEL":
      return { title: "Cancel Grading Session", message: "Are you sure you want to cancel this grading session?" };
    case "LOCK":
      return {
        title: "Lock Grading Session",
        message:
          "Locking ends grading. Every assessment must be completed first, and after locking only the authorised Master can correct a mark, with a reason, until a candidate's decision is recorded.",
      };
    case "COMPLETE":
      return {
        title: "Complete Grading Session",
        message:
          "Completing this session finalises all grading results and records. Ensure all candidate decisions have been made.",
      };
    case "OPEN":
      return {
        title: "Open Grading Session",
        message: `Opening starts the grading and cannot be undone: an open session does not go back to draft. ${
          registeredCount === 0
            ? "No candidates are registered."
            : `${counted(registeredCount, "candidate is", "candidates are")} registered.`
        } Check the roster first. Once open, a candidate who already has an assessment can no longer be moved or removed; one who cannot attend can still be marked as a no-show.`,
      };
  }
}
