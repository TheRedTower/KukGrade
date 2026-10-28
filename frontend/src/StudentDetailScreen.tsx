import { type FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  ApiError,
  type FieldErrors,
  type GradingHistoryItem,
  type Rank,
  type StudentStatus,
  deleteStudent,
  getStudent,
  getStudentGradingHistory,
  getStudentRankHistory,
  updateStudent,
} from "./api";
import { useRanksQuery } from "./queries";
import { useAuth } from "./auth";
import { useDialogFocus } from "./useDialogFocus";
import { ResponsiveTable } from "./ResponsiveTable";
import "./StudentScreens.css";
import { formatLongDate, formatShortDate, todayIsoDate } from "./dates";
import { CheckIcon, LockIcon } from "./Icons";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatGradingHistoryDate(item: GradingHistoryItem): string {
  if (item.date_precision === "DAY" && item.date) {
    return formatShortDate(item.date);
  }
  if (item.cycle_year && item.cycle_month) {
    return `${MONTH_NAMES[item.cycle_month - 1]} ${item.cycle_year}`;
  }
  return "—";
}

function gradingHistoryOutcomeLabel(item: GradingHistoryItem): string {
  if (item.attendance_status === "DID_NOT_ATTEND") return "Did not attend";
  if (item.outcome === "PASS") return "Pass";
  if (item.outcome === "FAIL") return "Fail";
  if (item.outcome === "CONDITIONAL") return "Conditional";
  return "Unresolved";
}

