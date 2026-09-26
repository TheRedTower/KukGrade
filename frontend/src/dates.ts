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

/** A grading date as it reads throughout the app: "Tuesday, 1 June 2027". */
export function formatSessionDate(isoDate: string): string {
  return formatApiDate(
    isoDate,
    { weekday: "long", day: "numeric", month: "long", year: "numeric" },
    "",
  );
}

/**
 * Today's date as `YYYY-MM-DD` in the reader's own timezone, for comparing
 * with date-only API values and for `<input type="date">` bounds.
 * `toISOString()` gives the UTC date, which is tomorrow's date late in the
 * evening west of UTC and yesterday's just after midnight east of it.
 */
export function todayIsoDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** "5 Oct 2026" - the compact date used in tables, ledgers and the proof. */
export function formatShortDate(value: string | null | undefined, fallback = "—"): string {
  return formatApiDate(value, { day: "numeric", month: "short", year: "numeric" }, fallback);
}

/** "5 October 2026". */
export function formatLongDate(value: string | null | undefined, fallback = "—"): string {
  return formatApiDate(value, { day: "numeric", month: "long", year: "numeric" }, fallback);
}

/** "5 October 2026, 14:30" in the reader's timezone, for timestamps. */
export function formatDateTime(value: string | null | undefined, fallback = "—"): string {
  return formatApiDate(
    value,
    { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" },
    fallback,
  );
}

/** "5 Oct 2026, 14:30" - a timestamp in a table row. */
export function formatShortDateTime(value: string | null | undefined, fallback = "—"): string {
  return formatApiDate(
    value,
    { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" },
    fallback,
  );
}

/** "14:30" in the reader's timezone. */
export function formatTime(value: string | null | undefined, fallback = ""): string {
  return formatApiDate(value, { hour: "2-digit", minute: "2-digit" }, fallback);
}

/** "05 Oct" - when the year is already carried by the surrounding context. */
export function formatDayMonth(value: string | null | undefined, fallback = ""): string {
  return formatApiDate(value, { day: "2-digit", month: "short" }, fallback);
}

/**
 * How many calendar days before `now` an API value falls, in the reader's own
 * timezone: 0 for today, 1 for yesterday. `null` when it cannot be parsed.
 */
export function calendarDaysAgo(
  value: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const date = parseApiDate(value);
  if (!date) return null;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOf(now) - startOf(date)) / 86_400_000);
}
