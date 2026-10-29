import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import {
  type Rank,
  type StudentListItem,
  type StudentStatus,
  getStudents,
} from "./api";
import { useRanksQuery } from "./queries";
import { Pagination } from "./Pagination";
import { StudentStatusBadge } from "./StatusBadge";
import { ResponsiveTable } from "./ResponsiveTable";
import "./StudentScreens.css";
import { SearchIcon } from "./Icons";
import { useDebouncedValue } from "./useDebouncedValue";
import { Button } from "./Button";

function ClearIcon() {
  return (
    <svg
      aria-hidden="true"
      className="clear-icon"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
    >
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

function UserPlusIcon() {
  return (
    <svg
      aria-hidden="true"
      className="button-icon"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" x2="19" y1="8" y2="14" />
      <line x1="22" x2="16" y1="11" y2="11" />
    </svg>
  );
}

const PAGE_SIZE = 15;

export function StudentsScreen() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StudentStatus | "ALL">("ALL");
  const [rankFilter, setRankFilter] = useState<string>("ALL");
  const [page, setPage] = useState(1);
  // Set by an import's results ("See the new students"); cleared by "Show every student".
  const [searchParams, setSearchParams] = useSearchParams();
  const sourceImport = Number(searchParams.get("source_import")) || undefined;

  // 1. Fetch available ranks for filter dropdown
  const ranksQuery = useRanksQuery();

  const ranks = useMemo<Rank[]>(() => {
    return Array.isArray(ranksQuery.data?.results) ? ranksQuery.data.results : [];
  }, [ranksQuery.data]);

  // 2. Fetch paginated students with active filters. The search waits for a
  // pause in typing, and the last page stays on screen while the next loads,
  // so a name is one request rather than one per keystroke.
  const debouncedSearch = useDebouncedValue(search.trim());
  const studentsQuery = useQuery({
    queryKey: ["students", "list", debouncedSearch, statusFilter, rankFilter, sourceImport, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      getStudents({
        search: debouncedSearch || undefined,
        status: statusFilter !== "ALL" ? statusFilter : undefined,
        current_rank_code: rankFilter !== "ALL" ? rankFilter : undefined,
        source_import: sourceImport,
        page,
        page_size: PAGE_SIZE,
      }),
  });

  const students = useMemo<StudentListItem[]>(() => {
    return Array.isArray(studentsQuery.data?.results) ? studentsQuery.data.results : [];
  }, [studentsQuery.data]);

  const totalCount = studentsQuery.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const hasActiveFilters = search.trim() !== "" || statusFilter !== "ALL" || rankFilter !== "ALL";

  function handleClearFilters() {
    setSearch("");
    setStatusFilter("ALL");
    setRankFilter("ALL");
    setPage(1);
  }

  return (
    <section aria-labelledby="students-page-heading" className="page students-view">
      {/* Header */}
      <div className="action-row students-header">
        <div className="students-header-copy">
          <h1 id="students-page-heading" className="students-title">
            Students
          </h1>
          <p className="students-subtitle">Manage student records and grading history</p>
        </div>
        <div className="students-header-actions">
          <Button
            variant="primary"
            onClick={() => navigate("/students/new")}
            aria-label="Add new student"
          >
            <UserPlusIcon />
            <span>Add student</span>
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="filter-bar students-filter-bar" role="search" aria-label="Student filters">
        <div className="filter-bar__full search-input-wrapper">
          <SearchIcon size={18} className="filter-icon" />
          <input
            type="text"
            className="student-search-input"
            placeholder="Search name or WKSA ID"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            aria-label="Search students by name or WKSA ID"
          />
          {search && (
            <button
              type="button"
              className="btn-clear-search"
              onClick={() => {
                setSearch("");
                setPage(1);
              }}
              aria-label="Clear search text"
            >
              <ClearIcon />
            </button>
          )}
        </div>

        <div className="field">
          <label htmlFor="status-filter-select">Status</label>
          <select
            id="status-filter-select"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StudentStatus | "ALL");
              setPage(1);
            }}
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="LEFT">Left</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="rank-filter-select">Rank</label>
          <select
            id="rank-filter-select"
            value={rankFilter}
            onChange={(e) => {
              setRankFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">All ranks</option>
            {ranks.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div className="action-row filter-bar__full">
          {sourceImport ? (
            <>
              <span className="results-count-text">Only the students one import added</span>
              <Button
                variant="ghost"
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete("source_import");
                  setSearchParams(next, { replace: true });
                  setPage(1);
                }}
              >
                Show every student
              </Button>
            </>
          ) : null}
          <span className="results-count-text">
            {studentsQuery.isLoading ? "Loading..." : `${totalCount} ${totalCount === 1 ? "student" : "students"}`}
          </span>
        </div>
      </div>

      {/* Data Table / Empty State Container */}
      <div className="students-results">
        {studentsQuery.isLoading ? (
          <div className="card table-state-box" role="status">
            <p className="loading-state-text">Loading student records...</p>
          </div>
        ) : students.length === 0 ? (
          <div className="card table-state-box">
            {hasActiveFilters ? (
              <div className="empty-filtered-container">
                <p className="empty-state-title">No matching students found</p>
                <p className="empty-state-description">
                  No records match your active search and filter criteria.
                </p>
                <Button
                  variant="secondary"
                  onClick={handleClearFilters}
                >
                  Clear all filters
                </Button>
              </div>
            ) : (
              <div className="empty-zero-container">
                <p className="empty-state-title">No students registered yet</p>
                <p className="empty-state-description">
                  Add your first student to get started.
                </p>
                <Button
                  variant="primary"
                  onClick={() => navigate("/students/new")}
                >
                  Add student +
                </Button>
              </div>
            )}
          </div>
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
                    <span className="student-full-name">
                      {student.first_name} {student.last_name}
                    </span>
                  ),
                },
                {
                  key: "wksa",
                  header: "WKSA ID",
                  render: (student) => <span className="wksa-id-pill">{student.wksa_id}</span>,
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
                // far it has got - not a guess from the student's status (audit F-29).
                {
                  key: "grading",
                  header: "Current grading",
                  render: (student) =>
                    student.current_grading ? (
                      <div className="cell-current-grading">
                        <Link className="current-grading-link" to={`/gradings/${student.current_grading.session}`}>
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
                      <span aria-hidden="true">→</span>
                    </Button>
                  ),
                },
              ]}
            />

            <Pagination
              label="Table pagination"
              page={page}
              totalPages={totalPages}
              onPage={setPage}
              summary={`Showing ${Math.min((page - 1) * PAGE_SIZE + 1, totalCount)}–${Math.min(page * PAGE_SIZE, totalCount)} of ${totalCount} students`}
            />
          </>
        )}
      </div>
    </section>
  );
}
