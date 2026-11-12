import type { CandidateAssessment, CandidateOutcome, GradingSessionStatus, StudentStatus } from "./api";
import { Badge } from "./Badge";
import { type BadgeTone, outcomeTone } from "./badgeClass";
import { CheckIcon, CrossIcon, LockIcon, WarningIcon, XCircleIcon } from "./Icons";

/**
 * A grading session's status. The one way to show it: its colour and mark come
 * from here, so it cannot look different on two screens. The label is the
 * server's name for the status.
 */
export function SessionStatusBadge({ status, label }: { status?: GradingSessionStatus; label: string }) {
  if (!status) return null;
  const tone = status.toLowerCase() as Lowercase<GradingSessionStatus>;
  switch (status) {
    case "LOCKED":
      return (
        <Badge tone={tone} icon={<LockIcon size={13} />}>
          {label}
        </Badge>
      );
    case "COMPLETED":
      return (
        <Badge tone={tone} icon={<CheckIcon size={13} />}>
          {label}
        </Badge>
      );
    case "CANCELLED":
      return (
        <Badge tone={tone} icon={<XCircleIcon size={13} />}>
          {label}
        </Badge>
      );
    default:
      return (
        <Badge tone={tone} dot>
          {label}
        </Badge>
      );
  }
}

const STUDENT_STATUS_TONES: Record<StudentStatus, BadgeTone> = {
  ACTIVE: "success",
  INACTIVE: "warning",
  LEFT: "danger",
};

/** A student's status: the one way to show it, so Left is red and Inactive amber on every screen. */
export function StudentStatusBadge({ status, label }: { status?: StudentStatus; label: string }) {
  if (!status) return null;
  return (
    <Badge tone={STUDENT_STATUS_TONES[status]} dot>
      {label}
    </Badge>
  );
}

/** A candidate's assessment: not prepared, not started, in progress or completed. */
export function AssessmentBadge({ assessment }: { assessment?: CandidateAssessment }) {
  if (!assessment) return <Badge tone="neutral">Not prepared</Badge>;
  const label = assessment.status_display;
  if (assessment.status === "COMPLETED")
    return (
      <Badge tone="success" icon={<CheckIcon size={12} />}>
        {label}
      </Badge>
    );
  if (assessment.status === "IN_PROGRESS")
    return (
      <Badge tone="info" dot>
        {label}
      </Badge>
    );
  return <Badge tone="neutral">{label}</Badge>;
}

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
  const label = finalised ? outcome.final_outcome_display : outcome.proposed_outcome_display;
  return (
    <Badge tone={outcomeTone(result)} icon={OUTCOME_ICONS[result]}>
      {outcome.status_display}: {label}
    </Badge>
  );
}

/** Whether a syllabus item must be assessed: the same pill on every screen that lists items. */
export function RequirementBadge({ required }: { required: boolean }) {
  return required ? <Badge tone="success">Required</Badge> : <Badge tone="neutral">Optional</Badge>;
}
