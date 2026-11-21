import type { AgeBand, Rank, StudentListItem } from "./api";

/** A student chosen for the cohort, with the rank they hold and the rank they would test for. */
export interface CohortItem {
  student: StudentListItem;
  currentRank: Rank | null;
  destinationRank: Rank | null;
}

/** The eligible students who hold one rank, with the counts the group row shows. */
export interface RankGroup {
  rank: Rank;
  destinationRank: Rank | null;
  students: StudentListItem[];
  activeCount: number;
  inactiveCount: number;
  programmeCounts: { label: string; count: number }[];
}

/** The ranks by id. */
export function rankMapOf(ranks: Rank[]) {
  return new Map(ranks.map((rank) => [rank.id, rank]));
}

/** The rank a student would test for, as the server serves it on their row (next_rank). */
export function destinationOf(student: StudentListItem, rankMap: Map<number, Rank>): Rank | null {
  return student.next_rank === null ? null : (rankMap.get(student.next_rank) ?? null);
}

/** The students grouped by the rank they hold, in the order of the ranks. */
export function buildRankGroups(
  students: StudentListItem[],
  ranks: Rank[],
  rankMap: Map<number, Rank>,
  ageBands: AgeBand[],
): RankGroup[] {
  // One count per programme, in the order the server lists the age bands.
  const programmes = ageBands.filter(
    (band, index) => ageBands.findIndex((other) => other.programme === band.programme) === index,
  );

  const byRank = new Map<number, StudentListItem[]>();
  for (const student of students) {
    byRank.set(student.current_rank, [...(byRank.get(student.current_rank) ?? []), student]);
  }

  const groups: RankGroup[] = [];
  for (const rank of ranks) {
    const inRank = byRank.get(rank.id);
    if (!inRank?.length) continue;
    groups.push({
      rank,
      // Everyone in the group holds the same rank, so tests for the same next one.
      destinationRank: destinationOf(inRank[0], rankMap),
      students: inRank,
      activeCount: inRank.filter((s) => s.status === "ACTIVE").length,
      inactiveCount: inRank.filter((s) => s.status === "INACTIVE").length,
      programmeCounts: programmes.map((band) => ({
        label: band.programme_display,
        count: inRank.filter((s) => ageBands.some((b) => b.code === s.age_band && b.programme === band.programme))
          .length,
      })),
    });
  }
  return groups;
}

/** The cohort counted by the rank its students hold. */
export function cohortBreakdown(cohort: CohortItem[]) {
  const byRank = new Map<
    number,
    { rankId: number; currentRank: Rank | null; destinationRank: Rank | null; count: number }
  >();
  for (const item of cohort) {
    const rankId = item.student.current_rank;
    const entry = byRank.get(rankId) ?? {
      rankId,
      currentRank: item.currentRank,
      destinationRank: item.destinationRank,
      count: 0,
    };
    entry.count += 1;
    byRank.set(rankId, entry);
  }
  return [...byRank.values()];
}

/** The students not yet in the cohort, as cohort items. */
export function newCohortItems(
  cohort: CohortItem[],
  students: StudentListItem[],
  rankFor: (student: StudentListItem) => { currentRank: Rank | null; destinationRank: Rank | null },
): CohortItem[] {
  const inCohort = new Set(cohort.map((item) => item.student.id));
  return students.filter((student) => !inCohort.has(student.id)).map((student) => ({ student, ...rankFor(student) }));
}
