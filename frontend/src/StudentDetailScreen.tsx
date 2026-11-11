import { useState } from "react";
import { keys, refresh } from "./queryKeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";

import {
  type GradingHistoryItem,
  type StudentStatus,
  deleteStudent,
  getStudent,
  getStudentGradingHistory,
  getStudentRankHistory,
  updateStudent,
  errorMessage,
} from "./api";
import { PageHeader } from "./PageHeader";
import { StudentEditDialog } from "./StudentEditDialog";
import { StudentStatusDialog } from "./StudentStatusDialog";
import { EmptyState } from "./EmptyState";
import { RecordPage } from "./RecordPage";
import { recordStatus, useIdParam } from "./recordStatus";
import { Alert } from "./Alert";
import { useServerForm } from "./forms";
import { useAuth } from "./auth";
import { ConfirmDialog } from "./ConfirmDialog";
import { Badge } from "./Badge";
import { buttonClass } from "./buttonClass";
import { badgeProps } from "./badgeClass";
import { ResponsiveTable } from "./ResponsiveTable";
import { useChoices } from "./choices";
import { StudentStatusBadge } from "./StatusBadge";
import "./StudentScreens.css";
import { formatLongDate, formatMonthYear, formatShortDate } from "./dates";
import { CheckIcon, LockIcon } from "./Icons";
import { Button } from "./Button";
import { cx } from "./cx";

