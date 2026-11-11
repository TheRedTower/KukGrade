import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type CandidateOutcomeOutcome,
  type StagedDecision as ApiStagedDecision,
  discardStagedDecision,
  errorMessage,
  finaliseCandidateOutcome,
  getStagedDecisions,
  isAnonymousResponse,
  stageDecision,
} from "./api";
import { type BoardRow, type StagedDecision, fromServer, missingRequirements, without } from "./adjudicationBoard";
import { keys, refresh } from "./queryKeys";
import { agreeing, counted } from "./plural";
import { useDebouncedValue } from "./useDebouncedValue";

// How long typing settles before a staged decision is kept on the server.
const KEEP_DELAY_MS = 600;
// Stands for a row whose last save failed: no staged decision matches it.
const UNKNOWN = "";

interface Options {
  sessionId: number;
  /** The session id is usable. */
  enabled: boolean;
  /** The viewer may decide, and the session is locked. */
  canDecide: boolean;
  /** A row was staged: put it in focus. */
  onFocus: (candidateId: number) => void;
}

/**
 * The Master's staged decisions: staged on the board, kept on the server once typing
 * settles (so a timed-out session or a closed tab loses nothing), and recorded one
 * candidate at a time, each standing or failing on its own.
 */
export function useStagedDecisions({ sessionId, enabled, canDecide, onFocus }: Options) {
  const queryClient = useQueryClient();

  const [staged, setStaged] = useState<Record<number, StagedDecision>>({});
  const [isRecording, setIsRecording] = useState(false);
  const [failures, setFailures] = useState<Record<number, string>>({});
  const [lastResult, setLastResult] = useState<string | null>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  // What the server will hold for each staged row once the writes sent so
  // far land, so only changes are sent, and which write to each row is the
  // latest, so only its answer counts.
  const sent = useRef<Record<number, string> | null>(null);
  const writeSeq = useRef<Record<number, number>>({});
  const [restored, setRestored] = useState<ApiStagedDecision[] | null>(null);
  const [keepFailures, setKeepFailures] = useState<Record<number, string>>({});

  // Recording unmounts or disables the control that started it, so focus
  // moves to the outcome message rather than dropping to the page.
  useEffect(() => {
    if (lastResult) resultRef.current?.focus();
  }, [lastResult]);

  // Decisions staged earlier, and kept on the server, come back: a session
  // that timed out, or a closed tab, loses nothing that was staged.
  const keptQuery = useQuery({
    queryKey: keys.stagedDecisions(sessionId),
    queryFn: () => getStagedDecisions(sessionId),
    enabled: enabled && canDecide,
    // Read afresh each time the board opens: never an earlier visit's copy.
    gcTime: 0,
  });
  // Until they are read, nothing can be staged, so none is overwritten.
  if (restored === null && keptQuery.isSuccess && keptQuery.isFetchedAfterMount) {
    setRestored(keptQuery.data);
    setStaged((current) => ({ ...fromServer(keptQuery.data), ...current }));
  }
  const canStage = restored !== null && !isRecording;

  // Keeping and recording share one queue, so writes land in the order they
  // were made: a row's last edit is its last write, and a decision is
  // recorded only after every save before it has landed.
  const scope = { id: JSON.stringify(keys.stagedDecisions(sessionId)) };
  // Each write goes through the mutation cache, so an expired session signs the viewer out.
  const keepMutation = useMutation({
    scope,
    mutationFn: async ({ outcomeId, decision }: { outcomeId: number; decision: StagedDecision | null }) => {
      if (!decision) return discardStagedDecision(outcomeId);
      await stageDecision(outcomeId, {
        final_outcome: decision.outcome,
        decision_notes: decision.notes,
        conditional_requirements: decision.conditionalRequirements,
      });
    },
  });
  const keep = keepMutation.mutateAsync;

  // Every change to what is staged is kept once typing settles. Not while
  // recording (recording removes the server's copy itself), and not until the
  // settled value has caught up with what is staged now.
  const settled = useDebouncedValue(staged, KEEP_DELAY_MS);
  useEffect(() => {
    if (restored === null || isRecording || settled !== staged) return;
    sent.current ??= Object.fromEntries(
      Object.entries(fromServer(restored)).map(([outcomeId, decision]) => [outcomeId, JSON.stringify(decision)]),
    );
    const onServer = sent.current;
    new Set([...Object.keys(settled), ...Object.keys(onServer)].map(Number)).forEach((outcomeId) => {
      const decision = settled[outcomeId];
      const json = decision === undefined ? undefined : JSON.stringify(decision);
      if (json === onServer[outcomeId]) return;
      if (json === undefined) delete onServer[outcomeId];
      else onServer[outcomeId] = json;
      const seq = (writeSeq.current[outcomeId] ?? 0) + 1;
      writeSeq.current[outcomeId] = seq;
      const isLatest = () => writeSeq.current[outcomeId] === seq;
      keep({ outcomeId, decision: decision ?? null }).then(
        () => {
          if (isLatest()) setKeepFailures((current) => without(current, outcomeId));
        },
        (err: unknown) => {
          // A later change is queued behind this one and is kept instead.
          if (!isLatest()) return;
          // What the server holds is now unknown, so the next change is sent whatever it is.
          onServer[outcomeId] = UNKNOWN;
          setKeepFailures((current) => ({
            ...current,
            [outcomeId]: errorMessage(err, "Your staged decisions could not be kept."),
          }));
        },
      );
    });
  }, [settled, staged, restored, isRecording, keep]);

  function stage(row: BoardRow, outcome: CandidateOutcomeOutcome) {
    const outcomeId = row.outcome?.id;
    if (outcomeId === undefined) return;
    onFocus(row.candidate.id);
    setStaged((current) => {
      const next = { ...current };
      if (next[outcomeId]?.outcome === outcome) {
        delete next[outcomeId];
      } else {
        next[outcomeId] = {
          outcome,
          notes: next[outcomeId]?.notes ?? "",
          conditionalRequirements: next[outcomeId]?.conditionalRequirements ?? "",
        };
      }
      return next;
    });
  }

  function updateStaged(outcomeId: number, patch: Partial<StagedDecision>) {
    setStaged((current) =>
      current[outcomeId] ? { ...current, [outcomeId]: { ...current[outcomeId], ...patch } } : current,
    );
  }


  // Each write goes through the mutation cache, so a session that expired mid-way signs the viewer out.
  const finaliseMutation = useMutation({
    scope,
    mutationFn: (write: { outcomeId: number; payload: Parameters<typeof finaliseCandidateOutcome>[1] }) =>
      finaliseCandidateOutcome(write.outcomeId, write.payload),
  });

  async function record(outcomeIds: number[]) {
    if (outcomeIds.length === 0 || outcomeIds.some((oid) => missingRequirements(staged[oid]))) {
      return;
    }
    setIsRecording(true);
    setLastResult(null);
    const failed: Record<number, string> = {};
    const recorded = new Set<number>();
    // One candidate at a time: each row stands or falls on its own.
    for (const outcomeId of outcomeIds) {
      const decision = staged[outcomeId];
      try {
        await finaliseMutation.mutateAsync({
          outcomeId,
          payload: {
            final_outcome: decision.outcome,
            decision_notes: decision.notes.trim(),
            conditional_requirements:
              decision.outcome === "CONDITIONAL" ? decision.conditionalRequirements.trim() : "",
          },
        });
        recorded.add(outcomeId);
      } catch (err) {
        failed[outcomeId] = errorMessage(err, "The decision could not be recorded.");
        // The session has ended: the viewer is signed out, so the rest would only meet the same answer.
        if (isAnonymousResponse(err)) break;
      }
    }
    setStaged((current) => {
      const next = { ...current };
      recorded.forEach((oid) => delete next[oid]);
      return next;
    });
    // Recording removed the server's copies.
    recorded.forEach((oid) => delete sent.current?.[oid]);
    setKeepFailures((current) => [...recorded].reduce(without, current));
    setFailures((current) => {
      const next = { ...current };
      outcomeIds.forEach((oid) => delete next[oid]);
      return { ...next, ...failed };
    });
    // Rows the session's end stopped short of are still staged, like the failed ones.
    const kept = outcomeIds.length - recorded.size;
    setLastResult(
      kept === 0
        ? `${counted(recorded.size, "decision", "decisions")} recorded.`
        : `${recorded.size} recorded, ${kept} could not be recorded and ${agreeing(kept, "remains", "remain")} staged.`,
    );
    setIsRecording(false);
    // The roster carries each outcome, so recording reads it (and the lists that still hold outcomes) again.
    refresh.sessionWork(queryClient, sessionId);
  }

  const stagedIds = Object.keys(staged).map(Number);
  const incomplete = stagedIds.filter((outcomeId) => missingRequirements(staged[outcomeId]));
  const failedIds = Object.keys(failures).map(Number).filter((oid) => oid in staged);

  return {
    staged,
    stagedIds,
    incomplete,
    failures,
    failedIds,
    keepFailures,
    keptQuery,
    lastResult,
    resultRef,
    isRecording,
    canStage,
    stage,
    updateStaged,
    record,
  };
}
