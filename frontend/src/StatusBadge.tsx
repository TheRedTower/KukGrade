import type { CandidateAssessment, CandidateOutcome, GradingSessionStatus, StudentStatus } from "./api";
import { Badge } from "./Badge";
import { type BadgeTone, outcomeTone } from "./badgeClass";
import { SESSION_STATUS_LABELS } from "./sessionStatus";
import { CheckIcon, CrossIcon, LockIcon, WarningIcon, XCircleIcon } from "./Icons";

/**
 * A grading session's status. The one way to show it: its colour and mark come
 * from here, so it cannot look different on two screens. Pass the label the
 * server sent when there is one.
 */
export function SessionStatusBadge({ status, label }: { status?: GradingSessionStatus; label?: string }) {
  if (!status) return null;
  const text = label || SESSION_STATUS_LABELS[status];
  const tone = status.toLowerCase() as Lowercase<GradingSessionStatus>;
  switch (status) {
    case "LOCKED":
      return <Badge tone={tone} icon={<LockIcon size={13} />}>{text}</Badge>;
    case "COMPLETED":
      return <Badge tone={tone} icon={<CheckIcon size={13} />}>{text}</Badge>;
    case "CANCELLED":
      return <Badge tone={tone} icon={<XCircleIcon size={13} />}>{text}</Badge>;
    default:
      return <Badge tone={tone} dot>{text}</Badge>;
  }
}

const STUDENT_STATUS_TONES: Record<StudentStatus, BadgeTone> = {
  ACTIVE: "success",
  INACTIVE: "warning",
  LEFT: "danger",
};

const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  LEFT: "Left",
};

/** A student's status: the one way to show it, so Left is red and Inactive amber on every screen. */
export function StudentStatusBadge({ status, label }: { status?: StudentStatus; label?: string }) {
  if (!status) return null;
  return (
    <Badge tone={STUDENT_STATUS_TONES[status]} dot>
      {label || STUDENT_STATUS_LABELS[status]}
    </Badge>
  );
}

/** A candidate's assessment: not prepared, not started, in progress or completed. */
export function AssessmentBadge({ assessment }: { assessment?: CandidateAssessment }) {
  if (!assessment) return <Badge tone="neutral">Not prepared</Badge>;
  if (assessment.status === "COMPLETED") return <Badge tone="success" icon={<CheckIcon size={12} />}>Completed</Badge>;
  if (assessment.status === "IN_PROGRESS") return <Badge tone="info" dot>In progress</Badge>;
  return <Badge tone="neutral">Not started</Badge>;
}

const OUTCOME_WORDS = { PASS: "Pass", CONDITIONAL: "Conditional", FAIL: "Fail" } as const;
const OUTCOME_ICONS = {
  PASS: <CheckIcon size={12} />,
  CONDITIONAL: <WarningIcon size={12} />,
  FAIL: <CrossIcon size={12} />,
} as const;

/** A candidate's outcome: proposed by an instructor, or finalised by the Master. */
export function OutcomeBadge({ outcome }: { outcome?: CandidateOutcome }) {
  if (!outcome) return <Badge tone="neutral">Not proposed</Badge>;
  const finalised = outcome.status === "FINALISED";
  const result = finalised ? outcome.final_outcome : outcome.status === "PROPOSED" ? outcome.proposed_outcome : null;
  if (!result) return <Badge tone="neutral">{finalised ? "Finalised" : "Not proposed"}</Badge>;
  return (
    <Badge tone={outcomeTone(result)} icon={OUTCOME_ICONS[result]}>
      {finalised ? "Finalised" : "Proposed"}: {OUTCOME_WORDS[result]}
    </Badge>
  );
}

/** Whether a syllabus item must be assessed: the same pill on every screen that lists items. */
export function RequirementBadge({ required }: { required: boolean }) {
  return required ? <Badge tone="success">Required</Badge> : <Badge tone="neutral">Optional</Badge>;
}
