import { type FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";

import {
  ApiError,
  type FieldErrors,
  type Rank,
  type StudentStatus,
  getRanks,
  getStudent,
  getStudentRankHistory,
  updateStudent,
} from "./api";
import { useDialogFocus } from "./useDialogFocus";
import "./StudentScreens.css";

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      className="privacy-icon"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
    >
      <rect height="11" rx="2" ry="2" width="18" x="3" y="11" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
      width="14"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function formatDateFull(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function calculateAge(dobStr: string | null | undefined): number | null {
  if (!dobStr) return null;
  const dob = new Date(dobStr);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

function resolveAgeBand(dobStr: string | null | undefined): string {
  const age = calculateAge(dobStr);
  if (age === null) return "—";
  if (age <= 8) return "8 and under";
  if (age <= 12) return "9 – 12";
  if (age <= 17) return "13 – 17";
  return "18+";
}

export function StudentDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const studentId = Number(id);

  // Modals state
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Status modal state
  const [selectedStatus, setSelectedStatus] = useState<StudentStatus>("ACTIVE");
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Edit modal state
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editDob, setEditDob] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editFieldErrors, setEditFieldErrors] = useState<FieldErrors>({});
  const [editGeneralError, setEditGeneralError] = useState<string | null>(null);
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

  // 1. Fetch Student Detail
  const studentQuery = useQuery({
    queryKey: ["studentDetail", studentId],
    queryFn: () => getStudent(studentId),
    enabled: !isNaN(studentId) && studentId > 0,
  });

  // 2. Fetch Rank History
  const rankHistoryQuery = useQuery({
    queryKey: ["studentRankHistory", studentId],
    queryFn: () => getStudentRankHistory(studentId),
    enabled: !isNaN(studentId) && studentId > 0,
  });

  // 3. Fetch Ranks Catalogue
  const ranksQuery = useQuery({
    queryKey: ["ranksList"],
    queryFn: () => getRanks({ page_size: 100 }),
  });

  const student = studentQuery.data;
  const rankHistory = rankHistoryQuery.data;
  const ranks = useMemo<Rank[]>(() => {
    return Array.isArray(ranksQuery.data?.results) ? ranksQuery.data.results : [];
  }, [ranksQuery.data]);

  // Calculate Next Rank

  const nextRank = useMemo(() => {
    if (!student || ranks.length === 0) return null;
    const currentOrder = ranks.find((r) => r.id === student.current_rank)?.order;
    if (currentOrder === undefined) return null;
    const higherRanks = ranks
      .filter((r) => r.active && r.order > currentOrder)
      .sort((a, b) => a.order - b.order);
    return higherRanks.length > 0 ? higherRanks[0] : null;
  }, [student, ranks]);

  async function handleSaveStatus(e: FormEvent) {
    e.preventDefault();
    if (!student) return;

    setStatusError(null);
    setIsSavingStatus(true);
    try {
      await updateStudent(student.id, { status: selectedStatus });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["studentDetail", student.id] }),
        queryClient.invalidateQueries({ queryKey: ["studentsList"] }),
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
        first_name: editFirstName.trim(),
        last_name: editLastName.trim(),
        date_of_birth: editDob,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["studentDetail", student.id] }),
        queryClient.invalidateQueries({ queryKey: ["studentsList"] }),
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
      <section aria-labelledby="student-loading-title" className="student-detail-view">
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
      <section aria-labelledby="student-error-title" className="student-detail-view">
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
  const statusStr = student.status || "ACTIVE";
  const statusDisplay = student.status_display || statusStr;

  return (
    <section aria-labelledby="student-heading" className="student-detail-view">
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
          </p>
        </div>


        <div className="detail-header-actions">
          <button
            type="button"
            className="btn-edit-student"
            onClick={() => {
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
                  <span>{formatDateFull(student.date_of_birth)}</span>
                  <div className="privacy-badge-inline" title="Confidential: visible only on record">
                    <LockIcon />
                  </div>
                </dd>
              </div>

              <div className="detail-kv-row">
                <dt className="detail-kv-label">Age band</dt>
                <dd className="detail-kv-value">{resolveAgeBand(student.date_of_birth)}</dd>
              </div>

              <div className="detail-kv-row">
                <dt className="detail-kv-label">Current rank</dt>
                <dd className="detail-kv-value cell-rank-highlight">{student.current_rank_name}</dd>
              </div>

              <div className="detail-kv-row">
                <dt className="detail-kv-label">Joined</dt>
                <dd className="detail-kv-value">{formatDateFull(student.created_at)}</dd>
              </div>
            </dl>
          </div>

          {/* Card 2: Grading history */}
          <div className="detail-section-card">
            <h2 className="detail-section-title">Grading history</h2>
            {promotions.length > 0 ? (
              <div className="table-scroll-wrapper">
                <table className="students-data-table" aria-label="Grading history">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Session</th>
                      <th scope="col">Assessed rank</th>
                      <th scope="col">Outcome</th>
                      <th scope="col">Promoted to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promotions.map((p) => (
                      <tr key={p.id} className="student-table-row">
                        <td>{formatDateShort(p.grading_date || p.promoted_at)}</td>
                        <td className="session-title-cell">{p.session_title || "Standard Grading"}</td>
                        <td>{p.from_rank_name}</td>
                        <td>
                          <span className="outcome-badge outcome-passed">
                            <CheckIcon />
                            <span>Passed</span>
                          </span>
                        </td>
                        <td className="cell-rank-highlight">{p.to_rank_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                    <div className="timeline-date">{formatDateShort(p.effective_date || p.promoted_at)}</div>
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
                  <div className="timeline-date">{formatDateShort(student.created_at)}</div>
                  <div className="timeline-rank-name">
                    {promotions.length > 0
                      ? promotions[promotions.length - 1].from_rank_name
                      : student.current_rank_name}
                  </div>
                  <div className="timeline-subtext">
                    Joined Kuk Sool Won
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
                    <CheckIcon />
                    <span>Eligible for registration</span>
                  </span>
                ) : student.status === "INACTIVE" ? (
                  <span className="readiness-badge readiness-inactive">
                    <span>Inactive (Temporary break)</span>
                  </span>
                ) : (
                  <span className="readiness-badge readiness-left">
                    <span>Departed (Registration blocked)</span>
                  </span>
                )}
              </div>

              <p className="readiness-guidance">
                {student.status === "ACTIVE"
                  ? "This student meets the standard requirements and can be added to the next grading session cohort."
                  : student.status === "INACTIVE"
                  ? "Student is currently on a temporary break. Transition back to Active when regular training resumes."
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
                        Active student in regular training. Eligible for grading cohorts and session entry.
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
                        Temporary break or medical leave. Blocks nothing, preserves all history, and never flags errors.
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
                        Departed student. Blocks new grading registration while fully retaining all historical records.
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
                    className="form-text-input"
                    value={student.wksa_id}
                    disabled
                  />
                  <p className="form-field-help">
                    WKSA ID is immutable and cannot be changed.
                  </p>
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
                    max={new Date().toISOString().split("T")[0]}
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
