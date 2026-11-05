import type { GradingCandidateRoster, GradingSession } from "./api";
import type { AttendanceCandidate } from "./GradingAttendanceDialogs";
import type { EnrichedCandidate } from "./SessionParts";

export type SessionAction = "LOCK" | "COMPLETE" | "CANCEL" | "DELETE" | "OPEN";

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

/** The candidates that match a search of name or WKSA ID and an assessment status. */
export function filterCandidates(items: EnrichedCandidate[], search: string, statusFilter: string): EnrichedCandidate[] {
  const q = search.trim().toLowerCase();
  return items.filter((item) => {
    const name = (item.candidate.student_display_name || "").toLowerCase();
    const wksa = (item.candidate.student_wksa_id || "").toLowerCase();
    const matchesSearch = !q || name.includes(q) || wksa.includes(q);

    const assessmentStatus = item.assessment?.status || "NOT_STARTED";
    const withdrawn = item.candidate.status === "WITHDRAWN";
    const matchesStatus =
      statusFilter === "ALL" || (statusFilter === "WITHDRAWN" ? withdrawn : !withdrawn && assessmentStatus === statusFilter);

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
      return { label: "Prepare assessment →", url: assessmentUrl, opensProposalDrawer: false };
    case "START_ASSESSMENT":
      return { label: "Start assessment →", url: assessmentUrl, opensProposalDrawer: false };
    case "CONTINUE_ASSESSMENT":
      return { label: "Continue assessment →", url: assessmentUrl, opensProposalDrawer: false };
    case "VIEW_ASSESSMENT":
      return { label: "View record →", url: `${assessmentUrl}/review`, opensProposalDrawer: false };
    case "PROPOSE_OUTCOME":
      return { label: "Propose outcome →", url: assessmentUrl, opensProposalDrawer: true };
    case "REVIEW_PROPOSAL":
      return { label: "Review proposal →", url: assessmentUrl, opensProposalDrawer: true };
    case "REVIEW_DECISION":
      return { label: "Review decision →", url: decisionsUrl, opensProposalDrawer: false };
    case "VIEW_DECISION":
      return { label: "View record →", url: decisionsUrl, opensProposalDrawer: false };
    case "PROMOTION_LEDGER":
      return { label: "Promotion ledger →", url: `/gradings/${session.id}/promotions`, opensProposalDrawer: false };
  }
}

/** The title and the question of the dialog that confirms a lifecycle action. */
export function confirmDetails(action: SessionAction, session: GradingSession, registeredCount: number) {
  switch (action) {
    case "DELETE": {
      const erasesFinalisedData = session.status === "LOCKED" || session.status === "COMPLETED";
      return {
        title: "Delete Grading Session",
        message: erasesFinalisedData
          ? "Are you sure you want to permanently delete this grading session? This erases every finalised outcome and promotion recorded in it, reverting any promoted student's rank. This action cannot be undone."
          : "Are you sure you want to permanently delete this grading session? This action cannot be undone.",
      };
    }
    case "CANCEL":
      return { title: "Cancel Grading Session", message: "Are you sure you want to cancel this grading session?" };
    case "LOCK":
      return {
        title: "Lock Grading Session",
        message: "Locking ends grading. Every assessment must be completed first, and after locking only the authorised Master can correct a mark, with a reason, until a candidate's decision is recorded.",
      };
    case "COMPLETE":
      return {
        title: "Complete Grading Session",
        message: "Completing this session finalises all grading results and records. Ensure all candidate decisions have been made.",
      };
    case "OPEN":
      return {
        title: "Open Grading Session",
        message: `Opening starts the grading and cannot be undone: an open session does not go back to draft. ${
          registeredCount === 0
            ? "No candidates are registered."
            : `${registeredCount} candidate${registeredCount === 1 ? " is" : "s are"} registered.`
        } Check the roster first. Once open, a candidate who already has an assessment can no longer be moved or removed; one who cannot attend can still be marked as a no-show.`,
      };
  }
}
