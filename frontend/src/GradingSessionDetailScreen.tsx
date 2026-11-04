import React, { useEffect, useMemo, useRef, useState } from "react";
import { keys } from "./queryKeys";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GradingSession,
  deleteGradingSession,
  errorMessage,
  getAllCandidateAssessments,
  getAllCandidateOutcomes,
  getAllGradingCandidates,
  getGradingSession,
  updateGradingSession,
} from "./api";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";
import { Alert } from "./Alert";
import { WarningIcon } from "./Icons";
import { useAuth } from "./auth";
import { CandidateDialogs } from "./CandidateDialogs";
import { SessionActionsMenu } from "./SessionActionsMenu";
import { SessionCandidatesSection } from "./SessionCandidatesSection";
import { SessionConfirmDialog, type SessionConfirm } from "./SessionConfirmDialog";
import { SessionStatusBadge } from "./StatusBadge";
import { formatSessionDate } from "./dates";
import "./GradingSessions.css";
import { buttonClass } from "./buttonClass";
import { SessionLifecycle, SessionNotes } from "./SessionParts";
import {
  type SessionAction,
  confirmDetails,
  enrichCandidates,
  filterCandidates,
  nextActionFor,
  toAttendanceCandidate,
} from "./sessionDetail";
import { useActionsMenu } from "./useActionsMenu";
import { useCandidateWork } from "./useCandidateWork";

