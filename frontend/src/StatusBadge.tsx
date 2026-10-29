import type { GradingSessionStatus } from "./api";
import { Badge } from "./Badge";
import { SESSION_STATUS_LABELS } from "./sessionStatus";
import { CheckIcon, LockIcon, XCircleIcon } from "./Icons";

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
