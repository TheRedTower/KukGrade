import { useQueryClient } from "@tanstack/react-query";

import { keys } from "./queryKeys";

/**
 * After a change to the imported history (a person decided, a record linked,
 * corrected or voided): the records, the people and the students' histories
 * are read again.
 */
export function useLegacyRefresh() {
  const queryClient = useQueryClient();
  return async function refresh() {
    await Promise.all(
      [keys.legacyRecords.all(), keys.legacyPeople.all(), keys.students.all()].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  };
}