export function StudentDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  const studentId = Number(id);

  // Modals state
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // Status modal state
  const [selectedStatus, setSelectedStatus] = useState<StudentStatus>("ACTIVE");
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Edit modal state
  const [editWksaId, setEditWksaId] = useState("");
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editDob, setEditDob] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editFieldErrors, setEditFieldErrors] = useState<FieldErrors>({});
  const [editGeneralError, setEditGeneralError] = useState<string | null>(null);

  // Delete modal state
  const [isDeletingStudent, setIsDeletingStudent] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const statusDialogRef = useDialogFocus<HTMLDivElement>({
    isOpen: isStatusModalOpen,
    onClose: () => setIsStatusModalOpen(false),
    canClose: !isSavingStatus,
  });
  const editDialogRef = useDialogFocus<HTMLDivElement>({
    isOpen: isEditModalOpen,
    onClose: () => setIsEditModalOpen(false),
    canClose: !isSavingEdit,
  });
  const deleteDialogRef = useDialogFocus<HTMLDivElement>({
    isOpen: isDeleteModalOpen,
    onClose: () => setIsDeleteModalOpen(false),
    canClose: !isDeletingStudent,
  });

  // 1. Fetch Student Detail
  const studentQuery = useQuery({
    queryKey: ["students", "detail", studentId],
    queryFn: () => getStudent(studentId),
    enabled: !isNaN(studentId) && studentId > 0,
  });

  // 2. Fetch Rank History
  const rankHistoryQuery = useQuery({
    queryKey: ["students", "rankHistory", studentId],
    queryFn: () => getStudentRankHistory(studentId),
    enabled: !isNaN(studentId) && studentId > 0,
  });

  // 2b. Fetch unified grading history (native + linked historical records)
  const gradingHistoryQuery = useQuery({
    queryKey: ["students", "gradingHistory", studentId],
    queryFn: () => getStudentGradingHistory(studentId),
    enabled: !isNaN(studentId) && studentId > 0,
  });

  // 3. Fetch Ranks Catalogue
  const ranksQuery = useRanksQuery();

  const student = studentQuery.data;
  const rankHistory = rankHistoryQuery.data;
  const ranks = useMemo<Rank[]>(() => {
    return Array.isArray(ranksQuery.data?.results) ? ranksQuery.data.results : [];
  }, [ranksQuery.data]);

  // The next rank as the server defines it (Rank.next_rank), unless its syllabus
  // is not recorded yet: such a rank is not offered.
  const nextRank = useMemo(() => {
    const current = ranks.find((r) => r.id === student?.current_rank);
    const next = ranks.find((r) => r.id === current?.next_rank);
    return next?.has_syllabus ? next : null;
  }, [student, ranks]);

  async function handleSaveStatus(e: FormEvent) {
    e.preventDefault();
    if (!student) return;

    setStatusError(null);
    setIsSavingStatus(true);
    try {
      await updateStudent(student.id, { status: selectedStatus });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["students", "detail", student.id] }),
        queryClient.invalidateQueries({ queryKey: ["students", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["auditEvents"] }),
      ]);
      setIsStatusModalOpen(false);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setStatusError(err.message || "Failed to update student status.");
      } else {
        setStatusError("A network error occurred. Please try again.");
      }
    } finally {
      setIsSavingStatus(false);
    }
  }

  async function handleDeleteStudent() {
    if (!student) return;

    setDeleteError(null);
    setIsDeletingStudent(true);
    try {
      await deleteStudent(student.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["students", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["auditEvents"] }),
      ]);
      navigate("/students");
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setDeleteError(err.message || "Failed to delete student.");
      } else {
        setDeleteError("A network error occurred. Please try again.");
      }
    } finally {
      setIsDeletingStudent(false);
    }
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!student) return;

    setEditGeneralError(null);
    setEditFieldErrors({});

    const errors: Record<string, string[]> = {};
    if (!editFirstName.trim()) {
      errors.first_name = ["First name is required."];
    }
    if (!editLastName.trim()) {
      errors.last_name = ["Last name is required."];
    }
    if (!editDob) {
      errors.date_of_birth = ["Date of birth is required."];
    }

    if (Object.keys(errors).length > 0) {
      setEditFieldErrors(errors);
      return;
    }

    setIsSavingEdit(true);
    try {
      await updateStudent(student.id, {
        // Sent only when changed: the server allows one change, a student ID
        // to the black belt ID, and refuses any other.
        ...(editWksaId !== student.wksa_id ? { wksa_id: editWksaId } : {}),
        first_name: editFirstName.trim(),
        last_name: editLastName.trim(),
        date_of_birth: editDob,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["students", "detail", student.id] }),
        queryClient.invalidateQueries({ queryKey: ["students", "list"] }),
      ]);
      setIsEditModalOpen(false);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.fields && Object.keys(err.fields).length > 0) {
          setEditFieldErrors(err.fields);
        } else {
          setEditGeneralError(err.message || "Failed to update student details.");
        }
      } else {
        setEditGeneralError("A network error occurred. Please try again.");
      }
    } finally {
      setIsSavingEdit(false);
    }
  }

  function getEditFieldError(fieldName: string): string | null {
    const err = editFieldErrors[fieldName];
    if (Array.isArray(err) && err.length > 0) {
      return typeof err[0] === "string" ? err[0] : null;
    }
    if (typeof err === "string") {
      return err;
    }
    return null;
  }

  if (studentQuery.isLoading) {
    return (
      <section aria-labelledby="student-loading-title" className="page student-detail-view">
        <div className="table-state-box" role="status">
          <p id="student-loading-title" className="loading-state-text">
            Loading student record...
          </p>
        </div>
      </section>
    );
  }

  if (studentQuery.isError || !student || !student.id) {
    return (
      <section aria-labelledby="student-error-title" className="page student-detail-view">
        <div className="table-state-box">
          <h2 id="student-error-title" className="empty-state-title">
            Student record not found
          </h2>
          <p className="empty-state-description">
            The requested student record could not be loaded or may not exist.
          </p>
          <button
            type="button"
            className="btn-clear-filters"
            onClick={() => navigate("/students")}
          >
            ← Back to students
          </button>
        </div>
      </section>
    );
  }

  const promotions = rankHistory?.promotions ?? [];
  const gradingHistoryItems = gradingHistoryQuery.data?.items ?? [];
  const statusStr = student.status || "ACTIVE";
  const statusDisplay = student.status_display || statusStr;

  return (
    <section aria-labelledby="student-heading" className="page student-detail-view">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumb navigation" className="form-breadcrumbs">
        <button
          type="button"
          className="breadcrumb-link-btn"
          onClick={() => navigate("/students")}
        >
          Students
        </button>
        <span className="breadcrumb-separator" aria-hidden="true">
          /
        </span>
        <span className="breadcrumb-current" aria-current="page">
          {student.first_name} {student.last_name}
        </span>
      </nav>

      {/* Detail Header */}
      <div className="detail-header-card">
        <div className="detail-header-left">
          <div className="detail-name-row">
            <h1 id="student-heading" className="student-detail-name">
              {student.first_name} {student.last_name}
            </h1>
            <span
              className={`student-status-badge status-${statusStr.toLowerCase()}`}
            >
              <span className="status-dot" aria-hidden="true" />
              {statusDisplay}
            </span>
          </div>
          <p className="detail-wksa-id">
            WKSA ID <span className="wksa-id-pill">{student.wksa_id}</span>
            {student.previous_wksa_ids.length > 0 ? (
              <span className="detail-previous-ids">
                {" "}
                Previously{" "}
                {student.previous_wksa_ids.map((previous) => (
                  <span className="wksa-id-pill" key={previous.wksa_id}>
                    {previous.wksa_id}
                  </span>
                ))}
              </span>
            ) : null}
          </p>
        </div>

        <div className="detail-header-actions">
          <button
            type="button"
            className="btn-edit-student"
            onClick={() => {
              setEditWksaId(student.wksa_id);
              setEditFirstName(student.first_name);
              setEditLastName(student.last_name);
              setEditDob(student.date_of_birth);
              setEditFieldErrors({});
              setEditGeneralError(null);
              setIsEditModalOpen(true);
            }}
          >
            Edit student
          </button>
        </div>
      </div>

      {/* Two-Column Grid Layout */}
      <div className="student-detail-grid">
        {/* Left Column: Core Record, Grading History & Rank History */}
        <div className="detail-left-column">
          {/* Card 1: Student details */}
          <div className="detail-section-card">
            <h2 className="detail-section-title">Student details</h2>
            <dl className="detail-kv-grid">
              <div className="detail-kv-row">
                <dt className="detail-kv-label">Date of birth</dt>
                <dd className="detail-kv-value">
                  <span>{formatLongDate(student.date_of_birth)}</span>
                  <div className="privacy-badge-inline" title="Confidential: visible only on record">
                    <LockIcon size={14} className="privacy-icon" />
                  </div>
                </dd>
              </div>

              <div className="detail-kv-row">
                <dt className="detail-kv-label">Age band</dt>
                <dd className="detail-kv-value">{student.age_band_display}</dd>
              </div>

              <div className="detail-kv-row">
                <dt className="detail-kv-label">Current rank</dt>
                <dd className="detail-kv-value cell-rank-highlight">{student.current_rank_name}</dd>
              </div>

              <div className="detail-kv-row">
                <dt className="detail-kv-label">Added to KukGrade</dt>
                <dd className="detail-kv-value">{formatLongDate(student.created_at)}</dd>
              </div>
            </dl>
          </div>

          {/* What an imported file said that KukGrade has no field for. */}
          {student.extra_information.length > 0 ? (
            <div className="detail-section-card">
              <h2 className="detail-section-title">Extra information</h2>
              <dl className="detail-kv-grid">
                {student.extra_information.map((info) => (
                  <div className="detail-kv-row" key={info.label}>
                    <dt className="detail-kv-label">{info.label}</dt>
                    <dd className="detail-kv-value">{info.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {/* Card 2: Grading history - native + linked historical records */}
          <div className="detail-section-card">
            <h2 className="detail-section-title">Grading history</h2>
            {gradingHistoryItems.length > 0 ? (
              <ResponsiveTable
                label="Grading history"
                rows={gradingHistoryItems}
                rowKey={(item) => `${item.source}-${item.record_id}`}
                columns={[
                  { key: "date", header: "Date", primary: true, render: (item) => formatGradingHistoryDate(item) },
                  {
                    key: "source",
                    header: "Source",
                    render: (item) =>
                      item.source === "LEGACY" && currentUser?.can_reconcile_imported_history ? (
                        <Link className="grading-history-source-badge source-historical" to={`/imports/history/${item.record_id}`}>
                          Historical · correct
                        </Link>
                      ) : (
                        <span className={`grading-history-source-badge ${item.source === "KUKGRADE" ? "source-kukgrade" : "source-historical"}`}>
                          {item.source === "KUKGRADE" ? "KukGrade" : "Historical"}
                        </span>
                      ),
                  },
                  {
                    key: "rank",
                    header: "Testing for",
                    render: (item) => (
                      <span className="cell-rank-highlight">
                        {item.testing_for_rank_name || item.source_testing_for_rank_text || "—"}
                      </span>
                    ),
                  },
                  {
                    key: "outcome",
                    header: "Outcome",
                    render: (item) =>
                      item.attendance_status === "DID_NOT_ATTEND" ? (
                        <span className="outcome-badge outcome-dna">{gradingHistoryOutcomeLabel(item)}</span>
                      ) : item.outcome === "PASS" ? (
                        <span className="outcome-badge outcome-passed">
                          <CheckIcon size={14} />
                          <span>{gradingHistoryOutcomeLabel(item)}</span>
                        </span>
                      ) : (
                        <span className="outcome-badge outcome-other">{gradingHistoryOutcomeLabel(item)}</span>
                      ),
                  },
                  {
                    key: "comments",
                    header: "Comments",
                    render: (item) => <span className="grading-history-comments-cell">{item.comments || "—"}</span>,
                  },
                ]}
              />
            ) : (
              <div className="detail-empty-box">
                <p className="detail-empty-title">No grading history recorded</p>
                <p className="detail-empty-desc">
                  This student has not yet completed any grading sessions.
                </p>
              </div>
            )}
          </div>

          {/* Card 3: Rank history timeline */}
          <div className="detail-section-card">
            <h2 className="detail-section-title">Rank history</h2>
            <div className="rank-timeline-track">
              {/* Promotion nodes from newest to oldest */}
              {promotions.map((p, idx) => (
                <div key={p.id} className="timeline-node-item">
                  <div className={`timeline-indicator ${idx === 0 ? "indicator-active" : ""}`} />
                  <div className="timeline-body">
                    <div className="timeline-date">{formatShortDate(p.effective_date || p.promoted_at)}</div>
                    <div className="timeline-rank-name">{p.to_rank_name}</div>
                    <div className="timeline-subtext">
                      Promoted at {p.session_title || "Grading Session"}
                    </div>
                  </div>
                </div>
              ))}

              {/* Base starting rank node */}
              <div className="timeline-node-item timeline-base-item">
                <div className="timeline-indicator indicator-base" />
                <div className="timeline-body">
                  <div className="timeline-date">{formatShortDate(student.created_at)}</div>
                  <div className="timeline-rank-name">
                    {promotions.length > 0
                      ? promotions[promotions.length - 1].from_rank_name
                      : student.current_rank_name}
                  </div>
                  <div className="timeline-subtext">
                    Initial rank recorded in KukGrade
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Operational Sidebar */}
        <div className="detail-right-column">
          {/* Card 1: Grading readiness */}
          <div className="detail-section-card">
            <h2 className="detail-section-title">Grading readiness</h2>
            <div className="readiness-body">
              <div className="readiness-row">
                <span className="readiness-label">Next rank</span>
                <span className="readiness-value">{nextRank?.name || "Highest curriculum rank"}</span>
              </div>

              <div className="readiness-row">
                <span className="readiness-label">Current status</span>
                {student.status === "ACTIVE" ? (
                  <span className="readiness-badge readiness-eligible">
                    <CheckIcon size={14} />
                    <span>Can be registered</span>
                  </span>
                ) : student.status === "INACTIVE" ? (
                  <span className="readiness-badge readiness-inactive">
                    <span>Inactive (temporary break)</span>
                  </span>
                ) : (
                  <span className="readiness-badge readiness-left">
                    <span>Left (registration blocked)</span>
                  </span>
                )}
              </div>

              <p className="readiness-guidance">
                {student.status === "ACTIVE"
                  ? "Active students can be added to a grading cohort, one grading at a time. KukGrade does not track training time or attendance, so readiness is the instructor's judgement."
                  : student.status === "INACTIVE"
                  ? "On a temporary break. Inactive blocks nothing: the student can still be added to a grading cohort."
                  : "Student has left. Left status blocks grading registration while preserving complete historical records."}
              </p>
            </div>
          </div>

          {/* Card 2: Record status */}
          <div className="detail-section-card">
            <h2 className="detail-section-title">Record status</h2>
            <div className="record-status-body">
              <div className="record-status-badge-row">
                <span className="record-status-label">Status</span>
                <span className={`student-status-badge status-${statusStr.toLowerCase()}`}>
                  <span className="status-dot" aria-hidden="true" />
                  {statusDisplay}
                </span>
              </div>

              <div className="record-status-policy-note">
                <p>
                  Active students can be added to gradings and appear in active registers.
                </p>
                <p>
                  If a student becomes inactive (for example, due to a temporary break), their record is retained and their history remains accessible.
                </p>
              </div>

              <button
                type="button"
                className="btn-change-status"
                onClick={() => {
                  setSelectedStatus(student.status as StudentStatus);
                  setStatusError(null);
                  setIsStatusModalOpen(true);
                }}
              >
                Change status
              </button>

              {currentUser?.can_delete_students && (
                <button
                  type="button"
                  className="btn-danger-sm"
                  onClick={() => {
                    setDeleteError(null);
                    setIsDeleteModalOpen(true);
                  }}
                >
                  Delete student
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Change Status Modal */}
      {isStatusModalOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!isSavingStatus) setIsStatusModalOpen(false);
          }}
        >
          <div
            ref={statusDialogRef}
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="change-status-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="change-status-title" className="modal-title">
                Change student status
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                aria-label="Close dialog"
                onClick={() => setIsStatusModalOpen(false)}
                disabled={isSavingStatus}
              >
                ✕
              </button>
            </div>

            {statusError && (
              <div role="alert" className="form-alert-banner">
                <p>{statusError}</p>
              </div>
            )}

            <form onSubmit={handleSaveStatus}>
              <div className="modal-body">
                <p className="modal-lead-text">
                  Update status for <strong>{student.first_name} {student.last_name}</strong>:
                </p>

                <div className="status-radio-options" role="radiogroup" aria-label="Student status options">
                  <label className={`status-radio-card ${selectedStatus === "ACTIVE" ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="status"
                      value="ACTIVE"
                      checked={selectedStatus === "ACTIVE"}
                      onChange={() => setSelectedStatus("ACTIVE")}
                      data-dialog-autofocus={selectedStatus === "ACTIVE" ? true : undefined}
                    />
                    <div className="status-radio-content">
                      <div className="status-radio-header">
                        <span className="student-status-badge status-active">
                          <span className="status-dot" aria-hidden="true" />
                          Active
                        </span>
                      </div>
                      <p className="status-radio-desc">
                        Active student in regular training. Can be registered for gradings.
                      </p>
                    </div>
                  </label>

                  <label className={`status-radio-card ${selectedStatus === "INACTIVE" ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="status"
                      value="INACTIVE"
                      checked={selectedStatus === "INACTIVE"}
                      onChange={() => setSelectedStatus("INACTIVE")}
                      data-dialog-autofocus={selectedStatus === "INACTIVE" ? true : undefined}
                    />
                    <div className="status-radio-content">
                      <div className="status-radio-header">
                        <span className="student-status-badge status-inactive">
                          <span className="status-dot" aria-hidden="true" />
                          Inactive
                        </span>
                      </div>
                      <p className="status-radio-desc">
                        Temporary break or medical leave. Blocks nothing, and keeps all history.
                      </p>
                    </div>
                  </label>

                  <label className={`status-radio-card ${selectedStatus === "LEFT" ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="status"
                      value="LEFT"
                      checked={selectedStatus === "LEFT"}
                      onChange={() => setSelectedStatus("LEFT")}
                      data-dialog-autofocus={selectedStatus === "LEFT" ? true : undefined}
                    />
                    <div className="status-radio-content">
                      <div className="status-radio-header">
                        <span className="student-status-badge status-left">
                          <span className="status-dot" aria-hidden="true" />
                          Left
                        </span>
                      </div>
                      <p className="status-radio-desc">
                        Has left. Cannot be registered for gradings; all history is kept.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-form-cancel"
                  onClick={() => setIsStatusModalOpen(false)}
                  disabled={isSavingStatus}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-form-submit"
                  disabled={isSavingStatus}
                >
                  {isSavingStatus ? "Updating..." : "Update status"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Student Modal */}
      {isDeleteModalOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!isDeletingStudent) setIsDeleteModalOpen(false);
          }}
        >
          <div
            ref={deleteDialogRef}
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-student-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="delete-student-title" className="modal-title">
                Delete student
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                aria-label="Close dialog"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeletingStudent}
              >
                ✕
              </button>
            </div>

            {deleteError && (
              <div role="alert" className="form-alert-banner">
                <p>{deleteError}</p>
              </div>
            )}

            <div className="modal-body">
              <p className="modal-lead-text">
                Permanently delete <strong>{student.first_name} {student.last_name}</strong>&apos;s
                record? This cannot be undone. It also deletes every grading registration, assessment, outcome and promotion of theirs, and puts back any rank they were promoted to. Historical grading records linked to them are kept, just no longer linked.
              </p>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-form-cancel"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeletingStudent}
                data-dialog-autofocus
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger-sm"
                onClick={handleDeleteStudent}
                disabled={isDeletingStudent}
              >
                {isDeletingStudent ? "Deleting…" : "Delete student"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Student Details Modal */}
      {isEditModalOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!isSavingEdit) setIsEditModalOpen(false);
          }}
        >
          <div
            ref={editDialogRef}
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-student-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="edit-student-title" className="modal-title">
                Edit student record
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                aria-label="Close dialog"
                onClick={() => setIsEditModalOpen(false)}
                disabled={isSavingEdit}
              >
                ✕
              </button>
            </div>

            {editGeneralError && (
              <div role="alert" className="form-alert-banner">
                <p>{editGeneralError}</p>
              </div>
            )}

            <form onSubmit={handleSaveEdit} noValidate>
              <div className="modal-body">
                <div className="form-field-group" style={{ marginBottom: "1rem" }}>
                  <label htmlFor="edit-wksa-id" className="form-field-label">
                    WKSA ID
                  </label>
                  <input
                    id="edit-wksa-id"
                    type="text"
                    className={`form-text-input ${getEditFieldError("wksa_id") ? "input-error" : ""}`}
                    value={editWksaId}
                    onChange={(e) => setEditWksaId(e.target.value)}
                    disabled={isSavingEdit}
                    aria-invalid={!!getEditFieldError("wksa_id")}
                    aria-describedby={getEditFieldError("wksa_id") ? "edit-wksa-id-error" : "edit-wksa-id-help"}
                  />
                  {getEditFieldError("wksa_id") ? (
                    <p className="form-field-error" id="edit-wksa-id-error" role="alert">
                      {getEditFieldError("wksa_id")}
                    </p>
                  ) : (
                    <p className="form-field-help" id="edit-wksa-id-help">
                      {student.wksa_id_can_change
                        ? "Correct a mistyped ID, or record the black belt ID handed out at the national grading."
                        : "Correct a mistyped black belt ID. It never goes back to a student ID."}
                    </p>
                  )}
                </div>

                <div className="form-row-grid-2">
                  <div className="form-field-group">
                    <label htmlFor="edit-first-name" className="form-field-label">
                      First name <span className="required-star">*</span>
                    </label>
                    <input
                      id="edit-first-name"
                      type="text"
                      className={`form-text-input ${getEditFieldError("first_name") ? "input-error" : ""}`}
                      value={editFirstName}
                      onChange={(e) => setEditFirstName(e.target.value)}
                      disabled={isSavingEdit}
                      aria-required="true"
                      aria-invalid={!!getEditFieldError("first_name")}
                      aria-describedby={getEditFieldError("first_name") ? "edit-first-name-error" : undefined}
                      data-dialog-autofocus
                    />
                    {getEditFieldError("first_name") && (
                      <p className="form-field-error" id="edit-first-name-error" role="alert">{getEditFieldError("first_name")}</p>
                    )}
                  </div>

                  <div className="form-field-group">
                    <label htmlFor="edit-last-name" className="form-field-label">
                      Last name <span className="required-star">*</span>
                    </label>
                    <input
                      id="edit-last-name"
                      type="text"
                      className={`form-text-input ${getEditFieldError("last_name") ? "input-error" : ""}`}
                      value={editLastName}
                      onChange={(e) => setEditLastName(e.target.value)}
                      disabled={isSavingEdit}
                      aria-required="true"
                      aria-invalid={!!getEditFieldError("last_name")}
                      aria-describedby={getEditFieldError("last_name") ? "edit-last-name-error" : undefined}
                    />
                    {getEditFieldError("last_name") && (
                      <p className="form-field-error" id="edit-last-name-error" role="alert">{getEditFieldError("last_name")}</p>
                    )}
                  </div>
                </div>

                <div className="form-field-group" style={{ marginTop: "1rem" }}>
                  <label htmlFor="edit-dob" className="form-field-label">
                    Date of birth <span className="required-star">*</span>
                  </label>
                  <input
                    id="edit-dob"
                    type="date"
                    className={`form-text-input ${getEditFieldError("date_of_birth") ? "input-error" : ""}`}
                    value={editDob}
                    max={todayIsoDate()}
                    onChange={(e) => setEditDob(e.target.value)}
                    disabled={isSavingEdit}
                    aria-required="true"
                    aria-invalid={!!getEditFieldError("date_of_birth")}
                    aria-describedby={getEditFieldError("date_of_birth") ? "edit-dob-error" : undefined}
                  />
                  {getEditFieldError("date_of_birth") && (
                    <p className="form-field-error" id="edit-dob-error" role="alert">{getEditFieldError("date_of_birth")}</p>
                  )}
                </div>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-form-cancel"
                  onClick={() => setIsEditModalOpen(false)}
                  disabled={isSavingEdit}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-form-submit"
                  disabled={isSavingEdit}
                >
                  {isSavingEdit ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
