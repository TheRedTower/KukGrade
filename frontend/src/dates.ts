/**
 * Parsing and formatting for dates that come back from the API.
 *
 * The API returns two shapes, and they must be parsed differently:
 *
 * - **Date-only** (`2026-10-15`) — `grading_date`, `Promotion.effective_date`,
 *   `Student.date_of_birth`, `GradingHistoryItem.date`. `new Date()` reads
 *   these as **UTC midnight** per the ECMAScript date-time string format, so
 *   west of UTC they render as the *previous day*. On a grading record, a
 *   promotion date or a date of birth, that is a factual error rather than a
 *   display nit, so these are split into local year/month/day.
 * - **Timestamps** (`2026-10-15T10:05:00Z`) — `created_at`, `promoted_at`,
 *   `generated_at`, `completed_at`, `occurred_at`. These carry an offset and
 *   must keep normal parsing so they render in the reader's own timezone.
 *
 * The shape is detected from the value, not chosen by the caller, because
 * several formatters receive both kinds - `StudentDetailScreen` formats
 * `date_of_birth` and `created_at` through the same function.
 *
 * This module exists because the same formatter had been written six times
 * across the app with three different parsing strategies, two of which were
 * wrong. A single implementation is the only thing that keeps them from
 * drifting apart again.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses an API date or timestamp, or returns `null` when the value is absent
 * or unparseable. Callers decide what to render for `null`.
 */
export function parseApiDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  if (DATE_ONLY.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Formats an API date or timestamp in en-GB. Returns `fallback` when the value
 * is absent, and the original string when it cannot be parsed - so a value the
 * app does not understand is still shown rather than silently blanked.
 */
export function formatApiDate(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
  fallback = "—",
): string {
  if (!value) return fallback;
  const date = parseApiDate(value);
  if (!date) return value;
  try {
    return new Intl.DateTimeFormat("en-GB", options).format(date);
  } catch {
    return value;
  }
}

/**
 * Whole years between a date of birth and today.
 *
 * Age decides the applicable age band, and the age band decides which syllabus
 * a candidate is assessed against - so an off-by-one here is a domain error,
 * not a cosmetic one. `date_of_birth` is date-only, which is why this goes
 * through `parseApiDate` rather than `new Date()`.
 */
export function calculateAge(dobStr: string | null | undefined): number | null {
  const dob = parseApiDate(dobStr);
  if (!dob) return null;

  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDelta = today.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}
