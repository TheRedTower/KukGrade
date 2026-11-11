import { cx } from "./cx";

export type BadgeTone =
  "success" | "warning" | "danger" | "info" | "neutral" | "draft" | "open" | "locked" | "completed" | "cancelled";

/** The class and tone of a badge, for something that is not a <span> (a link that looks like one). */
export function badgeProps(tone: BadgeTone, extra?: string): { className: string; "data-tone": BadgeTone } {
  return { className: cx("badge", extra), "data-tone": tone };
}

const OUTCOME_TONES = { PASS: "success", CONDITIONAL: "warning", FAIL: "danger" } as const;

/** The tone of a PASS, CONDITIONAL or FAIL result (anything else reads as a caution). */
export function outcomeTone(result: string | null | undefined): BadgeTone {
  return result === "PASS" || result === "CONDITIONAL" || result === "FAIL" ? OUTCOME_TONES[result] : "warning";
}

/** The tone of an assessment's status. */
export function assessmentTone(status: string | null | undefined): BadgeTone {
  return status === "COMPLETED" ? "success" : status === "IN_PROGRESS" ? "info" : "neutral";
}
