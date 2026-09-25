/**
 * Shared data layer for the two candidate assessment screens.
 *
 * Mat-side scoring (`CandidateAssessmentScreen`) and completion review
 * (`AssessmentCompletionScreen`) are separate routes but read exactly the same
 * four resources and derive exactly the same rollups from them, so the queries
 * live here rather than being duplicated across both files.
 *
 * Counts come from `GET /api/gradings/assessments/{id}/summary/`, not from
 * recounting rows here (FDR-046). `item_counts` carries no required-split and
 * the outcome summary needs a `CandidateOutcome` that cannot exist while an
 * assessment is being scored, which is why that endpoint was added.
 *
 * The client still groups items by category for rendering, because the backend
 * orders by requirement sequence and category is not an ordering key. It no
 * longer decides the counts.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CandidateAssessmentItem,
  CategoryAssessmentSummary,
  GradingCandidate,
  getAllGradingCandidates,
  getAssessmentSummary,
  getCandidateAssessments,
  getAllCandidateAssessmentItems,
  getGradingSession,
} from "./api";
import { formatApiDate } from "./dates";

export function formatTimeOnly(isoStr: string | null): string {
  return formatApiDate(isoStr, { hour: "2-digit", minute: "2-digit" }, "");
}

/**
 * Day and month only, for the snapshot provenance line. The year is carried by
 * the session, so repeating it on every row of chrome is noise.
 */
export function formatDayMonth(isoStr: string | null): string {
  return formatApiDate(isoStr, { day: "2-digit", month: "short" }, "");
}

export interface CategoryGroup {
  category: string;
  categoryDisplay: string;
  items: CandidateAssessmentItem[];
  totalCount: number;
  requiredCount: number;
  requiredAssessedCount: number;
  remainingRequiredCount: number;
  metCount: number;
  notMetCount: number;
  notAssessedCount: number;
  isDone: boolean;
}

