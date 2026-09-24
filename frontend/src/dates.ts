const SESSION_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * A grading date as it reads throughout the app: "Tuesday 1 June 2027".
 *
 * The API's date-only "2027-06-01" is built as a local date rather than
 * parsed, which would read it as UTC midnight - the previous day anywhere
 * west of Greenwich. Anything unparseable is shown as given.
 */
export function formatSessionDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return SESSION_DATE_FORMAT.format(new Date(year, month - 1, day));
}
