import type { LegacyGradingRecord, LegacyPerson } from "./api";
import { formatMonthYear } from "./dates";

/** The most records one bulk-link request takes (BULK_LINK_LIMIT in the backend). */
export const BULK_LINK_LIMIT = 500;

/** A student picked to link records to. */
export type Chosen = { student: number; name: string };

export function recordMonth(record: LegacyGradingRecord): string {
  return formatMonthYear(record.cycle_year, record.cycle_month);
}

/** The records a name would link: all of them but the ones unticked. */
export function recordsToLink(person: LegacyPerson, unticked: number[]): number[] {
  return person.record_ids.filter((id) => !unticked.includes(id));
}

/** "2025-06" as "Jun 2025". */
function periodLabel(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return year && month ? formatMonthYear(year, month) : period;
}

/** The months a name's records cover: "Mar 2025" or "Mar 2025 to Sep 2025". */
export function periodRange(person: LegacyPerson): string {
  const first = periodLabel(person.first_period);
  const last = periodLabel(person.last_period);
  return first === last ? first : `${first} to ${last}`;
}
