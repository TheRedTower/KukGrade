import { useMemo } from "react";
import { useChoices } from "./choices";
import { keys } from "./queryKeys";
import { PageHeader } from "./PageHeader";
import { keepPreviousData } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";

import { type Rank, type StudentListItem, type StudentStatus, getStudents } from "./api";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";
import { useRanksQuery } from "./queries";
import { Pagination } from "./Pagination";
import { StudentStatusBadge } from "./StatusBadge";
import { ResponsiveTable } from "./ResponsiveTable";
import "./StudentScreens.css";
import { ArrowRightIcon, UserPlusIcon } from "./Icons";
import { SearchField } from "./SearchField";
import { usePagedQuery } from "./usePagedQuery";
import { useUrlFilters } from "./useUrlFilters";
import { Button } from "./Button";
import { counted } from "./plural";
import { Field } from "./Field";
import { Select } from "./Select";

const PAGE_SIZE = 15;

export function StudentsScreen() {
  const navigate = useNavigate();

  const filters = useUrlFilters();
  const search = filters.value("search");
  const statusFilter = filters.value("status") as StudentStatus | "";
  const rankFilter = filters.value("rank");
  const studentStatuses = useChoices().student_statuses;
  // Set by an import's results ("See the new students"); cleared by "Show every student".
  const sourceImport = Number(filters.value("source_import")) || undefined;
  const page = filters.page;

  // 1. Fetch available ranks for filter dropdown
  const ranksQuery = useRanksQuery();

  const ranks = useMemo<Rank[]>(() => {
    return ranksQuery.data?.results ?? [];
  }, [ranksQuery.data]);

  // 2. Fetch paginated students with active filters. The search waits for a
  // pause in typing, and the last page stays on screen while the next loads,
  // so a name is one request rather than one per keystroke.
  const debouncedSearch = search.trim();
  const studentsQuery = usePagedQuery({
    queryKey: keys.students.list(debouncedSearch, statusFilter, rankFilter, sourceImport, page),
    placeholderData: keepPreviousData,
    queryFn: () =>
      getStudents({
        search: debouncedSearch || undefined,
        status: statusFilter || undefined,
        current_rank_code: rankFilter || undefined,
        source_import: sourceImport,
        page,
        page_size: PAGE_SIZE,
      }),
    page,
    pageSize: PAGE_SIZE,
    onPage: filters.setPage,
  });
  const students: StudentListItem[] = studentsQuery.results;
  const totalCount = studentsQuery.count;

  const hasActiveFilters = search.trim() !== "" || statusFilter !== "" || rankFilter !== "";

  function handleClearFilters() {
    filters.clear("search", "status", "rank");
  }

  return (
    <section aria-labelledby="students-page-heading" className="page">
      <PageHeader
        title="Students"
        titleId="students-page-heading"
        subtitle="Manage student records and grading history"
        actions={
          <Button variant="primary" onClick={() => navigate("/students/new")} aria-label="Add new student">
            <UserPlusIcon />
            <span>Add student</span>
          </Button>
        }
      />

      {/* Filter and Search Bar */}
      <div className="filter-bar" role="search" aria-label="Student filters">
        <SearchField
          className="filter-bar__full"
          hideLabel
          label="Search students by name or WKSA ID"
          placeholder="Search name or WKSA ID"
          value={search}
          onChange={(value) => filters.set({ search: value })}
        />

        <Field label="Status" look="label">
          {(control) => (
            <Select
              {...control}
              all="All statuses"
              options={studentStatuses}
              value={statusFilter}
              onChange={(value) => filters.set({ status: value })}
            />
          )}
        </Field>

        <Field label="Rank" look="label">
          {(control) => (
            <Select
              {...control}
              all="All ranks"
              options={ranks.map((r) => ({ value: r.code, label: r.name }))}
              value={rankFilter}
              onChange={(value) => filters.set({ rank: value })}
            />
          )}
        </Field>

        <div className="action-row filter-bar__full">
          {sourceImport ? (
            <>
              <span className="filter-bar__count">Only the students one import added</span>
              <Button variant="ghost" onClick={() => filters.clear("source_import")}>
                Show every student
              </Button>
            </>
          ) : null}
          <span className="filter-bar__count">
            {studentsQuery.query.isLoading ? "Loading…" : counted(totalCount, "student", "students")}
          </span>
        </div>
      </div>

      {/* Data Table / Empty State Container */}
      <div className="stack stack--4">
        {studentsQuery.query.isLoading ? (
          <LoadingState>Loading student records…</LoadingState>
        ) : students.length === 0 ? (
          hasActiveFilters ? (
            <EmptyState
              framed
              title="No matching students found"
              action={
                <Button variant="secondary" onClick={handleClearFilters}>
                  Clear all filters
                </Button>
              }
            >
              No records match your active search and filter criteria.
            </EmptyState>
          ) : sourceImport ? (
            <EmptyState framed title="No students from this import">
              It added none, or they are no longer on record.
            </EmptyState>
          ) : (
            <EmptyState
              framed
              title="No students registered yet"
              action={
                <Button variant="primary" onClick={() => navigate("/students/new")}>
                  <UserPlusIcon />
                  <span>Add student</span>
                </Button>
              }
            >
              Add your first student to get started.
            </EmptyState>
          )
        ) : (
          <>
            <ResponsiveTable
              label="Students directory"
              rows={students}
              rowKey={(student) => student.id}
              columns={[
                {
                  key: "student",
                  header: "Student",
                  primary: true,
                  render: (student) => (
                    <span className="item-title">
                      {student.first_name} {student.last_name}
                    </span>
                  ),
                },
                {
                  key: "wksa",
                  header: "WKSA ID",
                  render: (student) => <span className="wksa-id-pill meta">{student.wksa_id}</span>,
                },
                {
                  key: "rank",
                  header: "Current rank",
                  render: (student) => student.current_rank_name || student.current_rank_code,
                },
                {
                  key: "status",
                  header: "Status",
                  render: (student) => <StudentStatusBadge status={student.status} label={student.status_display} />,
                },
                // The registration the server says is still in progress, and how
                // far it has got - not a guess from the student's status.
                {
                  key: "grading",
                  header: "Current grading",
                  render: (student) =>
                    student.current_grading ? (
                      <div>
                        <Link to={`/gradings/${student.current_grading.session}`}>
                          {student.current_grading.session_title}
                        </Link>
                        <span className="current-grading-stage">{student.current_grading.stage_display}</span>
                      </div>
                    ) : (
                      <span className="current-grading-none">Not registered</span>
                    ),
                },
                {
                  key: "view",
                  header: "Actions",
                  actions: "inline",
                  render: (student) => (
                    <Button
                      variant="ghost"
                      small
                      onClick={() => navigate(`/students/${student.id}`)}
                      aria-label={`View record for ${student.first_name} ${student.last_name}`}
                    >
                      <span>View student</span>
                      <ArrowRightIcon />
                    </Button>
                  ),
                },
              ]}
            />

            <Pagination label="Table pagination" noun={["student", "students"]} {...studentsQuery.pager} />
          </>
        )}
      </div>
    </section>
  );
}