function formatGradingHistoryDate(item: GradingHistoryItem): string {
  if (item.date_precision === "DAY" && item.date) {
    return formatShortDate(item.date);
  }
  if (item.cycle_year && item.cycle_month) {
    return formatMonthYear(item.cycle_year, item.cycle_month);
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
  const id = useIdParam();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  // The queries wait for a real id; 0 is never sent.
  const studentId = id ?? 0;

  // Modals state
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // Status modal state
  const [statusError, setStatusError] = useState<string | null>(null);

  // Edit modal state
  const editForm = useServerForm(["first_name", "last_name", "wksa_id", "date_of_birth"]);

  // Delete modal state
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const statusMutation = useMutation({
    mutationFn: (change: { id: number; status: StudentStatus }) => updateStudent(change.id, { status: change.status }),
    onSuccess: async (_saved, change) => {
      await refresh.afterStudentChange(queryClient, change.id);
      setIsStatusModalOpen(false);
    },
    onError: (err) => setStatusError(errorMessage(err, "Failed to update student status.")),
  });
  const isSavingStatus = statusMutation.isPending;

  const editMutation = useMutation({
    mutationFn: (change: { id: number; changes: Parameters<typeof updateStudent>[1] }) =>
      updateStudent(change.id, change.changes),
    onSuccess: async (_saved, change) => {
      // An edit is audited too, so the audit log is read again with the rest.
      await refresh.afterStudentChange(queryClient, change.id);
      setIsEditModalOpen(false);
    },
    onError: (err) => editForm.handle(err, "Failed to update student details."),
  });
  const isSavingEdit = editMutation.isPending;

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteStudent(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.students.list() }),
        queryClient.invalidateQueries({ queryKey: keys.auditEvents.all() }),
      ]);
      navigate("/students");
    },
    onError: (err) => setDeleteError(errorMessage(err, "Failed to delete student.")),
  });
  const isDeletingStudent = deleteMutation.isPending;

  // 1. Fetch Student Detail
  const studentQuery = useQuery({
    queryKey: keys.students.detail(studentId),
    queryFn: () => getStudent(studentId),
    enabled: id !== null,
  });

  // 2. Fetch Rank History
  const rankHistoryQuery = useQuery({
    queryKey: keys.students.rankHistory(studentId),
    queryFn: () => getStudentRankHistory(studentId),
    enabled: id !== null,
  });

  // 2b. Fetch unified grading history (native + linked historical records)
  const gradingHistoryQuery = useQuery({
    queryKey: keys.students.gradingHistory(studentId),
    queryFn: () => getStudentGradingHistory(studentId),
    enabled: id !== null,
  });

  const student = studentQuery.data;
  const statusMeaning = useChoices().student_statuses.find((choice) => choice.value === student?.status)?.description;
  const rankHistory = rankHistoryQuery.data;

  function handleDeleteStudent() {
    if (!student) return;
    setDeleteError(null);
    deleteMutation.mutate(student.id);
  }

  const status = recordStatus(id, studentQuery);
  if (status || !student) {
    return (
      <RecordPage
        back={{ to: "/students", label: "Students" }}
        error={studentQuery.error}
        failed="The student record could not be loaded."
        label="Student record"
        loading="Loading student record…"
        missing="Student record not found"
        status={status ?? "loading"}
        onRetry={() => void studentQuery.refetch()}
      />
    );
  }

  const promotions = rankHistory?.promotions ?? [];
  const gradingHistoryItems = gradingHistoryQuery.data?.items ?? [];
  // Deleted after their history began: kept so past gradings still show who
  // it was, and closed to changes (the server refuses them).
  const isDeleted = student.deleted_at !== null;

  return (
    <section aria-labelledby="student-heading" className="page">
      <PageHeader
        back={{ to: "/students", label: "Students" }}
        title={`${student.first_name} ${student.last_name}`}
        titleId="student-heading"
        tag={<StudentStatusBadge status={student.status} label={student.status_display} />}
        subtitle={
          <>
            WKSA ID <span className="wksa-id-pill meta">{student.wksa_id}</span>
            {student.previous_wksa_ids.length > 0 ? (
              <span>
                {" "}
                Previously{" "}
                {student.previous_wksa_ids.map((previous) => (
                  <span className="wksa-id-pill meta" key={previous.wksa_id}>
                    {previous.wksa_id}
                  </span>
                ))}
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            {currentUser?.can_read_audit_log && (
              <Link
                to={`/audit?subject=student:${student.id}`}
                className={buttonClass({ variant: "ghost" })}
                data-testid="student-history-link"
              >
                History
              </Link>
            )}
            {!isDeleted && (
              <Button
                variant="secondary"
                onClick={() => {
                  editForm.reset();
                  setIsEditModalOpen(true);
                }}
              >
                Edit student
              </Button>
            )}
          </>
        }
      />

      {isDeleted && (
        <Alert tone="info" title={`Deleted on ${formatLongDate(student.deleted_at)}`}>
          This student is no longer on the student list and their record can no longer be changed. It is kept so that
          their past gradings, marks and decisions still show who they were.
        </Alert>
      )}

      {/* Two-Column Grid Layout */}
      <div className="student-detail-grid">
        {/* Left Column: Core Record, Grading History & Rank History */}
        <div className="stack detail-left-column">
          {/* Card 1: Student details */}
          <div className="card">
            <h2 className="section-title section-title--ruled">Student details</h2>
            <dl className="facts-list">
              <div>
                <dt>Date of birth</dt>
                <dd>
                  <span>{formatLongDate(student.date_of_birth)}</span>
                  <div className="privacy-badge-inline" title="Confidential: visible only on record">
                    <LockIcon size={14} className="privacy-icon" />
                  </div>
                </dd>
              </div>

              <div>
                <dt>Age band</dt>
                <dd>{student.age_band_display}</dd>
              </div>

              <div>
                <dt>Current rank</dt>
                <dd className="cell-rank-highlight item-title">{student.current_rank_name}</dd>
              </div>

              <div>
                <dt>Added to KukGrade</dt>
                <dd>{formatLongDate(student.created_at)}</dd>
              </div>
            </dl>
          </div>

          {/* What an imported file said that KukGrade has no field for. */}
          {student.extra_information.length > 0 ? (
            <div className="card">
              <h2 className="section-title section-title--ruled">Extra information</h2>
              <dl className="facts-list">
                {student.extra_information.map((info) => (
                  <div key={info.label}>
                    <dt>{info.label}</dt>
                    <dd>{info.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {/* Card 2: Grading history - native + linked historical records */}
          <div className="card">
            <h2 className="section-title section-title--ruled">Grading history</h2>
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
                        <Link {...badgeProps("neutral")} to={`/imports/history/${item.record_id}`}>
                          Historical · correct
                        </Link>
                      ) : item.session_id && item.candidate_id ? (
                        <Link
                          {...badgeProps("info")}
                          to={`/gradings/${item.session_id}/assessments/${item.candidate_id}/review`}
                        >
                          KukGrade · view assessment
                        </Link>
                      ) : (
                        <Badge tone={item.source === "KUKGRADE" ? "info" : "neutral"}>
                          {item.source === "KUKGRADE" ? "KukGrade" : "Historical"}
                        </Badge>
                      ),
                  },
                  {
                    key: "rank",
                    header: "Testing for",
                    render: (item) => (
                      <>
                        <span className="cell-rank-highlight item-title">
                          {item.testing_for_rank_name || item.source_testing_for_rank_text || "—"}
                        </span>
                        {item.from_rank_name ? (
                          <small className="grading-history-detail meta">
                            From {item.from_rank_name} · {item.age_band_display}
                          </small>
                        ) : null}
                      </>
                    ),
                  },
                  {
                    key: "outcome",
                    header: "Outcome",
                    render: (item) =>
                      item.attendance_status === "DID_NOT_ATTEND" ? (
                        <Badge tone="neutral">{gradingHistoryOutcomeLabel(item)}</Badge>
                      ) : item.outcome === "PASS" ? (
                        <Badge tone="success" icon={<CheckIcon size={14} />}>
                          {gradingHistoryOutcomeLabel(item)}
                        </Badge>
                      ) : (
                        <Badge tone="warning">{gradingHistoryOutcomeLabel(item)}</Badge>
                      ),
                  },
                  {
                    key: "comments",
                    header: "Comments",
                    render: (item) => (
                      <span className="grading-history-comments-cell subtext">
                        {item.comments || "—"}
                        {item.conditional_requirements ? (
                          <small className="grading-history-detail meta">
                            Still required: {item.conditional_requirements}
                          </small>
                        ) : null}
                      </span>
                    ),
                  },
                ]}
              />
            ) : (
              <EmptyState framed title="No grading history recorded">
                This student has not yet completed any grading sessions.
              </EmptyState>
            )}
          </div>

          {/* Card 3: Rank history timeline */}
          <div className="card">
            <h2 className="section-title section-title--ruled">Rank history</h2>
            <div className="rank-timeline-track">
              {/* Promotion nodes from newest to oldest */}
              {promotions.map((p, idx) => (
                <div key={p.id} className="timeline-node-item">
                  <div className={cx("timeline-indicator", idx === 0 && "indicator-active")} />
                  <div>
                    <div className="meta">{formatShortDate(p.effective_date || p.promoted_at)}</div>
                    <div className="item-title">{p.to_rank_name}</div>
                    <div className="subtext">Promoted at {p.session_title || "Grading Session"}</div>
                  </div>
                </div>
              ))}

              {/* Base starting rank node */}
              <div className="timeline-node-item">
                <div className="timeline-indicator indicator-base" />
                <div>
                  <div className="meta">{formatShortDate(student.created_at)}</div>
                  <div className="item-title">
                    {promotions.length > 0
                      ? promotions[promotions.length - 1].from_rank_name
                      : student.current_rank_name}
                  </div>
                  <div className="subtext">Initial rank recorded in KukGrade</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Operational Sidebar */}
        <div className="stack detail-right-column">
          {/* Card 1: Grading readiness. Whether they can be registered is the
              server's answer (can_be_graded); a deleted record is closed, so
              it has no readiness to show. */}
          {!isDeleted && (
            <div className="card">
              <h2 className="section-title section-title--ruled">Grading readiness</h2>
              <div className="stack stack--4">
                <div className="action-row">
                  <span className="meta">Next rank</span>
                  <span className="readiness-value item-title">
                    {student.next_rank_name ?? "Highest curriculum rank"}
                  </span>
                </div>

                <div className="action-row">
                  <span className="meta">Current status</span>
                  {student.can_be_graded ? (
                    <Badge tone="success" icon={<CheckIcon size={14} />}>
                      Can be registered
                    </Badge>
                  ) : (
                    <Badge tone="danger">Cannot be registered</Badge>
                  )}
                </div>

                <p className="readiness-guidance subtext">
                  {statusMeaning} KukGrade does not track training time or attendance, so readiness is the instructor's
                  judgement.
                </p>
              </div>
            </div>
          )}

          {/* Card 2: Record status */}
          <div className="card">
            <h2 className="section-title section-title--ruled">Record status</h2>
            <div className="stack stack--4">
              <div className="action-row">
                <span className="meta">Status</span>
                <StudentStatusBadge status={student.status} label={student.status_display} />
              </div>

              <div className="stack stack--2 record-status-policy-note subtext">
                <p>Active students can be added to gradings and appear in active registers.</p>
                <p>
                  If a student becomes inactive (for example, due to a temporary break), their record is retained and
                  their history remains accessible.
                </p>
              </div>

              {!isDeleted && (
                <Button
                  variant="secondary"
                  block
                  onClick={() => {
                    setStatusError(null);
                    setIsStatusModalOpen(true);
                  }}
                >
                  Change status
                </Button>
              )}

              {/* Whether they can be deleted now, and if not why, is the server's. */}
              {currentUser?.can_delete_students && student.deletion_blocked_by && (
                <p className="subtext" data-testid="student-delete-blocked">
                  {student.deletion_blocked_by}
                </p>
              )}
              {student.can_be_deleted && (
                <Button
                  variant="danger"
                  onClick={() => {
                    setDeleteError(null);
                    setIsDeleteModalOpen(true);
                  }}
                >
                  Delete student
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {isStatusModalOpen && (
        <StudentStatusDialog
          error={statusError}
          name={`${student.first_name} ${student.last_name}`}
          saving={isSavingStatus}
          status={student.status as StudentStatus}
          onClose={() => setIsStatusModalOpen(false)}
          onSave={(status) => {
            setStatusError(null);
            statusMutation.mutate({ id: student.id, status });
          }}
        />
      )}

      {/* Delete Student Modal */}
      {isDeleteModalOpen && (
        <ConfirmDialog
          title="Delete student"
          confirmLabel="Delete student"
          pendingLabel="Deleting…"
          pending={isDeletingStudent}
          error={deleteError}
          danger
          onClose={() => setIsDeleteModalOpen(false)}
          onConfirm={handleDeleteStudent}
        >
          <p>Delete this student? This cannot be undone. Their past gradings, marks and decisions stay as recorded.</p>
        </ConfirmDialog>
      )}

      {isEditModalOpen && (
        <StudentEditDialog
          form={editForm}
          saving={isSavingEdit}
          student={student}
          onClose={() => setIsEditModalOpen(false)}
          onSave={(changes) => editMutation.mutate({ id: student.id, changes })}
        />
      )}
    </section>
  );
}
