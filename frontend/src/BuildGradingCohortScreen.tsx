import { useMemo, useState } from "react";
import { keys } from "./queryKeys";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type AgeBandEnum, type Rank, type StudentListItem, getAllStudents, getGradingSession } from "./api";
import { PageHeader } from "./PageHeader";
import { SessionFacts } from "./SessionParts";
import { RecordPage } from "./RecordPage";
import { recordStatus, useIdParam } from "./recordStatus";
import { Alert } from "./Alert";
import { useAgeBandsQuery, useRanksQuery } from "./queries";
import { useDebouncedValue } from "./useDebouncedValue";
import { SessionStatusBadge } from "./StatusBadge";
import "./BuildGradingCohort.css";
import { CohortResolver } from "./CohortResolver";
import {
  type CohortItem,
  buildRankGroups,
  cohortBreakdown,
  destinationOf,
  newCohortItems,
  rankMapOf,
} from "./cohortBuilder";
import { CohortFindSection, type StatusFilter } from "./CohortFindSection";
import { CohortRankGroupsSection } from "./CohortRankGroupsSection";
import { CohortReviewDialog } from "./CohortReviewDialog";
import { CohortTray } from "./CohortTray";
import { useCohortRegistration } from "./useCohortRegistration";
import { stickyAside } from "./stickyParts";

