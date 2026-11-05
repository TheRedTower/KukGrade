import type { AuditEvent } from "./api";

/**
 * An event's summary as the screens show it. New events name a student by ID
 * only; the server adds the student's current name, read now, and it is shown
 * after the summary. Older events that still carry the name show it once.
 */
export function eventSummary(event: Pick<AuditEvent, "summary" | "subject_name">): string {
  const name = event.subject_name;
  return name && !event.summary.includes(name) ? `${event.summary} (${name})` : event.summary;
}
