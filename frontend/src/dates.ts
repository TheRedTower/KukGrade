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
 *   keep normal parsing and are shown in the club's time zone (below).
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
 * The club's time zone (an IANA name, served by `/api/site/`). Timestamps are
 * shown in it and "today" is today there, whatever the reader's browser says.
 * Until it is known, or if it is not a zone this browser knows, the browser's
 * own is used. Date-only values never take a zone: a day of birth or a
 * grading day is the same calendar day everywhere.
 */
let clubTimeZone: string | undefined;

export function setClubTimeZone(zone: string | null | undefined): void {
  try {
    if (zone) new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    clubTimeZone = zone || undefined;
  } catch {
    clubTimeZone = undefined;
  }
}

/** The calendar day an instant falls on in the club's zone. */
function clubDay(instant: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: clubTimeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

/**
 * Parses an API date or timestamp, or returns `null` when the value is absent
 * or unparseable. Callers decide what to render for `null`.
 */
function parseApiDate(value: string | null | undefined): Date | null {
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
    const timeZone = DATE_ONLY.test(value) ? undefined : clubTimeZone;
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(date);
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
 * Today's date as `YYYY-MM-DD` in the club's time zone, for comparing with
 * date-only API values and for `<input type="date">` bounds.
 * `toISOString()` gives the UTC date, which is tomorrow's date late in the
 * evening west of UTC and yesterday's just after midnight east of it.
 */
export function todayIsoDate(now: Date = new Date()): string {
  const { year, month, day } = clubDay(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** This year, in the club's time zone. */
export function currentYear(now: Date = new Date()): number {
  return clubDay(now).year;
}

/** "5 Oct 2026" - the compact date used in tables, ledgers and the proof. */
export function formatShortDate(value: string | null | undefined, fallback = "—"): string {
  return formatApiDate(value, { day: "numeric", month: "short", year: "numeric" }, fallback);
}

/** "5 October 2026". */
export function formatLongDate(value: string | null | undefined, fallback = "—"): string {
  return formatApiDate(value, { day: "numeric", month: "long", year: "numeric" }, fallback);
}

/** "5 October 2026, 14:30" in the club's time zone, for timestamps. */
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

/** "14:30" in the club's time zone. */
export function formatTime(value: string | null | undefined, fallback = ""): string {
  return formatApiDate(value, { hour: "2-digit", minute: "2-digit" }, fallback);
}

/** "05 Oct" - when the year is already carried by the surrounding context. */
export function formatDayMonth(value: string | null | undefined, fallback = ""): string {
  return formatApiDate(value, { day: "2-digit", month: "short" }, fallback);
}

/** "Jun 2025" - a historical record's grading month, given as numbers. */
export function formatMonthYear(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );
}

/**
 * How many calendar days before `now` an API value falls, in the club's time
 * zone: 0 for today, 1 for yesterday. `null` when it cannot be parsed. A
 * date-only value is its own calendar day; a timestamp is the club's day it
 * falls on. Days are counted as calendar days, not 24-hour periods, so a
 * clock change does not move the answer.
 */
export function calendarDaysAgo(
  value: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const date = parseApiDate(value);
  if (!value || !date) return null;
  const then = DATE_ONLY.test(value)
    ? { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
    : clubDay(date);
  const dayNumber = ({ year, month, day }: { year: number; month: number; day: number }) =>
    Date.UTC(year, month - 1, day) / 86_400_000;
  return dayNumber(clubDay(now)) - dayNumber(then);
}
