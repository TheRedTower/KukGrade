import type { LegacyGradingRecord } from "./api";
import { formatMonthYear } from "./dates";

/** A student picked to link records to. */
export type Chosen = { student: number; name: string };

export function recordMonth(record: LegacyGradingRecord): string {
  return formatMonthYear(record.cycle_year, record.cycle_month);
}

/** "2025-06" as "Jun 2025". */
function periodLabel(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return year && month ? formatMonthYear(year, month) : period;
}

/** The months someone's records cover: "Mar 2025" or "Mar 2025 to Sep 2025". */
export function periodRange({ first_period, last_period }: { first_period: string; last_period: string }): string {
  const first = periodLabel(first_period);
  const last = periodLabel(last_period);
  return first === last ? first : `${first} to ${last}`;
}
