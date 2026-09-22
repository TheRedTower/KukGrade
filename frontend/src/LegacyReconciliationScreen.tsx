import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import {
  ApiError,
  type LegacyGradingRecord,
  type StudentListItem,
  getLegacyGradingRecords,
  getRanks,
  getStudents,
  linkLegacyGradingRecord,
  resolveLegacyCurrentRank,
  resolveLegacyTestingForRank,
  unlinkLegacyGradingRecord,
  voidLegacyGradingRecord,
} from "./api";
import "./StudentScreens.css";
import "./LegacyReconciliation.css";

type LinkedFilter = "all" | "linked" | "unlinked";
type VoidedFilter = "all" | "voided" | "active";

function cycleLabel(record: LegacyGradingRecord): string {
  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${MONTHS[record.cycle_month - 1]} ${record.cycle_year}`;
}

function StudentPicker({
  onPick,
  onCancel,
}: {
  onPick: (student: StudentListItem) => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");
  const searchQuery = useQuery({
    queryKey: ["legacyReconcileStudentSearch", search],
    queryFn: () => getStudents({ search: search.trim() || undefined, page_size: 10 }),
    enabled: search.trim().length > 1,
  });
  const results = searchQuery.data?.results ?? [];

  return (
    <div className="lr-picker">
      <label className="lr-picker-label">
        Search by name or WKSA ID
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="e.g. Alex Kim or UK-1234"
        />
      </label>
      {results.length > 0 && (
        <ul className="lr-picker-results">
          {results.map((student) => (
            <li key={student.id}>
              <button type="button" onClick={() => onPick(student)}>
                {student.first_name} {student.last_name} ({student.wksa_id})
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn-secondary" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

export function LegacyReconciliationScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [linkedFilter, setLinkedFilter] = useState<LinkedFilter>("all");
  const [voidedFilter, setVoidedFilter] = useState<VoidedFilter>("active");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const PAGE_SIZE = 20;
  const recordsQuery = useQuery({
    queryKey: ["legacyGradingRecords", linkedFilter, voidedFilter, page],
    queryFn: () =>
      getLegacyGradingRecords({
        linked: linkedFilter === "all" ? undefined : linkedFilter === "linked",
        voided: voidedFilter === "all" ? undefined : voidedFilter === "voided",
        page,
        page_size: PAGE_SIZE,
      }),
  });
  const ranksQuery = useQuery({ queryKey: ["ranksList"], queryFn: () => getRanks({ page_size: 100 }) });
  const ranks = ranksQuery.data?.results ?? [];

  const records = recordsQuery.data?.results ?? [];
  const totalCount = recordsQuery.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["legacyGradingRecords"] });
  }

  function handleError(err: unknown, fallback: string) {
    setActionError(err instanceof ApiError ? err.message || fallback : fallback);
  }

  async function handleLink(recordId: number, student: StudentListItem) {
    setActionError(null);
    setPendingId(recordId);
    try {
      await linkLegacyGradingRecord(recordId, student.id);
      setLinkingId(null);
      await refresh();
    } catch (err) {
      handleError(err, "Could not link this record.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleUnlink(recordId: number) {
    setActionError(null);
    setPendingId(recordId);
    try {
      await unlinkLegacyGradingRecord(recordId);
      await refresh();
    } catch (err) {
      handleError(err, "Could not unlink this record.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleResolveCurrentRank(recordId: number, rankId: string) {
    setActionError(null);
    setPendingId(recordId);
    try {
      await resolveLegacyCurrentRank(recordId, rankId === "" ? null : Number(rankId));
      await refresh();
    } catch (err) {
      handleError(err, "Could not resolve this rank.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleResolveTestingForRank(recordId: number, rankId: string) {
    setActionError(null);
    setPendingId(recordId);
    try {
      await resolveLegacyTestingForRank(recordId, rankId === "" ? null : Number(rankId));
      await refresh();
    } catch (err) {
      handleError(err, "Could not resolve this rank.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleVoid(recordId: number) {
    if (!voidReason.trim()) {
      setActionError("A reason is required to void a record.");
      return;
    }
    setActionError(null);
    setPendingId(recordId);
    try {
      await voidLegacyGradingRecord(recordId, voidReason.trim());
      setVoidReason("");
      setExpandedId(null);
      await refresh();
    } catch (err) {
      handleError(err, "Could not void this record.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section aria-labelledby="legacy-recon-title" className="add-student-view">
      <nav aria-label="Breadcrumb navigation" className="form-breadcrumbs">
        <button type="button" className="breadcrumb-link-btn" onClick={() => navigate("/gradings")}>
          Gradings
        </button>
        <span className="breadcrumb-separator" aria-hidden="true">
          /
        </span>
        <span className="breadcrumb-current" aria-current="page">
          Historical records
        </span>
      </nav>

      <div className="add-student-header">
        <h1 id="legacy-recon-title" className="add-student-heading">
          Historical records
        </h1>
        <p className="add-student-subtitle">
          Link imported historical grading records to students, resolve rank mappings, or
          void a mistaken row. Source text is never changed by any of these actions.
        </p>
      </div>

      {actionError && (
        <div role="alert" className="form-alert-banner">
          <p>{actionError}</p>
        </div>
      )}

      <div className="lr-filter-bar" role="search" aria-label="Historical record filters">
        <label>
          Link status
          <select
            value={linkedFilter}
            onChange={(event) => {
              setLinkedFilter(event.target.value as LinkedFilter);
              setPage(1);
            }}
          >
            <option value="all">All</option>
            <option value="linked">Linked</option>
            <option value="unlinked">Unlinked</option>
          </select>
        </label>
        <label>
          Status
          <select
            value={voidedFilter}
            onChange={(event) => {
              setVoidedFilter(event.target.value as VoidedFilter);
              setPage(1);
            }}
          >
            <option value="active">Active</option>
            <option value="voided">Voided</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>

      {recordsQuery.isLoading ? (
        <div className="loading-state" role="status">
          Loading historical records…
        </div>
      ) : records.length === 0 ? (
        <div className="detail-empty-box">
          <p className="detail-empty-title">No historical records match these filters</p>
        </div>
      ) : (
        <div className="table-scroll-wrapper">
          <table className="students-data-table" aria-label="Historical records">
            <thead>
              <tr>
                <th scope="col">Cycle</th>
                <th scope="col">Name</th>
                <th scope="col">Current rank</th>
                <th scope="col">Testing for</th>
                <th scope="col">Outcome</th>
                <th scope="col">Student</th>
                <th scope="col">Status</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <Fragment key={record.id}>
                  <tr className="student-table-row">
                    <td>{cycleLabel(record)}</td>
                    <td>{record.source_name}</td>
                    <td>{record.current_rank_code ?? record.source_current_rank_text}</td>
                    <td>{record.testing_for_rank_code ?? record.source_testing_for_rank_text}</td>
                    <td>
                      {record.record_kind === "AUXILIARY_NOTE"
                        ? "—"
                        : (record.outcome_display ?? record.attendance_status_display)}
                    </td>
                    <td>{record.student_display_name ?? "— unlinked —"}</td>
                    <td>{record.is_void ? "Voided" : "Active"}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                      >
                        {expandedId === record.id ? "Close" : "Manage"}
                      </button>
                    </td>
                  </tr>
                  {expandedId === record.id && (
                    <tr key={`${record.id}-panel`}>
                      <td colSpan={8}>
                        <div className="lr-action-panel">
                          {record.is_void ? (
                            <p className="imp-help-text">
                              Voided: {record.void_reason} (by {record.voided_by_email})
                            </p>
                          ) : (
                            <>
                              <div className="lr-action-group">
                                <h3>Student link</h3>
                                {record.student ? (
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    disabled={pendingId === record.id}
                                    onClick={() => void handleUnlink(record.id)}
                                  >
                                    Unlink from {record.student_display_name}
                                  </button>
                                ) : linkingId === record.id ? (
                                  <StudentPicker
                                    onPick={(student) => void handleLink(record.id, student)}
                                    onCancel={() => setLinkingId(null)}
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => setLinkingId(record.id)}
                                  >
                                    Link to student
                                  </button>
                                )}
                              </div>

                              <div className="lr-action-group">
                                <h3>Current rank</h3>
                                <p className="imp-help-text">
                                  Source text: {record.source_current_rank_text || "—"}
                                </p>
                                <select
                                  aria-label="Resolve current rank"
                                  value={record.current_rank ?? ""}
                                  disabled={pendingId === record.id}
                                  onChange={(event) =>
                                    void handleResolveCurrentRank(record.id, event.target.value)
                                  }
                                >
                                  <option value="">— unresolved —</option>
                                  {ranks.map((rank) => (
                                    <option key={rank.code} value={rank.id}>
                                      {rank.name}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="lr-action-group">
                                <h3>Testing-for rank</h3>
                                <p className="imp-help-text">
                                  Source text: {record.source_testing_for_rank_text || "—"}
                                </p>
                                <select
                                  aria-label="Resolve testing-for rank"
                                  value={record.testing_for_rank ?? ""}
                                  disabled={pendingId === record.id}
                                  onChange={(event) =>
                                    void handleResolveTestingForRank(
                                      record.id,
                                      event.target.value,
                                    )
                                  }
                                >
                                  <option value="">— unresolved —</option>
                                  {ranks.map((rank) => (
                                    <option key={rank.code} value={rank.id}>
                                      {rank.name}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="lr-action-group">
                                <h3>Void this record</h3>
                                <label className="lr-picker-label">
                                  Reason
                                  <input
                                    type="text"
                                    value={voidReason}
                                    onChange={(event) => setVoidReason(event.target.value)}
                                  />
                                </label>
                                <button
                                  type="button"
                                  className="btn-danger-sm"
                                  disabled={pendingId === record.id}
                                  onClick={() => void handleVoid(record.id)}
                                >
                                  Void
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="lr-pagination">
          <button
            type="button"
            className="btn-secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn-secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
