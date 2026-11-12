/** "1 row", "3 rows": a count with the noun that agrees with it. */
export function counted(count: number, one: string, many: string): string {
  return `${count} ${agreeing(count, one, many)}`;
}

/** The words that agree with a count: "is" or "are", "was" or "were". */
export function agreeing(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
