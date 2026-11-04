import type { CandidateAssessment, CandidateOutcome, GradingCandidate, GradingSession } from "./api";
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

/** Each candidate with their assessment and outcome. */
export function enrichCandidates(
  candidates: GradingCandidate[],
  assessments: CandidateAssessment[],
  outcomes: CandidateOutcome[],
): EnrichedCandidate[] {
  const assessmentMap = new Map(assessments.map((a) => [a.candidate, a]));
  const outcomeMap = new Map(outcomes.map((o) => [o.candidate, o]));
  return candidates.map((candidate) => ({
    candidate,
    assessment: assessmentMap.get(candidate.id),
    outcome: outcomeMap.get(candidate.id),
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

/** What a candidate's row offers next, from where their assessment and outcome stand. */
export function nextActionFor(item: EnrichedCandidate, session: GradingSession, canMakeFinalDecision: boolean) {
  const candidateId = item.candidate.id;
  const assessmentStatus = item.assessment?.status;
  const outcomeStatus = item.outcome?.status;
  const decisionsUrl = `/gradings/${session.id}/decisions?candidate=${candidateId}`;
  let label = assessmentStatus ? "Start assessment →" : "Prepare assessment →";
  let url = `/gradings/${session.id}/assessments/${candidateId}`;
  let opensProposalDrawer = false;

  if (assessmentStatus === "IN_PROGRESS") {
    label = "Continue assessment →";
  } else if (assessmentStatus === "COMPLETED") {
    if (outcomeStatus === "FINALISED") {
      if (item.outcome?.final_outcome === "PASS") {
        label = "Promotion ledger →";
        url = `/gradings/${session.id}/promotions`;
      } else {
        label = "View record →";
        url = decisionsUrl;
      }
    } else if (outcomeStatus === "PROPOSED") {
      if (canMakeFinalDecision) {
        label = "Review decision →";
        url = decisionsUrl;
      } else {
        label = "Review proposal →";
        opensProposalDrawer = true;
      }
    } else if (session.status === "LOCKED") {
      label = "Propose outcome →";
      opensProposalDrawer = true;
    } else {
      // An outcome can only be created once the session is locked; until then
      // the record can still be reopened from its review page.
      label = "View record →";
      url = `/gradings/${session.id}/assessments/${candidateId}/review`;
    }
  }
  return { label, url, opensProposalDrawer };
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
        message: "Locking ends grading. Every assessment must be completed first, and after locking no result can be changed or reopened.",
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
