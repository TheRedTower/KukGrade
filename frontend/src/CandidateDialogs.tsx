import {
  LockedWithdrawalDialog,
  MoveRegistrationDialog,
  NoShowDialog,
  RemoveRegistrationDialog,
} from "./GradingAttendanceDialogs";
import { OutcomeProposalDialog } from "./OutcomeProposalDialog";
import { type AttendanceCandidate, toAttendanceCandidate } from "./sessionDetail";
import type { useCandidateWork } from "./useCandidateWork";

interface CandidateDialogsProps {
  work: ReturnType<typeof useCandidateWork>;
  /** Who can be marked as a no-show. */
  attendanceCandidates: AttendanceCandidate[];
  /** The page's latest error, shown in the attendance dialog. */
  actionError: string | null;
  onAttendanceClose: () => void;
}

/** The dialog open for a candidate on the session page, if any. */
export function CandidateDialogs({
  work,
  attendanceCandidates,
  actionError,
  onAttendanceClose,
}: CandidateDialogsProps) {
  const { attendance, withdrawal, registration, proposal } = work;
  const moving = registration.action?.kind === "move" ? registration.action : null;
  const removing = registration.action?.kind === "remove" ? registration.action : null;

  return (
    <>
      {attendance.open && (
        <NoShowDialog
          candidates={attendanceCandidates}
          pending={attendance.mutation.isPending}
          error={actionError}
          onClose={onAttendanceClose}
          onConfirm={(candidateIds) => attendance.mutation.mutate(candidateIds)}
        />
      )}

      {withdrawal.candidate && (
        <LockedWithdrawalDialog
          candidate={toAttendanceCandidate(withdrawal.candidate)}
          reasons={withdrawal.reasons}
          pending={withdrawal.mutation.isPending}
          error={withdrawal.error}
          onClose={withdrawal.close}
          onConfirm={(payload) =>
            withdrawal.mutation.mutate({ candidateId: withdrawal.candidate!.candidate.id, payload })
          }
        />
      )}

      {moving && (
        <MoveRegistrationDialog
          candidate={toAttendanceCandidate(moving.item)}
          sessions={registration.targets}
          pending={registration.mutation.isPending}
          error={registration.error}
          onClose={registration.close}
          onConfirm={(targetSessionId) =>
            registration.mutation.mutate({ kind: "move", candidateId: moving.item.candidate.id, targetSessionId })
          }
        />
      )}

      {removing && (
        <RemoveRegistrationDialog
          candidate={toAttendanceCandidate(removing.item)}
          pending={registration.mutation.isPending}
          error={registration.error}
          onClose={registration.close}
          onConfirm={() => registration.mutation.mutate({ kind: "remove", candidateId: removing.item.candidate.id })}
        />
      )}

      {proposal.item && (
        <OutcomeProposalDialog
          key={proposal.item.candidate.id}
          candidate={proposal.item.candidate}
          assessment={proposal.item.assessment}
          existingOutcome={proposal.item.outcome}
          onClose={proposal.close}
          onSuccess={() => {
            work.refreshCandidateWork();
            proposal.close();
          }}
        />
      )}
    </>
  );
}
