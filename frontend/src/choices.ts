import type { Choices } from "./api";
import { useChoicesQuery } from "./queries";

const NONE_YET: Choices = {
  session_statuses: [],
  student_statuses: [],
  candidate_statuses: [],
  assessment_statuses: [],
  item_results: [],
  withdrawal_reasons: [],
  outcomes: [],
  import_kinds: [],
  finished_import_statuses: [],
  import_row_outcomes: [],
  roles: [],
  authorities: [],
  staff_ranks: [],
};

/**
 * Every list of choices the screens offer, as the server serves them (/api/choices/).
 * Until they arrive every list is empty, so a filter offers only its "All".
 * A record's own value is named by its `*_display` field instead.
 */
export function useChoices(): Choices {
  return useChoicesQuery().data ?? NONE_YET;
}

/** The name of one value in a served list, or "" while the list loads. */
export function labelOf<V extends string>(list: readonly { value: V; label: string }[], value: V): string {
  return list.find((choice) => choice.value === value)?.label ?? "";
}
