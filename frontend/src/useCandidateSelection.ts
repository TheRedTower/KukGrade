/**
 * The candidates chosen on the session page for a PDF: their records once
 * sealed, and while the grading is a draft or open, their grading sheets.
 * Who can be chosen is the server's to say (`can_download_record`,
 * `can_print_grading_sheet`).
 */
import { useMemo, useState } from "react";

import type { EnrichedCandidate } from "./sessionDetail";

/** Who a row can be chosen for: a sealed record, or a sheet while the grading is prepared. */
function choosable(item: EnrichedCandidate): boolean {
  return item.candidate.can_download_record || item.candidate.can_print_grading_sheet;
}

export interface CandidateSelection {
  /** Whether the session offers anything to choose candidates for. */
  offered: boolean;
  isChoosable: (item: EnrichedCandidate) => boolean;
  isChosen: (item: EnrichedCandidate) => boolean;
  toggle: (item: EnrichedCandidate) => void;
  /** Every candidate chosen, in the roster's order. */
  chosen: EnrichedCandidate[];
  /** The candidates the list shows that can be chosen, and whether each one is. */
  shownChoosable: EnrichedCandidate[];
  allShownChosen: boolean;
  toggleAllShown: () => void;
  clear: () => void;
}

/** The candidates chosen on the session page; a hidden row stays chosen until cleared. */
export function useCandidateSelection(all: EnrichedCandidate[], shown: EnrichedCandidate[]): CandidateSelection {
  const [ids, setIds] = useState<ReadonlySet<number>>(new Set());
  const chosen = useMemo(() => all.filter((item) => choosable(item) && ids.has(item.candidate.id)), [all, ids]);
  const shownChoosable = useMemo(() => shown.filter(choosable), [shown]);
  const allShownChosen = shownChoosable.length > 0 && shownChoosable.every((item) => ids.has(item.candidate.id));

  return {
    offered: all.some(choosable),
    isChoosable: choosable,
    isChosen: (item) => choosable(item) && ids.has(item.candidate.id),
    toggle: (item) =>
      setIds((current) => {
        const next = new Set(current);
        if (!next.delete(item.candidate.id)) next.add(item.candidate.id);
        return next;
      }),
    chosen,
    shownChoosable,
    allShownChosen,
    toggleAllShown: () =>
      setIds((current) => {
        const next = new Set(current);
        for (const item of shownChoosable) {
          if (allShownChosen) next.delete(item.candidate.id);
          else next.add(item.candidate.id);
        }
        return next;
      }),
    clear: () => setIds(new Set()),
  };
}
