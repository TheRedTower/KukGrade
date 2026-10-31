import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CandidateAssessment,
  CandidateOutcome,
  GradingCandidate,
  GradingSession,
  bulkGenerateCandidateAssessments,
  bulkStartCandidateAssessments,
  bulkUpdateCandidateStatus,
  deleteGradingCandidate,
  getAllCandidateAssessments,
  getAllCandidateOutcomes,
  getAllGradingCandidates,
  getAllGradingSessions,
  getGradingSession,
  getWithdrawalReasons,
  moveGradingCandidate,
  updateGradingSession,
  deleteGradingSession,
  withdrawLockedCandidate,
  errorMessage,
} from "./api";
import { useAuth } from "./auth";
import {
  LockedWithdrawalDialog,
  MoveRegistrationDialog,
  NoShowDialog,
  RemoveRegistrationDialog,
  type AttendanceCandidate,
} from "./GradingAttendanceDialogs";
import { OutcomeProposalDrawer } from "./OutcomeProposalDrawer";
import { ResponsiveTable } from "./ResponsiveTable";
import { SESSION_STATUS_LABELS } from "./sessionStatus";
import { AssessmentBadge, OutcomeBadge, SessionStatusBadge } from "./StatusBadge";
import { useDialogFocus } from "./useDialogFocus";
import { RankBelt } from "./Belt";
import { formatSessionDate } from "./dates";
import "./GradingSessions.css";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { buttonClass } from "./buttonClass";


interface EnrichedCandidate {
  candidate: GradingCandidate;
  assessment?: CandidateAssessment;
  outcome?: CandidateOutcome;
}

function toAttendanceCandidate(item: EnrichedCandidate): AttendanceCandidate {
  return {
    id: item.candidate.id,
    name: item.candidate.student_display_name,
    wksaId: item.candidate.student_wksa_id,
  };
}

/** The least space left between an open menu and the screen's edge. */
const MENU_EDGE_PX = 8;

