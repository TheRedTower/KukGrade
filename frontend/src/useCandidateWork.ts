import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  bulkGenerateCandidateAssessments,
  bulkStartCandidateAssessments,
  bulkUpdateCandidateStatus,
  deleteGradingCandidate,
  errorMessage,
  getAllGradingSessions,
  getWithdrawalReasons,
  moveGradingCandidate,
  withdrawLockedCandidate,
} from "./api";
import { formatSessionDate } from "./dates";
import { keys, refresh } from "./queryKeys";
import type { EnrichedCandidate } from "./SessionParts";

interface Feedback {
  setError: (message: string | null) => void;
  setMessage: (message: string | null) => void;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Everything a session page does to its candidates: prepare and start assessments in
 * bulk, mark no-shows, withdraw one from a locked session, move or remove a
 * registration, and the open dialog for each. Results go to `feedback`.
 */
export function useCandidateWork(sessionId: number, { setError, setMessage }: Feedback) {
  const queryClient = useQueryClient();
  const refreshCandidateWork = () => refresh.sessionWork(queryClient, sessionId);

  /** The message after a bulk action: how many worked, and the server's reasons for the rest. */
  const reportBulk = (count: number, noun: string, verb: string, errors: Record<string, string[]>) => {
    const failed = Object.keys(errors).length;
    setMessage(`${plural(count, noun)} ${verb}${failed ? `; ${failed} could not be ${verb}` : ""}.`);
    setError(failed ? Object.values(errors).flat().join(" ") : null);
  };

  const bulkPrepare = useMutation({
    mutationFn: (candidateIds: number[]) => bulkGenerateCandidateAssessments(candidateIds),
    onSuccess: ({ created, errors }) => {
      refreshCandidateWork();
      reportBulk(created.length, "assessment", "prepared", errors);
    },
    onError: (err: unknown) => setError(errorMessage(err, "Failed to prepare assessments.")),
  });

  const bulkStart = useMutation({
    mutationFn: (assessmentIds: number[]) => bulkStartCandidateAssessments(assessmentIds),
    onSuccess: ({ started, errors }) => {
      refreshCandidateWork();
      reportBulk(started.length, "assessment", "started", errors);
    },
    onError: (err: unknown) => setError(errorMessage(err, "Failed to start assessments.")),
  });

  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const attendance = useMutation({
    mutationFn: (candidateIds: number[]) =>
      // A no-show is by definition "did not attend".
      bulkUpdateCandidateStatus({ candidates: candidateIds, status: "WITHDRAWN", withdrawal_reason: "ABSENT" }),
    onSuccess: ({ updated, errors }) => {
      refreshCandidateWork();
      setAttendanceOpen(false);
      const failed = Object.keys(errors).length;
      setMessage(`${plural(updated.length, "candidate")} marked as no-show${failed ? `; ${failed} could not be updated` : ""}.`);
      setError(failed ? Object.values(errors).flat().join(" ") : null);
    },
    onError: (err: unknown) => setError(errorMessage(err, "Failed to confirm attendance.")),
  });

  const [withdrawing, setWithdrawing] = useState<EnrichedCandidate | null>(null);
  const [withdrawalError, setWithdrawalError] = useState<string | null>(null);
  const withdrawal = useMutation({
    mutationFn: ({ candidateId, payload }: { candidateId: number; payload: Parameters<typeof withdrawLockedCandidate>[1] }) =>
      withdrawLockedCandidate(candidateId, payload),
    onSuccess: (updated) => {
      refreshCandidateWork();
      setWithdrawing(null);
      setWithdrawalError(null);
      setError(null);
      setMessage(`${updated.student_display_name} was withdrawn from the locked session.`);
    },
    onError: (err: unknown) => setWithdrawalError(errorMessage(err, "Failed to withdraw the candidate.")),
  });
  const withdrawalReasons = useQuery({
    queryKey: keys.withdrawalReasons(),
    queryFn: getWithdrawalReasons,
    enabled: withdrawing !== null,
  });

  const [registrationAction, setRegistrationAction] = useState<{ kind: "move" | "remove"; item: EnrichedCandidate } | null>(null);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const closeRegistrationAction = () => {
    setRegistrationAction(null);
    setRegistrationError(null);
  };
  // Sessions a registration can move to; loaded only when the move dialog opens.
  const moveTargetsQuery = useQuery({
    queryKey: keys.gradingSessions.moveTargets(),
    queryFn: () => getAllGradingSessions({ roster_open: true }),
    enabled: registrationAction?.kind === "move",
  });
  const moveTargets = (moveTargetsQuery.data?.results ?? [])
    .filter((target) => target.id !== sessionId)
    .map((target) => ({ id: target.id, label: `${target.title} · ${formatSessionDate(target.grading_date)}` }));
  const registration = useMutation({
    mutationFn: async ({ kind, candidateId, targetSessionId }: { kind: "move" | "remove"; candidateId: number; targetSessionId?: number }) => {
      if (kind === "move") await moveGradingCandidate(candidateId, targetSessionId as number);
      else await deleteGradingCandidate(candidateId);
    },
    onSuccess: (_result, { kind }) => {
      const name = registrationAction?.item.candidate.student_display_name ?? "The candidate";
      refreshCandidateWork();
      void queryClient.invalidateQueries({ queryKey: keys.gradingCandidates.all() });
      closeRegistrationAction();
      setError(null);
      setMessage(kind === "move" ? `${name} was moved to another session.` : `${name} was removed from this session.`);
    },
    onError: (err: unknown) => setRegistrationError(errorMessage(err, "Failed to change the registration.")),
  });

  const [proposing, setProposing] = useState<EnrichedCandidate | null>(null);

  return {
    refreshCandidateWork,
    bulkPrepare,
    bulkStart,
    attendance: { open: attendanceOpen, setOpen: setAttendanceOpen, mutation: attendance },
    withdrawal: {
      candidate: withdrawing,
      error: withdrawalError,
      reasons: withdrawalReasons.data?.results ?? [],
      mutation: withdrawal,
      begin: (item: EnrichedCandidate) => {
        setWithdrawalError(null);
        setWithdrawing(item);
      },
      close: () => {
        setWithdrawing(null);
        setWithdrawalError(null);
      },
    },
    registration: {
      action: registrationAction,
      error: registrationError,
      targets: moveTargets,
      mutation: registration,
      begin: (kind: "move" | "remove", item: EnrichedCandidate) => setRegistrationAction({ kind, item }),
      close: closeRegistrationAction,
    },
    proposal: { item: proposing, begin: setProposing, close: () => setProposing(null) },
  };
}
