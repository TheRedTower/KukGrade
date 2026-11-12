import { useRef } from "react";
import { type UseMutationOptions, useIsMutating, useQueryClient } from "@tanstack/react-query";

import { type CandidateAssessmentItem, type CandidateAssessmentItemResult, updateCandidateAssessmentItem } from "./api";
import { keys } from "./queryKeys";

type CandidateAssessmentItemSaved = Awaited<ReturnType<typeof updateCandidateAssessmentItem>>;

interface ItemWrite {
  result: CandidateAssessmentItemResult;
  reason?: string;
}

interface WriteContext {
  seq: number;
  before: CandidateAssessmentItem | undefined;
}

export type ItemWriteOptions = UseMutationOptions<CandidateAssessmentItemSaved, Error, ItemWrite, WriteContext>;

/**
 * Item writes. Several can be in flight at once - scoring is fast - so each
 * keeps to its own item: an item's writes share one mutation scope, so they
 * go out in the order they were made and the server keeps the last; each
 * confirms or rolls back only that item, and only if nothing newer was
 * written to it since; and the item list and rollup are refetched once, when
 * every write has landed, because a refetch between writes would overwrite
 * those still in flight.
 */
export function useItemWrites({
  assessmentId,
  candidateId,
  onError,
}: {
  assessmentId: number | undefined;
  candidateId: number | undefined;
  onError: (err: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const itemsKey = keys.candidateAssessmentItems(assessmentId);
  const writeKey = keys.assessmentItemWrite(assessmentId);
  const isSaving = useIsMutating({ mutationKey: writeKey }) > 0;
  const writeSeq = useRef(new Map<number, number>());
  // Whether two writes were ever in flight together since the rollup was last
  // read. A write's answer carries the counts as its own save left them, which
  // is the whole truth only when nothing else was being saved; with overlap the
  // last answer to arrive may not be the last save to land, so the rollup is
  // read again instead.
  const writesOverlapped = useRef(false);
  const writesInFlight = useRef(0);

  const patchItem = (itemId: number, change: (item: CandidateAssessmentItem) => CandidateAssessmentItem) => {
    queryClient.setQueryData<{ results: CandidateAssessmentItem[] }>(itemsKey, (data) =>
      data ? { ...data, results: data.results.map((item) => (item.id === itemId ? change(item) : item)) } : data,
    );
  };
  const isLatestWrite = (itemId: number, seq: number) => writeSeq.current.get(itemId) === seq;

  const writeOptions = (itemId: number): ItemWriteOptions => ({
    mutationKey: writeKey,
    // One queue per item: a write waits for the one before it to that item.
    scope: { id: JSON.stringify([...writeKey, itemId]) },
    mutationFn: ({ result, reason }) => updateCandidateAssessmentItem(itemId, reason ? { result, reason } : { result }),
    onMutate: async ({ result }) => {
      if (writesInFlight.current > 0) writesOverlapped.current = true;
      writesInFlight.current += 1;
      await queryClient.cancelQueries({ queryKey: itemsKey });
      const seq = (writeSeq.current.get(itemId) ?? 0) + 1;
      writeSeq.current.set(itemId, seq);
      const before = queryClient
        .getQueryData<{ results: CandidateAssessmentItem[] }>(itemsKey)
        ?.results.find((item) => item.id === itemId);
      // Shown as the server will hold it: marked, and with this change in its
      // log, so whatever comes next is a later change that says why.
      patchItem(itemId, (item) => ({ ...item, result, reason_required: true }));
      return { seq, before };
    },
    onSuccess: (saved, _vars, context) => {
      if (context && isLatestWrite(itemId, context.seq)) {
        // The item as the list serves it, without the counts that came with it.
        const { assessment_summary: counts, ...item } = saved;
        void counts;
        patchItem(itemId, () => item);
      }
    },
    onError: (err, _vars, context) => {
      if (context?.before && isLatestWrite(itemId, context.seq)) {
        const before = context.before;
        patchItem(itemId, () => before);
      }
      onError(err);
    },
    onSettled: (saved) => {
      // Counted here rather than asked of the cache: two answers that land in the
      // same moment both still count as pending there, and neither would then
      // see itself as the last.
      writesInFlight.current -= 1;
      if (writesInFlight.current > 0) return;
      queryClient.invalidateQueries({ queryKey: itemsKey });
      // The rollup is served, so a scored item has to refresh it or the mat
      // bar and category headers go stale. A lone write brought the counts back
      // with it, so they are used as they are; after overlapping writes, or
      // a failed one, they are read again.
      const counts = writesOverlapped.current ? undefined : saved?.assessment_summary;
      writesOverlapped.current = false;
      const summaryKey = keys.candidateAssessmentSummary(assessmentId);
      if (counts) {
        // A read of the counts still in flight (from an earlier overlap or a
        // failed save) would land after these and put older counts over them,
        // with nothing left to correct it: it is cancelled first. Not awaited,
        // so the write does not stay pending while it is.
        void queryClient
          .cancelQueries({ queryKey: summaryKey })
          .then(() => queryClient.setQueryData(summaryKey, counts));
      } else {
        queryClient.invalidateQueries({ queryKey: summaryKey });
      }
      queryClient.invalidateQueries({ queryKey: keys.candidateAssessments.byCandidate(candidateId) });
    },
  });

  return { writeKey, isSaving, patchItem, writeOptions };
}
