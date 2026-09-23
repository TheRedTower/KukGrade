/**
 * Shared data layer for the two candidate assessment screens.
 *
 * Mat-side scoring (`CandidateAssessmentScreen`) and completion review
 * (`AssessmentCompletionScreen`) are separate routes but read exactly the same
 * five resources and derive exactly the same rollups from them, so the queries
 * live here rather than being duplicated across both files.
 *
 * The derived counts are still computed in the browser. That is not a
 * preference: `item_counts` on the assessment serializer carries no
 * required-split, and `/api/gradings/outcomes/{id}/summary/` needs a
 * `CandidateOutcome`, which cannot exist until the session is `LOCKED` and the
 * assessment `COMPLETED`. See FDR-046 and the 2026-09-23 decision log entry -
 * moving these to a served summary is a separate slice.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CandidateAssessmentItem,
  GradingCandidate,
  getAllGradingCandidates,
  getCandidateAssessments,
  getAllCandidateAssessmentItems,
  getGradingSession,
  getStudents,
} from "./api";

export function formatTimeOnly(isoStr: string | null): string {
  if (!isoStr) return "";
  try {
    const date = new Date(isoStr);
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return "";
  }
}

export interface CategoryGroup {
  category: string;
  categoryDisplay: string;
  koreanName?: string;
  items: CandidateAssessmentItem[];
  totalCount: number;
  requiredCount: number;
  requiredAssessedCount: number;
  remainingRequiredCount: number;
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

  // 3. The candidate's student, for their current rank
  const studentQuery = useQuery({
    queryKey: ["student", candidate?.student],
    queryFn: () => getStudents({ search: candidate?.student_wksa_id }),
    enabled: !!candidate?.student_wksa_id,
  });

  const studentRankName = useMemo(() => {
    if (studentQuery.data?.results && studentQuery.data.results.length > 0) {
      return studentQuery.data.results[0].current_rank_name;
    }
    return "";
  }, [studentQuery.data]);

  // 4. The assessment itself. `null` means the form has not been generated yet,
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

  // 5. The immutable syllabus snapshot rows
  const itemsQuery = useQuery({
    queryKey: ["candidateAssessmentItems", assessment?.id],
    queryFn: () => getAllCandidateAssessmentItems({ assessment: assessment!.id }),
    enabled: !!assessment?.id,
  });

  const items = useMemo(() => {
    return itemsQuery.data?.results ?? [];
  }, [itemsQuery.data]);

  // Grouped by category. The backend orders items by requirement sequence and
  // does not order by category, so the grouping is deliberately a client
  // concern - see the redesign handoff.
  const categoryGroups: CategoryGroup[] = useMemo(() => {
    if (items.length === 0) return [];

    const map = new Map<string, CategoryGroup>();
    for (const item of items) {
      const catKey = item.category;
      if (!map.has(catKey)) {
        map.set(catKey, {
          category: catKey,
          categoryDisplay: item.category_display || catKey,
          koreanName: item.korean_name,
          items: [],
          totalCount: 0,
          requiredCount: 0,
          requiredAssessedCount: 0,
          remainingRequiredCount: 0,
          isDone: false,
        });
      }
      const group = map.get(catKey)!;
      group.items.push(item);
      group.totalCount += 1;
      if (item.required) {
        group.requiredCount += 1;
        if (item.result !== "NOT_ASSESSED") {
          group.requiredAssessedCount += 1;
        }
      }
    }

    return Array.from(map.values()).map((g) => {
      const remaining = g.requiredCount - g.requiredAssessedCount;
      return {
        ...g,
        remainingRequiredCount: remaining,
        isDone: remaining === 0,
      };
    });
  }, [items]);

  // Overall rollup. Only `required` items gate completion; optional items may
  // legitimately be left unassessed, which is why `notAssessedCount` alone can
  // never decide whether the assessment can be completed.
  const stats = useMemo(() => {
    let totalItems = 0;
    let requiredItems = 0;
    let requiredAssessed = 0;
    let metCount = 0;
    let notMetCount = 0;
    let notAssessedCount = 0;

    for (const item of items) {
      totalItems += 1;
      if (item.required) {
        requiredItems += 1;
        if (item.result !== "NOT_ASSESSED") {
          requiredAssessed += 1;
        }
      }
      if (item.result === "MET") metCount += 1;
      else if (item.result === "NOT_MET") notMetCount += 1;
      else notAssessedCount += 1;
    }

    const remainingRequired = requiredItems - requiredAssessed;
    const percent = requiredItems > 0 ? Math.round((requiredAssessed / requiredItems) * 100) : 100;

    return {
      totalItems,
      requiredItems,
      requiredAssessed,
      remainingRequired,
      percent,
      metCount,
      notMetCount,
      notAssessedCount,
      canComplete: remainingRequired === 0 && requiredItems > 0,
    };
  }, [items]);

  const isLoading =
    sessionQuery.isLoading ||
    candidatesQuery.isLoading ||
    assessmentQuery.isLoading ||
    (!!assessment && itemsQuery.isLoading);

  return {
    session: sessionQuery.data,
    candidate,
    studentRankName,
    assessment,
    items,
    categoryGroups,
    stats,
    isLoading,
  };
}
