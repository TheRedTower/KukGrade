import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  type BulkCandidateRegistrationPayload,
  type BulkCandidateRegistrationResponse,
  type GradingSession,
  type Rank,
  type StudentListItem,
  bulkRegisterCandidates,
  errorMessage,
} from "./api";
import type { CohortItem } from "./cohortBuilder";
import type { FlaggedCandidateItem } from "./CohortResolver";
import { keys } from "./queryKeys";

interface Options {
  sessionId: number;
  session: GradingSession | undefined;
  cohort: CohortItem[];
  setCohort: (update: (cohort: CohortItem[]) => CohortItem[]) => void;
  generateAssessments: boolean;
}

/**
 * Registering a cohort for a session: the first request for everyone, then retries of
 * the ones the server flagged. Everything registered takes the user on to the session;
 * anything left is listed for the Exception Resolver (`resolving`).
 */
export function useCohortRegistration({ sessionId, session, cohort, setCohort, generateAssessments }: Options) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [registrationResult, setRegistrationResult] = useState<BulkCandidateRegistrationResponse | null>(null);
  const [flaggedItems, setFlaggedItems] = useState<FlaggedCandidateItem[]>([]);

  // One registration request: the first for the whole cohort, or a retry of the
  // flagged ones. `rows` are the people sent, in order: the server names a
  // failure by its position in them.
  const mutation = useMutation({
    mutationFn: (request: {
      payload: BulkCandidateRegistrationPayload;
      rows: { student: StudentListItem; destinationRank: Rank | null }[];
      retry: boolean;
    }) => bulkRegisterCandidates(request.payload),
    onSuccess: (response, request) => {
      // The cache must reflect the newly registered candidates.
      queryClient.invalidateQueries({ queryKey: keys.gradingCandidates.session(sessionId) });
      queryClient.invalidateQueries({ queryKey: keys.students.eligible() });
      queryClient.invalidateQueries({ queryKey: keys.gradingSessions.detail(sessionId) });

      const errorKeys = Object.keys(response.errors);
      // A retry sends only the retryable rows, so the others stay as they are.
      const unsent = request.retry ? flaggedItems.filter((item) => item.registered) : [];
      if (errorKeys.length === 0 && unsent.length === 0) {
        // Everything registered: on to the grading session.
        navigate(`/gradings/${sessionId}`);
        return;
      }
      // Partial success or errors: the Exception Resolver lists what is left.
      setRegistrationResult((previous) =>
        request.retry && previous ? { ...response, created: [...previous.created, ...response.created] } : response,
      );
      const flagged = errorKeys.map((idxStr) => {
        const row = request.rows[Number(idxStr)];
        const errorMsg = (response.errors[idxStr] || []).join(", ");
        return {
          key: row ? String(row.student.id) : idxStr,
          student: row?.student,
          destinationRank: row?.destinationRank ?? null,
          error: errorMsg || "Registration failed",
          registered: response.already_registered[idxStr],
        };
      });
      setFlaggedItems([...unsent, ...flagged]);
    },
    onError: (err) => setSubmitError(errorMessage(err, "Failed to register grading candidates.")),
  });

  const send = (items: { student: StudentListItem; destinationRank: Rank | null }[], retry: boolean) => {
    if (items.length === 0 || !session) return;
    setSubmitError(null);
    mutation.mutate({
      payload: {
        session: session.id,
        candidates: items.map((item) => ({ student: item.student.id, testing_for_rank: item.destinationRank?.id })),
        generate_assessments: generateAssessments,
      },
      rows: items.map((item) => ({ student: item.student, destinationRank: item.destinationRank })),
      retry,
    });
  };

  return {
    submitError,
    clearError: () => setSubmitError(null),
    isSubmitting: mutation.isPending,
    registrationResult,
    flaggedItems,
    resolving: registrationResult !== null && flaggedItems.length > 0,
    submit: () => send(cohort, false),
    retry: () => send(flaggedItems.filter((item) => !item.registered).map((item) => ({ student: item.student, destinationRank: item.destinationRank })), true),
    removeFlagged: (key: string) => {
      const removed = flaggedItems.find((item) => item.key === key);
      const remaining = flaggedItems.filter((item) => item.key !== key);
      setFlaggedItems(remaining);
      setCohort((prev) => prev.filter((item) => item.student.id !== removed?.student?.id));
      if (remaining.length > 0) return;
      // Nothing left to resolve: on to the session, or back to a cohort that no longer has them.
      if (registrationResult?.created.length) navigate(`/gradings/${sessionId}`);
      else setRegistrationResult(null);
    },
  };
}