export function GradingSessionDetailScreen(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const sessionId = id ? parseInt(id, 10) : NaN;
  const { user: currentUser } = useAuth();

  // Drawer state for the instructor outcome proposal
  const [proposalDrawerItem, setProposalDrawerItem] = useState<EnrichedCandidate | null>(null);
  const [attendanceDialogOpen, setAttendanceDialogOpen] = useState(false);
  const [withdrawalCandidate, setWithdrawalCandidate] = useState<EnrichedCandidate | null>(null);
  const [withdrawalError, setWithdrawalError] = useState<string | null>(null);
  const [registrationAction, setRegistrationAction] = useState<{
    kind: "move" | "remove";
    item: EnrichedCandidate;
  } | null>(null);
  const [registrationError, setRegistrationError] = useState<string | null>(null);

  // Search & Filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Actions dropdown & modal state
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    actionType: "LOCK" | "COMPLETE" | "CANCEL" | "DELETE" | "OPEN";
  } | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");

  // Close actions dropdown on outside click or Escape key
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        actionsMenuRef.current &&
        !actionsMenuRef.current.contains(event.target as Node)
      ) {
        setActionsMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActionsMenuOpen(false);
      }
    }

    if (actionsMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [actionsMenuOpen]);

  // The menu opens from the button's right edge; where that would push it off the
  // left of the screen (the button is near the left on a phone), open from the
  // left edge instead.
  useLayoutEffect(() => {
    const menu = actionsMenuRef.current?.querySelector<HTMLElement>(".gsd-dropdown-menu");
    if (!actionsMenuOpen || !menu) return;
    const place = () => {
      delete menu.dataset.align;
      if (menu.getBoundingClientRect().left < MENU_EDGE_PX) menu.dataset.align = "start";
    };
    place();
    // A phone turned round while the menu is open.
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [actionsMenuOpen]);

  // 1. Fetch session details
  const sessionQuery = useQuery({
    queryKey: ["gradingSessions", "detail", sessionId],
    queryFn: () => getGradingSession(sessionId),
    enabled: !isNaN(sessionId),
  });

  // 2. Fetch candidates for this session
  const candidatesQuery = useQuery({
    queryKey: ["gradingCandidates", sessionId],
    queryFn: () => getAllGradingCandidates({ session: sessionId }),
    enabled: !isNaN(sessionId),
  });

  // 3. Fetch candidate assessments for this session
  const assessmentsQuery = useQuery({
    queryKey: ["candidateAssessments", sessionId],
    queryFn: () => getAllCandidateAssessments({ session: sessionId }),
    enabled: !isNaN(sessionId),
  });

  // 4. Fetch candidate outcomes for this session
  const outcomesQuery = useQuery({
    queryKey: ["candidateOutcomes", sessionId],
    queryFn: () => getAllCandidateOutcomes({ session: sessionId }),
    enabled: !isNaN(sessionId),
  });

  const session = sessionQuery.data;
  const cancelReasonRequired = session?.status === "LOCKED";

  // Mutations
  const updateSessionMutation = useMutation({
    mutationFn: (payload: Parameters<typeof updateGradingSession>[1]) =>
      updateGradingSession(sessionId, payload),
    onSuccess: (updated: GradingSession) => {
      // The response is the new state of this session; every list that
      // summarises it (the current and upcoming sessions, the years, the
      // pages, the move targets) needs refetching, but not this session.
      queryClient.setQueryData(["gradingSessions", "detail", sessionId], updated);
      void queryClient.invalidateQueries({
        queryKey: ["gradingSessions"],
        predicate: (query) => query.queryKey[1] !== "detail",
      });
      setIsEditingNotes(false);
      setConfirmModal(null);
      setCancellationReason("");
      setActionError(null);
    },
    onError: (err: unknown) => {
      setActionError(errorMessage(err, "Failed to update session."));
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: () => deleteGradingSession(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["gradingSessions"] });
      void navigate("/gradings");
    },
    onError: (err: unknown) => {
      setActionError(errorMessage(err, "Failed to delete session."));
    },
  });

  const isConfirmModalMutationPending =
    updateSessionMutation.isPending || deleteSessionMutation.isPending;

  const confirmModalDialogRef = useDialogFocus<HTMLDivElement>({
    isOpen: confirmModal !== null,
    onClose: () => setConfirmModal(null),
    canClose: !isConfirmModalMutationPending,
  });

  const refreshCandidateWork = () => {
    void queryClient.invalidateQueries({ queryKey: ["gradingCandidates", sessionId] });
    void queryClient.invalidateQueries({ queryKey: ["candidateAssessments", sessionId] });
    void queryClient.invalidateQueries({ queryKey: ["candidateOutcomes", sessionId] });
  };

  const bulkPrepareMutation = useMutation({
    mutationFn: (candidateIds: number[]) => bulkGenerateCandidateAssessments(candidateIds),
    onSuccess: ({ created, errors }) => {
      refreshCandidateWork();
      const failed = Object.keys(errors).length;
      setActionMessage(
        `${created.length} assessment${created.length === 1 ? "" : "s"} prepared${
          failed ? `; ${failed} could not be prepared` : ""
        }.`,
      );
      setActionError(failed ? Object.values(errors).flat().join(" ") : null);
    },
    onError: (err: unknown) => {
      setActionError(errorMessage(err, "Failed to prepare assessments."));
    },
  });

  const bulkStartMutation = useMutation({
    mutationFn: (assessmentIds: number[]) => bulkStartCandidateAssessments(assessmentIds),
    onSuccess: ({ started, errors }) => {
      refreshCandidateWork();
      const failed = Object.keys(errors).length;
      setActionMessage(
        `${started.length} assessment${started.length === 1 ? "" : "s"} started${
          failed ? `; ${failed} could not be started` : ""
        }.`,
      );
      setActionError(failed ? Object.values(errors).flat().join(" ") : null);
    },
    onError: (err: unknown) => {
      setActionError(errorMessage(err, "Failed to start assessments."));
    },
  });

  const attendanceMutation = useMutation({
    mutationFn: (candidateIds: number[]) =>
      // A no-show is by definition "did not attend".
      bulkUpdateCandidateStatus({
        candidates: candidateIds,
        status: "WITHDRAWN",
        withdrawal_reason: "ABSENT",
      }),
    onSuccess: ({ updated, errors }) => {
      refreshCandidateWork();
      setAttendanceDialogOpen(false);
      const failed = Object.keys(errors).length;
      setActionMessage(
        `${updated.length} candidate${updated.length === 1 ? "" : "s"} marked as no-show${
          failed ? `; ${failed} could not be updated` : ""
        }.`,
      );
      setActionError(failed ? Object.values(errors).flat().join(" ") : null);
    },
    onError: (err: unknown) => {
      setActionError(errorMessage(err, "Failed to confirm attendance."));
    },
  });

  const withdrawalMutation = useMutation({
    mutationFn: ({ candidateId, payload }: {
      candidateId: number;
      payload: Parameters<typeof withdrawLockedCandidate>[1];
    }) => withdrawLockedCandidate(candidateId, payload),
    onSuccess: (updated) => {
      refreshCandidateWork();
      setWithdrawalCandidate(null);
      setWithdrawalError(null);
      setActionError(null);
      setActionMessage(`${updated.student_display_name} was withdrawn from the locked session.`);
    },
    onError: (err: unknown) => {
      setWithdrawalError(
        errorMessage(err, "Failed to withdraw the candidate."),
      );
    },
  });

  const withdrawalReasonsQuery = useQuery({
    queryKey: ["withdrawalReasons"],
    queryFn: getWithdrawalReasons,
    enabled: withdrawalCandidate !== null,
  });

  // Sessions a registration can move to; loaded only when the move dialog opens.
  const moveTargetsQuery = useQuery({
    queryKey: ["gradingSessions", "move-targets"],
    queryFn: () => getAllGradingSessions({ status: "DRAFT,OPEN" }),
    enabled: registrationAction?.kind === "move",
  });
  const moveTargets = (moveTargetsQuery.data?.results ?? [])
    .filter((target) => target.id !== sessionId)
    .map((target) => ({
      id: target.id,
      label: `${target.title} · ${formatSessionDate(target.grading_date)}`,
    }));

  const closeRegistrationAction = () => {
    setRegistrationAction(null);
    setRegistrationError(null);
  };

  const registrationMutation = useMutation({
    mutationFn: async ({ kind, candidateId, targetSessionId }: {
      kind: "move" | "remove";
      candidateId: number;
      targetSessionId?: number;
    }) => {
      if (kind === "move") {
        await moveGradingCandidate(candidateId, targetSessionId as number);
      } else {
        await deleteGradingCandidate(candidateId);
      }
    },
    onSuccess: (_result, { kind }) => {
      const name = registrationAction?.item.candidate.student_display_name ?? "The candidate";
      refreshCandidateWork();
      void queryClient.invalidateQueries({ queryKey: ["gradingCandidates"] });
      closeRegistrationAction();
      setActionError(null);
      setActionMessage(
        kind === "move"
          ? `${name} was moved to another session.`
          : `${name} was removed from this session.`,
      );
    },
    onError: (err: unknown) => {
      setRegistrationError(
        errorMessage(err, "Failed to change the registration."),
      );
    },
  });

  // Combine data into EnrichedCandidate list
  const enrichedCandidates: EnrichedCandidate[] = useMemo(() => {
    const rawCandidates: GradingCandidate[] = candidatesQuery.data?.results ?? [];
    const assessments: CandidateAssessment[] = assessmentsQuery.data?.results ?? [];
    const outcomes: CandidateOutcome[] = outcomesQuery.data?.results ?? [];

    const assessmentMap = new Map<number, CandidateAssessment>(assessments.map((a) => [a.candidate, a]));
    const outcomeMap = new Map<number, CandidateOutcome>(outcomes.map((o) => [o.candidate, o]));

    return rawCandidates.map((c: GradingCandidate) => {
      const assessment = assessmentMap.get(c.id);
      const outcome = outcomeMap.get(c.id);

      return {
        candidate: c,
        assessment,
        outcome,
      };
    });
  }, [candidatesQuery.data, assessmentsQuery.data, outcomesQuery.data]);

  // The server's count (completed, outcome not finalised - see
  // with_session_progress), the same number Overview and Gradings show. A
  // decision can only be made once the session is locked, so the banner
  // waits for that.
  const awaitingDecisionCount =
    session?.status === "LOCKED" ? session.awaiting_decision_count : 0;

  // Filter candidates by search and status
  const filteredCandidates = useMemo(() => {
    return enrichedCandidates.filter((item) => {
      const name = (item.candidate.student_display_name || "").toLowerCase();
      const wksa = (item.candidate.student_wksa_id || "").toLowerCase();
      const q = search.trim().toLowerCase();
      const matchesSearch = !q || name.includes(q) || wksa.includes(q);

      const aStatus = item.assessment?.status || "NOT_STARTED";
      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "WITHDRAWN" && item.candidate.status === "WITHDRAWN") ||
        (item.candidate.status !== "WITHDRAWN" &&
          ((statusFilter === "NOT_STARTED" && aStatus === "NOT_STARTED") ||
            (statusFilter === "IN_PROGRESS" && aStatus === "IN_PROGRESS") ||
            (statusFilter === "COMPLETED" && aStatus === "COMPLETED")));

      return matchesSearch && matchesStatus;
    });
  }, [enrichedCandidates, search, statusFilter]);

  const unpreparedCandidateIds = enrichedCandidates
    .filter((item) => item.candidate.status !== "WITHDRAWN" && !item.assessment)
    .map((item) => item.candidate.id);
  const preparedAssessmentIds = enrichedCandidates
    .filter(
      (item) =>
        item.candidate.status !== "WITHDRAWN" && item.assessment?.status === "NOT_STARTED",
    )
    .map((item) => item.assessment!.id);
  // A no-show is a candidate who never started: the server refuses to
  // withdraw one whose assessment work has begun (that needs a locked-session
  // withdrawal), so only those are offered.
  const attendanceCandidates: AttendanceCandidate[] = enrichedCandidates
    .filter(
      (item) =>
        item.candidate.status === "REGISTERED" &&
        (!item.assessment || item.assessment.status === "NOT_STARTED"),
    )
    .map(toAttendanceCandidate);

  // Lifecycle stage statuses
  const lifecycle = useMemo(() => {
    const currentStatus = session?.status || "DRAFT";
    const stages = (["DRAFT", "OPEN", "LOCKED", "COMPLETED"] as const).map((key) => ({
      key,
      label: SESSION_STATUS_LABELS[key],
    }));

    const stageOrder = ["DRAFT", "OPEN", "LOCKED", "COMPLETED"];
    const currentIndex = stageOrder.indexOf(currentStatus);

    return stages.map((st, idx) => {
      let state: "completed" | "current" | "upcoming" = "upcoming";
      if (currentStatus === "CANCELLED") {
        state = "upcoming";
      } else if (currentIndex > idx) {
        state = "completed";
      } else if (currentIndex === idx) {
        state = "current";
      }
      return { ...st, state };
    });
  }, [session?.status]);

  // Loading & Error states
  if (isNaN(sessionId)) {
    return (
      <section aria-labelledby="gsd-invalid-id-heading" className="page gsd-page" data-testid="gsd-page">
        <div className="gsd-error-state">
          <h2 id="gsd-invalid-id-heading">Grading session not found</h2>
          <p>Please return to the sessions list.</p>
          <Link to="/gradings" className={buttonClass({ variant: "primary" })}>Back to Gradings</Link>
        </div>
      </section>
    );
  }

  if (sessionQuery.isLoading) {
    return (
      <section aria-label="Grading session" className="page gsd-page" data-testid="gsd-page">
        <div className="gsd-loading-state" role="status">
          <div className="gsd-spinner" aria-hidden="true" />
          <p>Loading grading session...</p>
        </div>
      </section>
    );
  }

  if (sessionQuery.isError || !session) {
    return (
      <section aria-labelledby="gsd-error-heading" className="page gsd-page" data-testid="gsd-page">
        <div className="gsd-error-state">
          <h2 id="gsd-error-heading">Failed to load grading session</h2>
          <p>{sessionQuery.error instanceof Error ? sessionQuery.error.message : "Session not found."}</p>
          <Link to="/gradings" className={buttonClass({ variant: "primary" })}>Back to Gradings</Link>
        </div>
      </section>
    );
  }

  const handleActionClick = (actionType: "LOCK" | "COMPLETE" | "CANCEL" | "DELETE" | "OPEN") => {
    setActionsMenuOpen(false);
    setActionError(null);
    // The dropdown (and the menu item just clicked) unmounts in the same
    // render as the confirm modal mounting, so useDialogFocus would capture
    // document.body as "previously focused" unless focus is moved onto the
    // still-mounted trigger button before that happens.
    actionsButtonRef.current?.focus();

    if (actionType === "DELETE") {
      const erasesFinalisedData = session.status === "LOCKED" || session.status === "COMPLETED";
      setConfirmModal({
        open: true,
        title: "Delete Grading Session",
        message: erasesFinalisedData
          ? "Are you sure you want to permanently delete this grading session? This erases every finalised outcome and promotion recorded in it, reverting any promoted student's rank. This action cannot be undone."
          : "Are you sure you want to permanently delete this grading session? This action cannot be undone.",
        actionType: "DELETE",
      });
    } else if (actionType === "CANCEL") {
      setConfirmModal({
        open: true,
        title: "Cancel Grading Session",
        message: "Are you sure you want to cancel this grading session?",
        actionType: "CANCEL",
      });
    } else if (actionType === "LOCK") {
      setConfirmModal({
        open: true,
        title: "Lock Grading Session",
        message: "Locking ends grading. Every assessment must be completed first, and after locking no result can be changed or reopened.",
        actionType: "LOCK",
      });
    } else if (actionType === "COMPLETE") {
      setConfirmModal({
        open: true,
        title: "Complete Grading Session",
        message: "Completing this session finalises all grading results and records. Ensure all candidate decisions have been made.",
        actionType: "COMPLETE",
      });
    } else if (actionType === "OPEN") {
      const registered = enrichedCandidates.filter(
        (item) => item.candidate.status !== "WITHDRAWN",
      ).length;
      setConfirmModal({
        open: true,
        title: "Open Grading Session",
        message: `Opening starts the grading and cannot be undone: an open session does not go back to draft. ${
          registered === 0
            ? "No candidates are registered."
            : `${registered} candidate${registered === 1 ? " is" : "s are"} registered.`
        } Check the roster first. Once open, a candidate who already has an assessment can no longer be moved or removed; one who cannot attend can still be marked as a no-show.`,
        actionType: "OPEN",
      });
    }
  };

  const handleConfirmModalAction = () => {
    if (!confirmModal) return;

    if (confirmModal.actionType === "DELETE") {
      deleteSessionMutation.mutate();
    } else if (confirmModal.actionType === "CANCEL") {
      updateSessionMutation.mutate({
        status: "CANCELLED",
        cancellation_reason: cancellationReason,
      });
    } else if (confirmModal.actionType === "OPEN") {
      updateSessionMutation.mutate({ status: "OPEN" });
    } else if (confirmModal.actionType === "LOCK") {
      updateSessionMutation.mutate({ status: "LOCKED" });
    } else if (confirmModal.actionType === "COMPLETE") {
      updateSessionMutation.mutate({ status: "COMPLETED" });
    }
  };

  const handleSaveNotes = (e: React.FormEvent) => {
    e.preventDefault();
    updateSessionMutation.mutate({ notes: notesInput });
  };

  // What a candidate's row offers next, from where their assessment and outcome stand.
  const nextActionFor = (item: EnrichedCandidate) => {
    const candidateId = item.candidate.id;
    const assessmentStatus = item.assessment?.status;
    const outcomeStatus = item.outcome?.status;
    const decisionsUrl = `/gradings/${session.id}/decisions?candidate=${candidateId}`;
    let label = assessmentStatus ? "Start assessment →" : "Prepare assessment →";
    let url = `/gradings/${session.id}/assessments/${candidateId}`;
    let opensProposalDrawer = false;

    if (assessmentStatus === "IN_PROGRESS") {
      label = "Continue assessment →";
    } else if (assessmentStatus === "COMPLETED") {
      if (outcomeStatus === "FINALISED") {
        if (item.outcome?.final_outcome === "PASS") {
          label = "Promotion ledger →";
          url = `/gradings/${session.id}/promotions`;
        } else {
          label = "View record →";
          url = decisionsUrl;
        }
      } else if (outcomeStatus === "PROPOSED") {
        if (currentUser?.can_make_final_grading_decision) {
          label = "Review decision →";
          url = decisionsUrl;
        } else {
          label = "Review proposal →";
          opensProposalDrawer = true;
        }
      } else if (session.status === "LOCKED") {
        label = "Propose outcome →";
        opensProposalDrawer = true;
      } else {
        // An outcome can only be created once the session is locked; until then
        // the record can still be reopened from its review page.
        label = "View record →";
        url = `/gradings/${session.id}/assessments/${candidateId}/review`;
      }
    }
    return { label, url, opensProposalDrawer };
  };

  return (
    <section aria-labelledby="gsd-title" className="page gsd-page" data-testid="gsd-page">
      {/* ── Breadcrumbs ─────────────────────────────────────────────────── */}
      <nav className="crumbs" aria-label="Breadcrumbs">
        <Link to="/gradings" className="gsd-breadcrumb-link">Gradings</Link>
        <span className="gsd-breadcrumb-sep" aria-hidden="true">/</span>
        <span className="gsd-breadcrumb-current">{session.title}</span>
      </nav>

      {/* ── Action Error Banner ─────────────────────────────────────────── */}
      {actionError && (
        <div className="gsd-error-banner" role="alert">
          <span>⚠️ {actionError}</span>
          <button
            type="button"
            className="gsd-error-dismiss-btn"
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
      {actionMessage && (
        <div className="gsd-action-banner" role="status">
          <span>{actionMessage}</span>
          <Button
            variant="ghost"
            onClick={() => setActionMessage(null)}
            aria-label="Dismiss status message"
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="action-row gsd-header">
        <div className="gsd-header-left">
          <div className="gsd-title-row">
            <h1 className="gsd-title" id="gsd-title">{session.title}</h1>
            <SessionStatusBadge status={session.status} label={session.status_display} />
          </div>
          <p className="gsd-meta-row">
            <span>{formatSessionDate(session.grading_date)}</span>
            <span className="gsd-meta-sep" aria-hidden="true">·</span>
            <span>{session.location || "No location specified"}</span>
          </p>
        </div>

        <div className="action-row gsd-header-actions">
          {(session.status === "LOCKED" || session.status === "COMPLETED") && (
            <Link
              to={`/gradings/${session.id}/decisions`}
              className={buttonClass({ variant: "secondary" })}
              data-testid="gsd-final-decisions-btn"
            >
              Final decisions →
            </Link>
          )}
          {(session.status === "LOCKED" || session.status === "COMPLETED") && (
            <Link
              to={`/gradings/${session.id}/promotions`}
              className={buttonClass({ variant: "secondary" })}
              data-testid="gsd-promotion-ledger-btn"
            >
              Promotion ledger →
            </Link>
          )}

          {/* Actions Dropdown */}
          <div className="gsd-dropdown-wrap" ref={actionsMenuRef} data-clip-ok>
            <Button
              ref={actionsButtonRef}
              variant="ghost" className="gsd-actions-btn"
              onClick={() => setActionsMenuOpen((prev) => !prev)}
              aria-expanded={actionsMenuOpen}
              aria-haspopup="menu"
              data-testid="gsd-actions-btn"
            >
              Session actions <span className="gsd-chevron-down" aria-hidden="true">⌵</span>
            </Button>

            {actionsMenuOpen && (
              <div className="gsd-dropdown-menu" role="menu">
                {session.status === "DRAFT" && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="gsd-dropdown-item"
                      onClick={() => handleActionClick("OPEN")}
                    >
                      Open session
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="gsd-dropdown-item gsd-danger-text"
                      onClick={() => handleActionClick("CANCEL")}
                    >
                      Cancel session
                    </button>
                  </>
                )}

                {session.status === "OPEN" && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="gsd-dropdown-item"
                      onClick={() => handleActionClick("LOCK")}
                    >
                      Lock session
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="gsd-dropdown-item gsd-danger-text"
                      onClick={() => handleActionClick("CANCEL")}
                    >
                      Cancel session
                    </button>
                  </>
                )}

                {session.status === "LOCKED" && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="gsd-dropdown-item"
                      onClick={() => handleActionClick("COMPLETE")}
                    >
                      Complete session
                    </button>
                    {currentUser?.can_override_locked_session && (
                      <button
                        type="button"
                        role="menuitem"
                        className="gsd-dropdown-item gsd-danger-text"
                        onClick={() => handleActionClick("CANCEL")}
                      >
                        Cancel session
                      </button>
                    )}
                  </>
                )}

                {currentUser?.can_read_audit_log && (
                  <Link
                    to={`/audit?entity_type=GradingSession&entity_id=${session.id}`}
                    role="menuitem"
                    className="gsd-dropdown-item"
                    onClick={() => setActionsMenuOpen(false)}
                  >
                    View audit events
                  </Link>
                )}

                {/* The server decides, for this user, by the delete's own rule. */}
                {session.can_be_deleted && (
                  <button
                    type="button"
                    role="menuitem"
                    className="gsd-dropdown-item gsd-danger-text"
                    onClick={() => handleActionClick("DELETE")}
                  >
                    Delete session
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Add candidate button */}
          {(session.status === "DRAFT" || session.status === "OPEN") && (
            <Link
              to={`/gradings/${session.id}/register`}
              className={buttonClass({ variant: "primary" })}
              data-testid="gsd-add-candidate-btn"
            >
              Add candidate <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>
      </header>

      {/* ── Lifecycle Progression Track ─────────────────────────────────── */}
      <section className="gsd-lifecycle-section" aria-label="Session progress">
        <div className="gsd-lifecycle-track">
          {lifecycle.map((step) => (
            <div key={step.key} className={`gsd-lifecycle-step gsd-step-${step.state}`}>
              <div className="gsd-step-circle" aria-hidden="true">
                {step.state === "completed" && "✓"}
              </div>
              <div className="gsd-step-content">
                <span className="gsd-step-label">{step.label}</span>
                <span className="gsd-step-subtext">
                  {step.state === "completed"
                    ? "Completed"
                    : step.state === "current"
                    ? "Current"
                    : "Upcoming"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Operational Action Banner ───────────────────────────────────── */}
      {awaitingDecisionCount > 0 && (
        <section className="action-row gsd-action-banner" role="status" aria-label="Action required">
          <div className="gsd-banner-left">
            <span className="gsd-banner-icon" aria-hidden="true">!</span>
            <span className="gsd-banner-text">
              {awaitingDecisionCount} candidate{awaitingDecisionCount === 1 ? "" : "s"} awaiting final decision
            </span>
          </div>
          <Link
            to={`/gradings/${session.id}/decisions`}
            className={buttonClass({ variant: "ghost" }, "gsd-banner-btn")}
            data-testid="gsd-review-decisions-btn"
          >
            Review <span aria-hidden="true">→</span>
          </Link>
        </section>
      )}

      {/* ── Candidates Section ──────────────────────────────────────────── */}
      <section className="gsd-candidates-section" aria-labelledby="candidates-heading">
        <div className="action-row gsd-section-header">
          <h2 id="candidates-heading" className="gsd-section-title">
            Candidates
          </h2>

          <div className="action-row gsd-controls-row">
            {(session.status === "DRAFT" || session.status === "OPEN") &&
              attendanceCandidates.length > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setActionError(null);
                    setAttendanceDialogOpen(true);
                  }}
                >
                  Confirm attendance
                </Button>
              )}
            {(session.status === "DRAFT" || session.status === "OPEN") &&
              unpreparedCandidateIds.length > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => bulkPrepareMutation.mutate(unpreparedCandidateIds)}
                  disabled={bulkPrepareMutation.isPending}
                >
                  {bulkPrepareMutation.isPending
                    ? "Preparing…"
                    : `Prepare all (${unpreparedCandidateIds.length})`}
                </Button>
              )}
            {session.status === "OPEN" && preparedAssessmentIds.length > 0 && (
              <Button
                variant="primary"
                onClick={() => bulkStartMutation.mutate(preparedAssessmentIds)}
                disabled={bulkStartMutation.isPending}
              >
                {bulkStartMutation.isPending
                  ? "Starting…"
                  : `Start all prepared (${preparedAssessmentIds.length})`}
              </Button>
            )}
            {/* Search Input */}
            <div className="gsd-search-wrap">
              <span className="gsd-search-icon" aria-hidden="true">🔍</span>
              <input
                type="search"
                className="gsd-search-input"
                placeholder="Search candidate..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search candidates by name or WKSA ID"
                data-testid="gsd-candidate-search"
              />
            </div>

            {/* Assessment status filter */}
            <div className="gsd-filter-wrap">
              <select
                className="gsd-filter-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by assessment status"
                data-testid="gsd-status-filter"
              >
                <option value="ALL">Assessment status</option>
                <option value="NOT_STARTED">Not started</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="WITHDRAWN">Withdrawn</option>
              </select>
            </div>

            <div className="gsd-count-chip">
              {filteredCandidates.length} candidate{filteredCandidates.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        {/* Candidate Roster Table */}
        <div>
          {enrichedCandidates.length === 0 ? (
            <div className="gsd-empty-roster" data-testid="gsd-empty-roster">
              <p className="gsd-empty-title">No candidates registered in this grading session yet.</p>
              <p className="gsd-empty-sub">Add students to begin curriculum assessment and outcome tracking.</p>
              <Link
                to={`/gradings/${session.id}/register`}
                className={buttonClass({ variant: "primary" })}
              >
                Add candidate <span aria-hidden="true">→</span>
              </Link>
            </div>
          ) : filteredCandidates.length === 0 ? (
            <div className="gsd-empty-search" data-testid="gsd-empty-search">
              <p>No candidates match the search or filter criteria.</p>
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("ALL");
                }}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <ResponsiveTable
              label="Candidates"
              testId="gsd-candidates-table"
              rows={filteredCandidates}
              rowKey={(item) => item.candidate.id}
              rowTestId={(item) => `candidate-row-${item.candidate.id}`}
              columns={[
                {
                  key: "candidate",
                  header: "Candidate",
                  primary: true,
                  render: (item) => (
                    <>
                      <span className="gsd-candidate-name">{item.candidate.student_display_name}</span>
                      {item.candidate.student_wksa_id && (
                        <span className="gsd-candidate-wksa">WKSA: {item.candidate.student_wksa_id}</span>
                      )}
                    </>
                  ),
                },
                {
                  key: "from",
                  header: "Current rank",
                  render: (item) => (
                    <div className="gsd-rank-item">
                      <RankBelt rankId={item.candidate.from_rank} />
                      {/* The rank held at registration, not the live current rank. */}
                      <span>{item.candidate.from_rank_name}</span>
                    </div>
                  ),
                },
                {
                  key: "to",
                  header: "Grading for",
                  render: (item) => (
                    <div className="gsd-rank-item">
                      <RankBelt rankId={item.candidate.testing_for_rank} />
                      <span>{item.candidate.testing_for_rank_name}</span>
                    </div>
                  ),
                },
                {
                  key: "assessment",
                  header: "Assessment",
                  render: (item) =>
                    item.candidate.status === "WITHDRAWN" ? (
                      <>
                        <Badge tone="neutral">Withdrawn</Badge>
                        <span className="gsd-withdrawal-record">
                          {item.candidate.withdrawal_reason_display && (
                            <span>{item.candidate.withdrawal_reason_display}</span>
                          )}
                          {item.candidate.withdrawal_note && <span>{item.candidate.withdrawal_note}</span>}
                        </span>
                      </>
                    ) : (
                      <AssessmentBadge assessment={item.assessment} />
                    ),
                },
                {
                  key: "outcome",
                  header: "Outcome",
                  render: (item) =>
                    item.candidate.status === "WITHDRAWN" ? (
                      <Badge tone="neutral">No outcome</Badge>
                    ) : (
                      <OutcomeBadge outcome={item.outcome} />
                    ),
                },
                {
                  key: "action",
                  header: "Next action",
                  actions: true,
                  render: (item) => {
                    const candidateId = item.candidate.id;
                    const outcomeStatus = item.outcome?.status;
                    const isWithdrawn = item.candidate.status === "WITHDRAWN";
                    const canWithdrawLocked =
                      session.status === "LOCKED" &&
                      Boolean(currentUser?.can_override_locked_session) &&
                      !isWithdrawn &&
                      outcomeStatus !== "FINALISED";
                    const next = nextActionFor(item);
                    return (
                      <div className="gsd-row-actions">
                        {isWithdrawn ? (
                          <span className="gsd-withdrawal-record">No further action</span>
                        ) : next.opensProposalDrawer ? (
                          <Button
                            variant="ghost" className="gsd-row-action-btn"
                            onClick={() => setProposalDrawerItem(item)}
                            data-testid={`propose-outcome-btn-${candidateId}`}
                          >
                            {next.label}
                          </Button>
                        ) : (
                          <Link to={next.url} className={buttonClass({ variant: "ghost" }, "gsd-row-action-btn")}>
                            {next.label}
                          </Link>
                        )}
                        {item.candidate.can_be_moved && (
                          <Button
                            variant="ghost" className="gsd-row-action-btn"
                            onClick={() => setRegistrationAction({ kind: "move", item })}
                            aria-label={`Move ${item.candidate.student_display_name} to another session`}
                          >
                            Move…
                          </Button>
                        )}
                        {item.candidate.can_be_removed && (
                          <Button
                            variant="ghost" className="gsd-row-action-btn gsd-withdraw-button"
                            onClick={() => setRegistrationAction({ kind: "remove", item })}
                            aria-label={`Remove ${item.candidate.student_display_name}'s registration`}
                          >
                            Remove
                          </Button>
                        )}
                        {canWithdrawLocked && (
                          <Button
                            variant="ghost" className="gsd-row-action-btn gsd-withdraw-button"
                            onClick={() => {
                              setWithdrawalError(null);
                              setWithdrawalCandidate(item);
                            }}
                          >
                            Withdraw candidate
                          </Button>
                        )}
                      </div>
                    );
                  },
                },
              ]}
            />
          )}
        </div>
      </section>

      {/* ── Session Notes Section ───────────────────────────────────────── */}
      <section className="gsd-notes-section" aria-labelledby="notes-heading">
        <div className="gsd-notes-card">
          <div className="action-row gsd-notes-header">
            <div>
              <h2 id="notes-heading" className="gsd-notes-title">Session notes</h2>
              <p className="gsd-notes-sub">
                Notes are only visible to authorised instructors for this session.
              </p>
            </div>
            {!isEditingNotes && (
              <Button
                variant="ghost" className="gsd-edit-notes-btn"
                onClick={() => {
                  setIsEditingNotes(true);
                  setNotesInput(session.notes || "");
                }}
                data-testid="gsd-edit-notes-btn"
              >
                <span aria-hidden="true">📝</span> {session.notes ? "Edit notes" : "Add note"}
              </Button>
            )}
          </div>

          <div className="gsd-notes-body">
            {isEditingNotes ? (
              <form onSubmit={handleSaveNotes} className="gsd-notes-form">
                <textarea
                  className="gsd-notes-textarea"
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  placeholder="Enter notes, observations, or logistics for this grading session..."
                  rows={4}
                  data-testid="gsd-notes-textarea"
                />
                <div className="action-row gsd-notes-actions">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={updateSessionMutation.isPending}
                    data-testid="gsd-save-notes-btn"
                  >
                    {updateSessionMutation.isPending ? "Saving..." : "Save notes"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setIsEditingNotes(false);
                      setNotesInput(session.notes || "");
                    }}
                    disabled={updateSessionMutation.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="gsd-notes-display">
                {session.notes ? (
                  <p className="gsd-notes-text">{session.notes}</p>
                ) : (
                  <p className="gsd-notes-empty">No notes recorded for this session.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Confirmation Modal ──────────────────────────────────────────── */}
      {confirmModal && (
        <div
          className="gsd-modal-backdrop gsd-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isConfirmModalMutationPending) {
              setConfirmModal(null);
            }
          }}
        >
          <div
            ref={confirmModalDialogRef}
            className="gsd-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gsd-confirm-modal-title"
            tabIndex={-1}
            data-testid="gsd-confirm-modal"
          >
            <h2 id="gsd-confirm-modal-title" className="gsd-modal-title">
              {confirmModal.title}
            </h2>
            <p className="gsd-modal-message">{confirmModal.message}</p>

            {confirmModal.actionType === "CANCEL" && (
              <div className="gsd-modal-field gsd-cancel-reason-field">
                <label htmlFor="cancellation-reason" className="gsd-field-label">
                  {/* Abandoning a locked session must say why (server rule). */}
                  {cancelReasonRequired ? "Cancellation reason (required)" : "Cancellation reason (optional)"}
                </label>
                <textarea
                  id="cancellation-reason"
                  className="gsd-modal-textarea gsd-textarea"
                  rows={3}
                  value={cancellationReason}
                  onChange={(e) => setCancellationReason(e.target.value)}
                  placeholder="Explain why the session is being cancelled…"
                />
              </div>
            )}

            <div className="gsd-modal-actions">
              <Button
                variant={confirmModal.actionType === "CANCEL" || confirmModal.actionType === "DELETE" ? "danger" : "primary"}
                onClick={handleConfirmModalAction}
                disabled={
                  isConfirmModalMutationPending ||
                  (confirmModal.actionType === "CANCEL" &&
                    cancelReasonRequired &&
                    !cancellationReason.trim())
                }
                data-testid="gsd-modal-confirm-btn"
              >
                {confirmModal.actionType === "DELETE"
                  ? deleteSessionMutation.isPending
                    ? "Deleting…"
                    : "Delete session"
                  : "Confirm"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setConfirmModal(null)}
                disabled={isConfirmModalMutationPending}
                data-dialog-autofocus
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {attendanceDialogOpen && (
        <NoShowDialog
          candidates={attendanceCandidates}
          pending={attendanceMutation.isPending}
          error={actionError}
          onClose={() => {
            setAttendanceDialogOpen(false);
            setActionError(null);
          }}
          onConfirm={(candidateIds) => attendanceMutation.mutate(candidateIds)}
        />
      )}

      {withdrawalCandidate && (
        <LockedWithdrawalDialog
          candidate={toAttendanceCandidate(withdrawalCandidate)}
          reasons={withdrawalReasonsQuery.data?.results ?? []}
          pending={withdrawalMutation.isPending}
          error={withdrawalError}
          onClose={() => {
            setWithdrawalCandidate(null);
            setWithdrawalError(null);
          }}
          onConfirm={(payload) =>
            withdrawalMutation.mutate({
              candidateId: withdrawalCandidate.candidate.id,
              payload,
            })
          }
        />
      )}

      {registrationAction?.kind === "move" && (
        <MoveRegistrationDialog
          candidate={toAttendanceCandidate(registrationAction.item)}
          sessions={moveTargets}
          pending={registrationMutation.isPending}
          error={registrationError}
          onClose={closeRegistrationAction}
          onConfirm={(targetSessionId) =>
            registrationMutation.mutate({
              kind: "move",
              candidateId: registrationAction.item.candidate.id,
              targetSessionId,
            })
          }
        />
      )}

      {registrationAction?.kind === "remove" && (
        <RemoveRegistrationDialog
          candidate={toAttendanceCandidate(registrationAction.item)}
          pending={registrationMutation.isPending}
          error={registrationError}
          onClose={closeRegistrationAction}
          onConfirm={() =>
            registrationMutation.mutate({
              kind: "remove",
              candidateId: registrationAction.item.candidate.id,
            })
          }
        />
      )}

      {/* ── Instructor Outcome Proposal Drawer ────────────────────── */}
      {proposalDrawerItem && session && (
        <OutcomeProposalDrawer
          key={proposalDrawerItem.candidate.id}
          candidate={proposalDrawerItem.candidate}
          assessment={proposalDrawerItem.assessment}
          existingOutcome={proposalDrawerItem.outcome}
          onClose={() => setProposalDrawerItem(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["gradingCandidates", sessionId] });
            queryClient.invalidateQueries({ queryKey: ["candidateOutcomes", sessionId] });
            queryClient.invalidateQueries({ queryKey: ["candidateAssessments", sessionId] });
            setProposalDrawerItem(null);
          }}
        />
      )}

    </section>
  );
}