export function GradingSessionDetailScreen(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Number(), not parseInt: "12abc" is no session, not session 12.
  const sessionId = Number(id);
  const valid = !isNaN(sessionId);
  const { user: currentUser } = useAuth();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const menu = useActionsMenu();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<SessionConfirm | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");

  const sessionQuery = useQuery({
    queryKey: keys.gradingSessions.detail(sessionId),
    queryFn: () => getGradingSession(sessionId),
    enabled: valid,
  });
  const candidatesQuery = useQuery({
    queryKey: keys.gradingCandidates.session(sessionId),
    queryFn: () => getAllGradingCandidates({ session: sessionId }),
    enabled: valid,
  });
  const assessmentsQuery = useQuery({
    queryKey: keys.candidateAssessments.session(sessionId),
    queryFn: () => getAllCandidateAssessments({ session: sessionId }),
    enabled: valid,
  });
  const outcomesQuery = useQuery({
    queryKey: keys.candidateOutcomes.session(sessionId),
    queryFn: () => getAllCandidateOutcomes({ session: sessionId }),
    enabled: valid,
  });

  const session = sessionQuery.data;

  // A finished session may leave this viewer nothing to do: then there is no menu.
  const hasSessionActions = Boolean(
    session &&
      (session.status === "DRAFT" ||
        session.status === "OPEN" ||
        session.status === "LOCKED" ||
        currentUser?.can_read_audit_log ||
        session.can_be_deleted),
  );
  // Finishing a session can take the menu's button away with focus still on it.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hadSessionActions = useRef(false);
  useEffect(() => {
    if (hadSessionActions.current && !hasSessionActions && document.activeElement === document.body) {
      headingRef.current?.focus();
    }
    hadSessionActions.current = hasSessionActions;
  }, [hasSessionActions]);
  const cancelReasonRequired = session?.status === "LOCKED";

  const updateSessionMutation = useMutation({
    mutationFn: (payload: Parameters<typeof updateGradingSession>[1]) => updateGradingSession(sessionId, payload),
    onSuccess: (updated: GradingSession) => {
      // The response is the new state of this session; every list that
      // summarises it (the current and upcoming sessions, the years, the
      // pages, the move targets) needs refetching, but not this session.
      queryClient.setQueryData(keys.gradingSessions.detail(sessionId), updated);
      void queryClient.invalidateQueries({
        queryKey: keys.gradingSessions.all(),
        predicate: (query) => query.queryKey[1] !== "detail",
      });
      setConfirm(null);
      setCancellationReason("");
      setActionError(null);
    },
    onError: (err: unknown) => setActionError(errorMessage(err, "Failed to update session.")),
  });

  const deleteSessionMutation = useMutation({
    mutationFn: () => deleteGradingSession(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.gradingSessions.all() });
      void navigate("/gradings");
    },
    onError: (err: unknown) => setActionError(errorMessage(err, "Failed to delete session.")),
  });
  const confirmPending = updateSessionMutation.isPending || deleteSessionMutation.isPending;

  const work = useCandidateWork(sessionId, { setError: setActionError, setMessage: setActionMessage });

  const enrichedCandidates = useMemo(
    () => enrichCandidates(candidatesQuery.data?.results ?? [], assessmentsQuery.data?.results ?? [], outcomesQuery.data?.results ?? []),
    [candidatesQuery.data, assessmentsQuery.data, outcomesQuery.data],
  );
  const filteredCandidates = useMemo(
    () => filterCandidates(enrichedCandidates, search, statusFilter),
    [enrichedCandidates, search, statusFilter],
  );

  // The server's count (completed, outcome not finalised - see
  // with_session_progress), the same number Overview and Gradings show. A
  // decision can only be made once the session is locked, so the banner
  // waits for that.
  const awaitingDecisionCount = session?.status === "LOCKED" ? session.awaiting_decision_count : 0;

  const active = enrichedCandidates.filter((item) => item.candidate.status !== "WITHDRAWN");
  const unpreparedIds = active.filter((item) => !item.assessment).map((item) => item.candidate.id);
  const preparedIds = active.filter((item) => item.assessment?.status === "NOT_STARTED").map((item) => item.assessment!.id);
  // A no-show is a candidate who never started: the server refuses to
  // withdraw one whose assessment work has begun (that needs a locked-session
  // withdrawal), so only those are offered.
  const attendanceCandidates = enrichedCandidates
    .filter((item) => item.candidate.status === "REGISTERED" && (!item.assessment || item.assessment.status === "NOT_STARTED"))
    .map(toAttendanceCandidate);

  if (!valid) {
    return (
      <section aria-labelledby="gsd-invalid-id-heading" className="page gsd-page" data-testid="gsd-page">
        <EmptyState
          titleAs="h2"
          titleId="gsd-invalid-id-heading"
          title="Grading session not found"
          action={<Link to="/gradings" className={buttonClass({ variant: "primary" })}>Back to Gradings</Link>}
        >
          Please return to the sessions list.
        </EmptyState>
      </section>
    );
  }

  if (sessionQuery.isLoading) {
    return (
      <section aria-label="Grading session" className="page gsd-page" data-testid="gsd-page">
        <LoadingState>Loading grading session…</LoadingState>
      </section>
    );
  }

  if (sessionQuery.isError || !session) {
    return (
      <section aria-labelledby="gsd-error-heading" className="page gsd-page" data-testid="gsd-page">
        <EmptyState
          titleAs="h2"
          titleId="gsd-error-heading"
          title="Failed to load grading session"
          action={<Link to="/gradings" className={buttonClass({ variant: "primary" })}>Back to Gradings</Link>}
        >
          {errorMessage(sessionQuery.error, "Session not found.")}
        </EmptyState>
      </section>
    );
  }

  const handleAction = (action: SessionAction) => {
    menu.setOpen(false);
    setActionError(null);
    // The dropdown (and the menu item just clicked) unmounts in the same
    // render as the confirm modal mounting, so useDialogFocus would capture
    // document.body as "previously focused" unless focus is moved onto the
    // still-mounted trigger button before that happens.
    menu.buttonRef.current?.focus();
    setConfirm({ action, ...confirmDetails(action, session, active.length) });
  };

  const handleConfirm = () => {
    if (!confirm) return;
    if (confirm.action === "DELETE") deleteSessionMutation.mutate();
    else if (confirm.action === "CANCEL") updateSessionMutation.mutate({ status: "CANCELLED", cancellation_reason: cancellationReason });
    else if (confirm.action === "OPEN") updateSessionMutation.mutate({ status: "OPEN" });
    else if (confirm.action === "LOCK") updateSessionMutation.mutate({ status: "LOCKED" });
    else updateSessionMutation.mutate({ status: "COMPLETED" });
  };

  const decided = session.status === "LOCKED" || session.status === "COMPLETED";

  return (
    <section aria-labelledby="gsd-title" className="page gsd-page" data-testid="gsd-page">
      <PageHeader
        crumbs={[{ label: "Gradings", to: "/gradings" }, { label: session.title }]}
        title={session.title}
        titleId="gsd-title"
        titleRef={headingRef}
        tag={<SessionStatusBadge status={session.status} label={session.status_display} />}
        subtitle={
          <>
            <span>{formatSessionDate(session.grading_date)}</span> <span aria-hidden="true">·</span>{" "}
            <span>{session.location || "No location specified"}</span>
          </>
        }
        actions={
          <>
            {decided && (
              <Link to={`/gradings/${session.id}/decisions`} className={buttonClass({ variant: "secondary" })} data-testid="gsd-final-decisions-btn">
                Final decisions →
              </Link>
            )}
            {decided && (
              <Link to={`/gradings/${session.id}/promotions`} className={buttonClass({ variant: "secondary" })} data-testid="gsd-promotion-ledger-btn">
                Promotion ledger →
              </Link>
            )}
            {hasSessionActions && <SessionActionsMenu session={session} user={currentUser} menu={menu} onAction={handleAction} />}
            {(session.status === "DRAFT" || session.status === "OPEN") && (
              <Link to={`/gradings/${session.id}/register`} className={buttonClass({ variant: "primary" })} data-testid="gsd-add-candidate-btn">
                Add candidate <span aria-hidden="true">→</span>
              </Link>
            )}
          </>
        }
      />

      {actionError && <Alert onDismiss={() => setActionError(null)}>{actionError}</Alert>}
      {actionMessage && (
        <Alert tone="success" onDismiss={() => setActionMessage(null)}>
          {actionMessage}
        </Alert>
      )}

      <SessionLifecycle status={session.status} />

      {awaitingDecisionCount > 0 && (
        <Alert
          tone="warning"
          role="status"
          aria-label="Action required"
          icon={<WarningIcon size={18} />}
          action={
            <Link to={`/gradings/${session.id}/decisions`} className={buttonClass({ variant: "ghost", small: true })} data-testid="gsd-review-decisions-btn">
              Review <span aria-hidden="true">→</span>
            </Link>
          }
        >
          {awaitingDecisionCount} candidate{awaitingDecisionCount === 1 ? "" : "s"} awaiting final decision
        </Alert>
      )}

      <SessionCandidatesSection
        session={session}
        all={enrichedCandidates}
        shown={filteredCandidates}
        search={search}
        onSearch={setSearch}
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
        work={work}
        attendanceCount={attendanceCandidates.length}
        unpreparedIds={unpreparedIds}
        preparedIds={preparedIds}
        canOverrideLocked={Boolean(currentUser?.can_override_locked_session)}
        nextActionFor={(item) => nextActionFor(item, session, Boolean(currentUser?.can_make_final_grading_decision))}
        onConfirmAttendance={() => {
          setActionError(null);
          work.attendance.setOpen(true);
        }}
      />

      <SessionNotes
        notes={session.notes}
        saving={updateSessionMutation.isPending}
        onSave={(notes, saved) => updateSessionMutation.mutate({ notes }, { onSuccess: saved })}
      />

      {confirm && (
        <SessionConfirmDialog
          confirm={confirm}
          pending={confirmPending}
          deleting={deleteSessionMutation.isPending}
          reasonRequired={cancelReasonRequired}
          reason={cancellationReason}
          onReason={setCancellationReason}
          onConfirm={handleConfirm}
          onClose={() => setConfirm(null)}
        />
      )}

      <CandidateDialogs
        work={work}
        attendanceCandidates={attendanceCandidates}
        actionError={actionError}
        onAttendanceClose={() => {
          work.attendance.setOpen(false);
          setActionError(null);
        }}
      />
    </section>
  );
}