export function useCandidateAssessmentData(
  numSessionId: number | undefined,
  numCandidateId: number | undefined,
) {
  const sessionEnabled = numSessionId !== undefined && !isNaN(numSessionId);
  const candidateEnabled = numCandidateId !== undefined && !isNaN(numCandidateId);

  // 1. Grading session
  const sessionQuery = useQuery({
    queryKey: ["gradingSession", numSessionId],
    queryFn: () => getGradingSession(numSessionId!),
    enabled: sessionEnabled,
  });

  // 2. Candidates for the session, narrowed to this one
  const candidatesQuery = useQuery({
    queryKey: ["gradingCandidates", numSessionId],
    queryFn: () => getAllGradingCandidates({ session: numSessionId! }),
    enabled: sessionEnabled,
  });

  const candidate: GradingCandidate | undefined = useMemo(() => {
    if (!candidatesQuery.data?.results || !numCandidateId) return undefined;
    return candidatesQuery.data.results.find((c) => c.id === numCandidateId);
  }, [candidatesQuery.data, numCandidateId]);

  // 3. The assessment itself. `null` means the form has not been generated yet,
  // which is a distinct state from "still loading".
  const assessmentQuery = useQuery({
    queryKey: ["candidateAssessment", numCandidateId],
    queryFn: async () => {
      const res = await getCandidateAssessments({ candidate: numCandidateId! });
      return res.results.length > 0 ? res.results[0] : null;
    },
    enabled: candidateEnabled,
  });

  const assessment = assessmentQuery.data;

  // 4. The immutable syllabus snapshot rows
  const itemsQuery = useQuery({
    queryKey: ["candidateAssessmentItems", assessment?.id],
    queryFn: () => getAllCandidateAssessmentItems({ assessment: assessment!.id }),
    enabled: !!assessment?.id,
  });

  const items = useMemo(() => {
    return itemsQuery.data?.results ?? [];
  }, [itemsQuery.data]);

  // 5. Served rollup. Kept on its own key so a single item PATCH can
  // invalidate it without refetching the whole item list.
  const summaryQuery = useQuery({
    queryKey: ["candidateAssessmentSummary", assessment?.id],
    queryFn: () => getAssessmentSummary(assessment!.id),
    enabled: !!assessment?.id,
  });

  const summary = summaryQuery.data;

  // Grouped by category for rendering only. The backend orders items by
  // requirement sequence and category is not an ordering key, so the grouping
  // is a client concern - but the counts on each group come from the served
  // summary, not from recounting these rows (FDR-046).
  const categoryGroups: CategoryGroup[] = useMemo(() => {
    if (items.length === 0) return [];

    const order: string[] = [];
    const itemsByCategory = new Map<string, CandidateAssessmentItem[]>();
    const displayByCategory = new Map<string, string>();

    for (const item of items) {
      if (!itemsByCategory.has(item.category)) {
        itemsByCategory.set(item.category, []);
        displayByCategory.set(item.category, item.category_display || item.category);
        order.push(item.category);
      }
      itemsByCategory.get(item.category)!.push(item);
    }

    const servedByCategory = new Map<string, CategoryAssessmentSummary>(
      (summary?.categories ?? []).map((category) => [category.category, category]),
    );

    return order.map((category) => {
      const served = servedByCategory.get(category);
      const requiredCount = served?.required ?? 0;
      const remaining = served?.required_not_assessed ?? 0;

      return {
        category,
        categoryDisplay: displayByCategory.get(category)!,
        items: itemsByCategory.get(category)!,
        totalCount: served?.total ?? 0,
        requiredCount,
        requiredAssessedCount: requiredCount - remaining,
        remainingRequiredCount: remaining,
        metCount: served?.met ?? 0,
        notMetCount: served?.not_met ?? 0,
        notAssessedCount: served?.not_assessed ?? 0,
        isDone: served?.all_required_assessed ?? false,
      };
    });
  }, [items, summary]);

  // Overall rollup, served. Only `required` items gate completion; optional
  // items may legitimately be left unassessed, which is why `not_assessed`
  // alone can never decide whether the assessment can be completed - the
  // server's `required_not_assessed` and `all_required_assessed` can.
  const stats = useMemo(() => {
    const overall = summary?.overall;
    const requiredItems = overall?.required ?? 0;
    const requiredAssessed = requiredItems - (overall?.required_not_assessed ?? 0);
    const remainingRequired = overall?.required_not_assessed ?? 0;

    return {
      totalItems: overall?.total ?? 0,
      requiredItems,
      requiredAssessed,
      remainingRequired,
      percent: requiredItems > 0 ? Math.round((requiredAssessed / requiredItems) * 100) : 100,
      metCount: overall?.met ?? 0,
      notMetCount: overall?.not_met ?? 0,
      notAssessedCount: overall?.not_assessed ?? 0,
      canComplete: (overall?.all_required_assessed ?? false) && requiredItems > 0,
    };
  }, [summary]);

  const isLoading =
    sessionQuery.isLoading ||
    candidatesQuery.isLoading ||
    assessmentQuery.isLoading ||
    (!!assessment && (itemsQuery.isLoading || summaryQuery.isLoading));

  // The rollup and the item rows are fetched separately, so either can fail on
  // its own. Without this the screen renders normally with every count at
  // zero, which reads as a real - and wrong - answer rather than a failure.
  const hasLoadError = summaryQuery.isError || itemsQuery.isError;

  return {
    session: sessionQuery.data,
    candidate,
    assessment,
    items,
    categoryGroups,
    stats,
    isLoading,
    hasLoadError,
  };
}

/**
 * Draft of `CandidateAssessment.notes` while the record is still unsealed.
 *
 * Completion review is its own route, so navigating back to scoring to correct
 * a score unmounts the screen. Holding the draft in component state would
 * discard whatever the instructor had typed - which the previous in-page
 * review did not do, because it never unmounted. The draft therefore lives in
 * the query cache, keyed by candidate, so it survives the round trip and is
 * cleared once the assessment is sealed.
 *
 * `null` means "no draft", so the server value is shown - the same semantics
 * the previous `userNotes` state had.
 */
export function useAssessmentNotesDraft(numCandidateId: number | undefined) {
  const queryClient = useQueryClient();

  const [draft, setDraftState] = useState<string | null>(
    () => queryClient.getQueryData<string>(["assessmentNotesDraft", numCandidateId]) ?? null,
  );

  const setDraft = useCallback(
    (value: string) => {
      setDraftState(value);
      // Nothing observes this entry while the scoring screen is open, so the
      // default five-minute garbage collection would silently discard the
      // draft during a longer correction. It lives until cleared instead.
      queryClient.setQueryDefaults(["assessmentNotesDraft"], { gcTime: Infinity });
      queryClient.setQueryData(["assessmentNotesDraft", numCandidateId], value);
    },
    [queryClient, numCandidateId],
  );

  const clearDraft = useCallback(() => {
    setDraftState(null);
    queryClient.removeQueries({ queryKey: ["assessmentNotesDraft", numCandidateId] });
  }, [queryClient, numCandidateId]);

  return { draft, setDraft, clearDraft };
}
