import type { AuditEvent } from "./api";

/**
 * An event's summary as the screens show it. New events name a student by ID
 * only; the server adds the student's current name, read now, and it is shown
 * at the end of the sentence, before its full stop ("…student 123-4-001
 * (Alex Kim)."). Older events that still carry the name show it once.
 */
export function eventSummary(event: Pick<AuditEvent, "summary" | "subject_name">): string {
  const { summary, subject_name: name } = event;
  if (!name || summary.includes(name)) return summary;
  return summary.endsWith(".") ? `${summary.slice(0, -1)} (${name}).` : `${summary} (${name})`;
}
