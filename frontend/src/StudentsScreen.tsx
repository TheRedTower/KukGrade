import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";

import {
  type Rank,
  type StudentListItem,
  type StudentStatus,
  getStudents,
} from "./api";
import { useRanksQuery } from "./queries";
import { useAuth } from "./auth";
import "./StudentScreens.css";
import { SearchIcon } from "./Icons";
import { useDebouncedValue } from "./useDebouncedValue";

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

function ChevronLeftIcon() {
  return (
    <svg
      aria-hidden="true"
      className="pagination-icon"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      aria-hidden="true"
      className="pagination-icon"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

const PAGE_SIZE = 15;

export function StudentsScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StudentStatus | "ALL">("ALL");
  const [rankFilter, setRankFilter] = useState<string>("ALL");
  const [page, setPage] = useState(1);

  const canImportStudents = Boolean(user?.can_import_data);

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
    queryKey: ["students", "list", debouncedSearch, statusFilter, rankFilter, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      getStudents({
        search: debouncedSearch || undefined,
        status: statusFilter !== "ALL" ? statusFilter : undefined,
        current_rank_code: rankFilter !== "ALL" ? rankFilter : undefined,
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

  function renderStatusBadge(status: StudentStatus, display: string) {
    if (status === "ACTIVE") {
      return (
        <span className="student-status-badge status-active">
          <span className="status-dot" aria-hidden="true" />
          {display || "Active"}
        </span>
      );
    }
    if (status === "INACTIVE") {
      return (
        <span className="student-status-badge status-inactive">
          <span className="status-dot" aria-hidden="true" />
          {display || "Inactive"}
        </span>
      );
    }
    return (
      <span className="student-status-badge status-left">
        <span className="status-dot" aria-hidden="true" />
        {display || "Left"}
      </span>
    );
  }

  return (
    <section aria-labelledby="students-page-heading" className="students-view">
      {/* Header */}
      <div className="students-header">
        <div className="students-header-copy">
          <h1 id="students-page-heading" className="students-title">
            Students
          </h1>
          <p className="students-subtitle">Manage student records and grading history</p>
        </div>
        <div className="students-header-actions">
          {canImportStudents && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate("/students/import")}
              aria-label="Import students from a file"
            >
              Import students
            </button>
          )}
          <button
            type="button"
            className="btn-add-student"
            onClick={() => navigate("/students/new")}
            aria-label="Add new student"
          >
            <UserPlusIcon />
            <span>Add student</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="students-filter-bar" role="search" aria-label="Student filters">
        <div className="search-input-wrapper">
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

        <div className="filter-divider" aria-hidden="true" />

        <div className="filter-select-group">
          <label htmlFor="status-filter-select" className="filter-label">
            Status
          </label>
          <select
            id="status-filter-select"
            className="filter-select"
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

        <div className="filter-divider" aria-hidden="true" />

        <div className="filter-select-group">
          <label htmlFor="rank-filter-select" className="filter-label">
            Rank
          </label>
          <select
            id="rank-filter-select"
            className="filter-select"
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

        <div className="results-count-container">
          <span className="results-count-text">
            {studentsQuery.isLoading ? "Loading..." : `${totalCount} ${totalCount === 1 ? "student" : "students"}`}
          </span>
        </div>
      </div>

      {/* Data Table / Empty State Container */}
      <div className="students-table-card">
        {studentsQuery.isLoading ? (
          <div className="table-state-box" role="status">
            <p className="loading-state-text">Loading student records...</p>
          </div>
        ) : students.length === 0 ? (
          <div className="table-state-box">
            {hasActiveFilters ? (
              <div className="empty-filtered-container">
                <p className="empty-state-title">No matching students found</p>
                <p className="empty-state-description">
                  No records match your active search and filter criteria.
                </p>
                <button
                  type="button"
                  className="btn-clear-filters"
                  onClick={handleClearFilters}
                >
                  Clear all filters
                </button>
              </div>
            ) : (
              <div className="empty-zero-container">
                <p className="empty-state-title">No students registered yet</p>
                <p className="empty-state-description">
                  Add your first student to get started.
                </p>
                <button
                  type="button"
                  className="btn-add-first-student"
                  onClick={() => navigate("/students/new")}
                >
                  Add student +
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="table-scroll-wrapper">
              <table className="students-data-table" aria-label="Students directory">
                <thead>
                  <tr>
                    <th scope="col" className="col-student">Student</th>
                    <th scope="col" className="col-wksa-id">WKSA ID</th>
                    <th scope="col" className="col-rank">Current rank</th>
                    <th scope="col" className="col-status">Status</th>
                    <th scope="col" className="col-current-grading">Current grading</th>
                    <th scope="col" className="col-cta">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id} className="student-table-row">
                      <td className="col-student cell-student-name">
                        <span className="student-full-name">
                          {s.first_name} {s.last_name}
                        </span>
                      </td>
                      <td className="col-wksa-id cell-wksa-id">
                        <span className="wksa-id-pill">{s.wksa_id}</span>
                      </td>
                      <td className="col-rank cell-rank-name">
                        {s.current_rank_name || s.current_rank_code}
                      </td>
                      <td className="col-status cell-status">
                        {renderStatusBadge(s.status, s.status_display)}
                      </td>
                      {/* The registration the server says is still in
                          progress, and how far it has got - not a guess
                          from the student's status (audit F-29). */}
                      <td className="col-current-grading cell-current-grading">
                        {s.current_grading ? (
                          <>
                            <Link
                              className="current-grading-link"
                              to={`/gradings/${s.current_grading.session}`}
                            >
                              {s.current_grading.session_title}
                            </Link>
                            <span className="current-grading-stage">
                              {s.current_grading.stage_display}
                            </span>
                          </>
                        ) : (
                          <span className="current-grading-none">Not registered</span>
                        )}
                      </td>
                      <td className="col-cta cell-cta">
                        <button
                          type="button"
                          className="btn-view-student"
                          onClick={() => navigate(`/students/${s.id}`)}
                          aria-label={`View record for ${s.first_name} ${s.last_name}`}
                        >
                          <span>View student</span>
                          <span aria-hidden="true" className="action-arrow">→</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination bar */}
            <div className="table-pagination-bar" aria-label="Table pagination">
              <div className="pagination-range-text">
                Showing {Math.min((page - 1) * PAGE_SIZE + 1, totalCount)}–
                {Math.min(page * PAGE_SIZE, totalCount)} of {totalCount} students
              </div>

              <div className="pagination-controls">
                <button
                  type="button"
                  className="btn-pagination btn-pagination-nav"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeftIcon />
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
                  const isCurrent = pageNum === page;
                  const isVisible =
                    pageNum === 1 ||
                    pageNum === totalPages ||
                    Math.abs(pageNum - page) <= 1;

                  if (!isVisible) {
                    if (pageNum === 2 || pageNum === totalPages - 1) {
                      return (
                        <span key={pageNum} className="pagination-ellipsis" aria-hidden="true">
                          …
                        </span>
                      );
                    }
                    return null;
                  }

                  return (
                    <button
                      key={pageNum}
                      type="button"
                      className={`btn-pagination ${isCurrent ? "active" : ""}`}
                      onClick={() => setPage(pageNum)}
                      aria-current={isCurrent ? "page" : undefined}
                      aria-label={`Page ${pageNum}`}
                    >
                      {pageNum}
                    </button>
                  );
                })}

                <button
                  type="button"
                  className="btn-pagination btn-pagination-nav"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  <ChevronRightIcon />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