export function BuildGradingCohortScreen() {
  const id = useIdParam();
  // The queries wait for a real id; 0 is never sent.
  const sessionId = id ?? 0;
  const valid = id !== null;

  const [search, setSearch] = useState("");
  const [rankFilter, setRankFilter] = useState("ALL");
  const [ageFilter, setAgeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ACTIVE_INACTIVE");

  // The students chosen to register, and whether to prepare their assessment forms now.
  const [cohort, setCohort] = useState<CohortItem[]>([]);
  const [generateAssessments, setGenerateAssessments] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);

  const sessionQuery = useQuery({
    queryKey: keys.gradingSessions.detail(sessionId),
    queryFn: () => getGradingSession(sessionId),
    enabled: valid,
  });
  const session = sessionQuery.data;

  const ranksQuery = useRanksQuery();
  const ageBandsQuery = useAgeBandsQuery();
  const ageBands = useMemo(() => ageBandsQuery.data?.results ?? [], [ageBandsQuery.data]);

  // The server narrows the roster to who could still be registered and to the
  // toolbar's filters, so the screen never downloads students it would hide.
  const debouncedSearch = useDebouncedValue(search.trim());
  const studentFilters = {
    eligible_for_session: sessionId,
    search: debouncedSearch || undefined,
    current_rank: rankFilter === "ALL" ? undefined : Number(rankFilter),
    age_band: ageFilter === "ALL" ? undefined : (ageFilter as AgeBandEnum),
    status: statusFilter === "ACTIVE_INACTIVE" ? undefined : statusFilter,
  };
  const studentsQuery = useQuery({
    queryKey: keys.students.eligible(studentFilters),
    queryFn: () => getAllStudents(studentFilters),
    enabled: valid,
    placeholderData: keepPreviousData,
  });
  const eligibleStudents = useMemo(() => studentsQuery.data?.results ?? [], [studentsQuery.data]);
  // While a new filter is typed or loading, the list on screen is not yet the
  // list "Add all" would mean.
  const rosterUpdating = studentsQuery.isPlaceholderData || search.trim() !== debouncedSearch;

  const ranks: Rank[] = useMemo(
    () => [...(ranksQuery.data?.results ?? [])].sort((a, b) => a.order - b.order),
    [ranksQuery.data],
  );
  const rankMap = useMemo(() => rankMapOf(ranks), [ranks]);
  const rankGroups = useMemo(
    () => buildRankGroups(eligibleStudents, ranks, rankMap, ageBands),
    [eligibleStudents, ranks, rankMap, ageBands],
  );
  const breakdown = useMemo(() => cohortBreakdown(cohort), [cohort]);
  const inCohort = useMemo(() => new Set(cohort.map((item) => item.student.id)), [cohort]);

  const rankFor = (student: StudentListItem) => ({
    currentRank: rankMap.get(student.current_rank) ?? null,
    destinationRank: destinationOf(student, rankMap),
  });
  const addStudents = (students: StudentListItem[], ranksOf = rankFor) =>
    setCohort((prev) => [...prev, ...newCohortItems(prev, students, ranksOf)]);
  const removeStudent = (studentId: number) =>
    setCohort((prev) => prev.filter((item) => item.student.id !== studentId));
  const removeRankGroup = (rankId: number) =>
    setCohort((prev) => prev.filter((item) => item.student.current_rank !== rankId));

  const registration = useCohortRegistration({ sessionId, session, cohort, setCohort, generateAssessments });

  const status = recordStatus(id, sessionQuery);
  if (status || !session) {
    return (
      <RecordPage
        back={{ to: "/gradings", label: "Gradings" }}
        error={sessionQuery.error}
        failed="The grading session could not be loaded."
        label="Build grading cohort"
        loading="Loading the grading session…"
        missing="Grading session not found"
        status={status ?? "loading"}
        testId="bgc-page"
        onRetry={() => void sessionQuery.refetch()}
      />
    );
  }

  if (registration.resolving && registration.registrationResult) {
    return (
      <CohortResolver
        flaggedItems={registration.flaggedItems}
        isSubmitting={registration.isSubmitting}
        registrationResult={registration.registrationResult}
        session={session}
        submitError={registration.submitError}
        onDismissError={registration.clearError}
        onRemove={registration.removeFlagged}
        onRetry={registration.retry}
      />
    );
  }

  return (
    <section aria-labelledby="bgc-title" className="page" data-testid="bgc-page">
      <PageHeader
        back={{ to: `/gradings/${session.id}`, label: session.title }}
        title="Build grading cohort"
        titleId="bgc-title"
        subtitle="Add whole groups, then review any exceptions."
        tag={<SessionStatusBadge status={session.status} label={session.status_display} />}
      >
        <p className="page-header__subtitle">
          <SessionFacts session={session} />
        </p>
      </PageHeader>

      {registration.submitError && <Alert onDismiss={registration.clearError}>{registration.submitError}</Alert>}

      <div className="split">
        <div className="stack stack--6 bgc-left-column">
          <CohortFindSection
            search={search}
            onSearch={setSearch}
            rankFilter={rankFilter}
            onRankFilter={setRankFilter}
            ageFilter={ageFilter}
            onAgeFilter={setAgeFilter}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            ranks={ranks}
            rankMap={rankMap}
            ageBands={ageBands}
            students={eligibleStudents}
            updating={rosterUpdating}
            inCohort={inCohort}
            onAdd={(student) => addStudents([student])}
            onRemove={removeStudent}
            onAddAll={() => addStudents(eligibleStudents)}
          />
          <CohortRankGroupsSection
            groups={rankGroups}
            filteredCount={eligibleStudents.length}
            inCohort={inCohort}
            onAddGroup={(group) =>
              addStudents(group.students, () => ({ currentRank: group.rank, destinationRank: group.destinationRank }))
            }
            onRemoveGroup={removeRankGroup}
          />
        </div>

        <div className="split__aside" ref={stickyAside}>
          <CohortTray
            sessionId={session.id}
            count={cohort.length}
            breakdown={breakdown}
            generateAssessments={generateAssessments}
            onGenerateAssessments={setGenerateAssessments}
            submitting={registration.isSubmitting}
            onRegister={registration.submit}
            onRemoveGroup={removeRankGroup}
            onReview={() => setReviewOpen(true)}
          />
        </div>
      </div>

      {reviewOpen && (
        <CohortReviewDialog cohort={cohort} onRemove={removeStudent} onClose={() => setReviewOpen(false)} />
      )}
    </section>
  );
}
