import type { GradingSessionStatus } from "./api";

/** The words for each status, for a filter or a list that is not showing a badge. */
export const SESSION_STATUS_LABELS: Record<GradingSessionStatus, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  LOCKED: "Locked",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
