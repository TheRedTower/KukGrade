import { useMemo, useState } from "react";
import { keys } from "./queryKeys";
import { Link, useParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type AgeBandEnum, type Rank, type StudentListItem, errorMessage, getAllStudents, getGradingSession } from "./api";
import { PageHeader } from "./PageHeader";
import { SessionFacts } from "./SessionParts";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";
import { Alert } from "./Alert";
import { useAgeBandsQuery, useRanksQuery } from "./queries";
import { useDebouncedValue } from "./useDebouncedValue";
import { SessionStatusBadge } from "./StatusBadge";
import "./BuildGradingCohort.css";
import { buttonClass } from "./buttonClass";
import { CohortResolver } from "./CohortResolver";
import { type CohortItem, buildRankGroups, cohortBreakdown, destinationOf, newCohortItems, rankMapOf } from "./cohortBuilder";
import { CohortFindSection, type StatusFilter } from "./CohortFindSection";
import { CohortRankGroupsSection } from "./CohortRankGroupsSection";
import { CohortReviewDialog } from "./CohortReviewDialog";
import { CohortTray } from "./CohortTray";
import { useCohortRegistration } from "./useCohortRegistration";

export function BuildGradingCohortScreen() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const valid = !isNaN(sessionId);

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

  const ranks: Rank[] = useMemo(() => [...(ranksQuery.data?.results ?? [])].sort((a, b) => a.order - b.order), [ranksQuery.data]);
  const rankMap = useMemo(() => rankMapOf(ranks), [ranks]);
  const rankGroups = useMemo(() => buildRankGroups(eligibleStudents, ranks, rankMap, ageBands), [eligibleStudents, ranks, rankMap, ageBands]);
  const breakdown = useMemo(() => cohortBreakdown(cohort), [cohort]);
  const inCohort = useMemo(() => new Set(cohort.map((item) => item.student.id)), [cohort]);

  const rankFor = (student: StudentListItem) => ({
    currentRank: rankMap.get(student.current_rank) ?? null,
    destinationRank: destinationOf(student, rankMap),
  });
  const addStudents = (students: StudentListItem[], ranksOf = rankFor) =>
    setCohort((prev) => [...prev, ...newCohortItems(prev, students, ranksOf)]);
  const removeStudent = (studentId: number) => setCohort((prev) => prev.filter((item) => item.student.id !== studentId));
  const removeRankGroup = (rankId: number) => setCohort((prev) => prev.filter((item) => item.student.current_rank !== rankId));

  const registration = useCohortRegistration({ sessionId, session, cohort, setCohort, generateAssessments });

  if (!valid) {
    return (
      <section aria-labelledby="bgc-invalid-id-heading" className="page" data-testid="bgc-page">
        <EmptyState
          titleAs="h2"
          titleId="bgc-invalid-id-heading"
          title="Grading session not found"
          action={<Link to="/gradings" className={buttonClass({ variant: "primary" })}>Back to Gradings</Link>}
        >
          Please return to the grading sessions list.
        </EmptyState>
      </section>
    );
  }

  if (sessionQuery.isLoading) {
    return (
      <section aria-label="Build grading cohort" className="page" data-testid="bgc-page">
        <LoadingState>Loading the grading session…</LoadingState>
      </section>
    );
  }

  if (sessionQuery.isError || !session) {
    return (
      <section aria-labelledby="bgc-error-heading" className="page" data-testid="bgc-page">
        <EmptyState
          titleAs="h2"
          titleId="bgc-error-heading"
          title="Failed to load grading session"
          action={<Link to="/gradings" className={buttonClass({ variant: "primary" })}>Back to Gradings</Link>}
        >
          {errorMessage(sessionQuery.error, "Session not found.")}
        </EmptyState>
      </section>
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
        <div className="bgc-left-column">
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

        <div className="split__aside">
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

      {reviewOpen && <CohortReviewDialog cohort={cohort} onRemove={removeStudent} onClose={() => setReviewOpen(false)} />}
    </section>
  );
}
