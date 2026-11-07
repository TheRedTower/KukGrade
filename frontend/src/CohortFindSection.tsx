import { Link } from "react-router-dom";

import type { AgeBand, Rank, StudentListItem } from "./api";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { RankFlow } from "./CohortRank";
import { EmptyState } from "./EmptyState";
import { ResponsiveTable } from "./ResponsiveTable";
import { StudentStatusBadge } from "./StatusBadge";

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
  nextRankMap: Map<number, Rank>;
  ageBands: AgeBand[];
  /** The students the filters leave, and whether that list is still catching up with them. */
  students: StudentListItem[];
  updating: boolean;
  inCohort: Set<number>;
  onAdd: (student: StudentListItem) => void;
  onRemove: (studentId: number) => void;
  onAddAll: () => void;
}

/** Step 1: filter the students who could still be registered, and add them one by one or all at once. */
export function CohortFindSection({
  search, onSearch, rankFilter, onRankFilter, ageFilter, onAgeFilter, statusFilter, onStatusFilter,
  ranks, rankMap, nextRankMap, ageBands, students, updating, inCohort, onAdd, onRemove, onAddAll,
}: CohortFindSectionProps) {
  return (
          <section className="bgc-section" aria-labelledby="bgc-find-heading">
            <h2 id="bgc-find-heading" className="section-title">
              1. Find eligible students
            </h2>
            <p className="bgc-section-subtext">
              Search and filter to find students to add. Left students are not shown (not eligible).
            </p>

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

              <div className="field">
                <label htmlFor="bgc-rank-filter">Current rank</label>
                <select
                  id="bgc-rank-filter"
                  value={rankFilter}
                  onChange={(e) => onRankFilter(e.target.value)}
                >
                  <option value="ALL">All ranks</option>
                  {ranks
                    .filter((r) => nextRankMap.get(r.id)?.has_syllabus)
                    .map((r) => (
                      <option key={r.id} value={String(r.id)}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="bgc-age-filter">Age group</label>
                <select
                  id="bgc-age-filter"
                  value={ageFilter}
                  onChange={(e) => onAgeFilter(e.target.value)}
                  data-testid="bgc-age-filter"
                >
                  <option value="ALL">All ages</option>
                  {ageBands.map((band) => (
                    <option key={band.code} value={band.code}>
                      {band.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="bgc-status-filter">Status</label>
                <select
                  id="bgc-status-filter"
                  value={statusFilter}
                  onChange={(e) => onStatusFilter(e.target.value as StatusFilter)}
                >
                  <option value="ACTIVE_INACTIVE">Active + Inactive</option>
                  <option value="ACTIVE">Active only</option>
                  <option value="INACTIVE">Inactive only</option>
                </select>
              </div>
            </div>

            {/* Filter matching summary banner */}
            <div className="action-row bgc-filter-summary-card">
              <div className="bgc-summary-info">
                <span className="bgc-info-icon" aria-hidden="true">ℹ</span>
                <span>
                  Students who have left, or are still registered for another grading that has not reached its result, are not listed.
                </span>
              </div>
              <div className="action-row">
                <span className="bgc-matching-count">
                  {students.length === 1
                    ? "1 student matches"
                    : `${students.length} students match`}
                </span>
                <Button
                  variant="primary" small
                  onClick={onAddAll}
                  disabled={students.length === 0 || updating}
                  data-testid="bgc-add-all-filtered-btn"
                >
                  Add all {students.length} filtered students
                </Button>
              </div>
            </div>

            {/* Filtered matching student records table */}
            <div data-testid="bgc-filtered-students-table">
              {students.length === 0 ? (
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
                          <Link
                            to={`/students/${student.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {student.first_name} {student.last_name}
                          </Link>
                          <span className="bgc-student-id">{student.wksa_id || "—"}</span>
                        </>
                      ),
                    },
                    {
                      key: "rank",
                      header: "Rank",
                      render: (student) => (
                        <RankFlow
                          from={rankMap.get(student.current_rank)}
                          to={nextRankMap.get(student.current_rank)}
                          fromFallback={student.current_rank_name || "—"}
                        />
                      ),
                    },
                    {
                      key: "age-status",
                      header: "Age and status",
                      render: (student) => (
                        <div className="bgc-chips">
                          <Badge tone="neutral">{student.age_band_display || student.age_band || "—"}</Badge>
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
                            variant="ghost" small
                            onClick={() => onRemove(student.id)}
                            aria-label={`Added: remove ${student.first_name} ${student.last_name} from the cohort`}
                            title="Click to remove from the cohort"
                            data-testid={`bgc-student-added-${student.id}`}
                          >
                            Added ✓
                          </Button>
                        ) : (
                          <Button
                            variant="primary" small
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
