import { Link } from "react-router-dom";

import { Alert } from "./Alert";

import { type AgeBand, type Rank, type StudentListItem, errorMessage } from "./api";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { RankTransition, rankEnd } from "./RankTransition";
import { labelOf, useChoices } from "./choices";
import { destinationOf } from "./cohortBuilder";
import { EmptyState } from "./EmptyState";

import { LoadingState } from "./LoadingState";
import { ResponsiveTable } from "./ResponsiveTable";
import { StudentStatusBadge } from "./StatusBadge";
import { counted } from "./plural";
import { CheckIcon, InfoIcon } from "./Icons";
import { Field } from "./Field";
import { Select } from "./Select";

export type StatusFilter = "ACTIVE_INACTIVE" | "ACTIVE" | "INACTIVE";

interface CohortFindSectionProps {
  search: string;
  onSearch: (search: string) => void;
  rankFilter: string;
  onRankFilter: (rank: string) => void;
  ageFilter: string;
  onAgeFilter: (age: string) => void;
  statusFilter: StatusFilter;
  onStatusFilter: (status: StatusFilter) => void;
  ranks: Rank[];
  rankMap: Map<number, Rank>;
  ageBands: AgeBand[];
  /** The students the filters leave, and whether that list is still catching up with them. */
  students: StudentListItem[];
  updating: boolean;
  /** Whether the first list has arrived: until it has, there is nothing to count. */
  roster: "loading" | "failed" | "ready";
  rosterError: unknown;
  onRetry: () => void;
  inCohort: Set<number>;
  onAdd: (student: StudentListItem) => void;
  onRemove: (studentId: number) => void;
  onAddAll: () => void;
}

/** Step 1: filter the students who could still be registered, and add them one by one or all at once. */
export function CohortFindSection({
  search,
  onSearch,
  rankFilter,
  onRankFilter,
  ageFilter,
  onAgeFilter,
  statusFilter,
  onStatusFilter,
  ranks,
  rankMap,
  ageBands,
  students,
  updating,
  roster,
  rosterError,
  onRetry,
  inCohort,
  onAdd,
  onRemove,
  onAddAll,
}: CohortFindSectionProps) {
  const statuses = useChoices().student_statuses;
  const active = labelOf(statuses, "ACTIVE");
  const inactive = labelOf(statuses, "INACTIVE");
  return (
    <section className="stack stack--3" aria-labelledby="bgc-find-heading">
      <h2 id="bgc-find-heading" className="section-title">
        1. Find eligible students
      </h2>
      <p className="bgc-section-subtext">Search and filter to find students to add.</p>

      {/* Filter toolbar */}
      <div className="filter-bar">
        <label className="field field--search filter-bar__full">
          <span className="visually-hidden">Search name or WKSA ID</span>
          <input
            type="search"
            placeholder="Search name or WKSA ID"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </label>

        <Field label="Current rank" look="label">
          {(control) => (
            <Select
              {...control}
              all="All ranks"
              allValue="ALL"
              options={ranks
                // A rank whose next rank has its syllabus recorded, so its students can be graded.
                .filter((r) => r.next_rank !== null && rankMap.get(r.next_rank)?.has_syllabus)
                .map((r) => ({ value: String(r.id), label: r.name }))}
              value={rankFilter}
              onChange={onRankFilter}
            />
          )}
        </Field>

        <Field label="Age group" look="label">
          {(control) => (
            <Select
              {...control}
              all="All ages"
              allValue="ALL"
              options={ageBands.map((band) => ({ value: band.code, label: band.name }))}
              value={ageFilter}
              onChange={onAgeFilter}
              data-testid="bgc-age-filter"
            />
          )}
        </Field>

        <Field label="Status" look="label">
          {(control) => (
            <Select
              {...control}
              options={[
                { value: "ACTIVE_INACTIVE", label: `${active} + ${inactive}` },
                { value: "ACTIVE", label: `${active} only` },
                { value: "INACTIVE", label: `${inactive} only` },
              ]}
              value={statusFilter}
              onChange={(value) => onStatusFilter(value as StatusFilter)}
            />
          )}
        </Field>
      </div>

      {/* Filter matching summary banner */}
      <div className="action-row bgc-filter-summary-card">
        <div className="row subtext">
          <span aria-hidden="true" className="mark mark--small">
            <InfoIcon size={12} />
          </span>
          <span>
            Students who have left, or are still registered for another grading that has not reached its result, are not
            listed.
          </span>
        </div>
        <div className="action-row">
          {roster === "ready" && (
            <span className="item-title">{counted(students.length, "student matches", "students match")}</span>
          )}
          <Button
            variant="primary"
            small
            onClick={onAddAll}
            disabled={roster !== "ready" || students.length === 0 || updating}
            data-testid="bgc-add-all-filtered-btn"
          >
            {roster === "ready" ? `Add all ${students.length} filtered students` : "Add all filtered students"}
          </Button>
        </div>
      </div>

      {/* Filtered matching student records table */}
      <div data-testid="bgc-filtered-students-table">
        {roster === "loading" ? (
          <LoadingState>Loading eligible students…</LoadingState>
        ) : roster === "failed" ? (
          <Alert
            action={
              <Button variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            }
          >
            {errorMessage(rosterError, "The eligible students could not be loaded.")}
          </Alert>
        ) : students.length === 0 ? (
          <EmptyState framed data-testid="bgc-empty-filtered">
            No eligible students match the selected filters.
          </EmptyState>
        ) : (
          <ResponsiveTable
            label="Matching eligible students"
            rows={students}
            rowKey={(student) => student.id}
            rowTestId={(student) => `bgc-student-row-${student.id}`}
            columns={[
              {
                key: "student",
                header: "Student",
                primary: true,
                render: (student) => (
                  <>
                    <Link to={`/students/${student.id}`} target="_blank" rel="noreferrer">
                      {student.first_name} {student.last_name}
                      <span className="visually-hidden"> (opens in a new tab)</span>
                    </Link>
                    <span className="bgc-student-id meta">{student.wksa_id || "—"}</span>
                  </>
                ),
              },
              {
                key: "rank",
                header: "Rank",
                render: (student) => (
                  <RankTransition
                    from={{ rank: rankMap.get(student.current_rank), name: student.current_rank_name || "—" }}
                    to={rankEnd(destinationOf(student, rankMap))}
                  />
                ),
              },
              {
                key: "age-status",
                header: "Age and status",
                render: (student) => (
                  <div className="bgc-chips">
                    <Badge tone="neutral">{student.age_band_display}</Badge>
                    <StudentStatusBadge status={student.status} label={student.status_display} />
                  </div>
                ),
              },
              {
                key: "action",
                header: "Action",
                actions: "inline",
                render: (student) =>
                  inCohort.has(student.id) ? (
                    <Button
                      variant="ghost"
                      small
                      onClick={() => onRemove(student.id)}
                      aria-label={`Added: remove ${student.first_name} ${student.last_name} from the cohort`}
                      title="Click to remove from the cohort"
                      data-testid={`bgc-student-added-${student.id}`}
                    >
                      Added <CheckIcon />
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      small
                      onClick={() => onAdd(student)}
                      data-testid={`bgc-add-student-${student.id}`}
                    >
                      + Add
                    </Button>
                  ),
              },
            ]}
          />
        )}
      </div>
    </section>
  );
}
