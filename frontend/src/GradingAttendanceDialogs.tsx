import { useState } from "react";

import type { LockedCandidateWithdrawal, WithdrawalReason } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import type { AttendanceCandidate } from "./sessionDetail";
import "./GradingAttendance.css";
import { counted } from "./plural";

type NoShowDialogProps = {
  candidates: AttendanceCandidate[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (candidateIds: number[]) => void;
};

export function NoShowDialog({ candidates, pending, error, onClose, onConfirm }: NoShowDialogProps) {
  const [selected, setSelected] = useState<number[]>([]);

  return (
    <ConfirmDialog
      title="Confirm attendance"
      eyebrow="Before assessment"
      confirmLabel="Mark selected as no-show"
      pendingLabel="Confirming…"
      pending={pending}
      error={error}
      confirmDisabled={selected.length === 0}
      danger
      onClose={onClose}
      onConfirm={() => onConfirm(selected)}
    >
      <p className="subtext">
        Select only the candidates who did not attend. Everyone else remains registered and unchanged.
      </p>
      <fieldset className="attendance-candidate-list">
        <legend className="visually-hidden">Candidates who did not attend</legend>
        {candidates.map((candidate) => (
          <label key={candidate.id} className="attendance-candidate-option">
            <input
              type="checkbox"
              data-dialog-autofocus={candidate.id === candidates[0]?.id ? "true" : undefined}
              checked={selected.includes(candidate.id)}
              onChange={(event) => {
                setSelected((current) =>
                  event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id),
                );
              }}
            />
            <span>
              <strong>{candidate.name}</strong>
              {candidate.wksaId && <small className="subtext">WKSA: {candidate.wksaId}</small>}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="subtext" aria-live="polite">
        {selected.length === 0 ? "No no-shows selected" : `${counted(selected.length, "no-show", "no-shows")} selected`}
      </div>
    </ConfirmDialog>
  );
}

type LockedWithdrawalDialogProps = {
  candidate: AttendanceCandidate;
  reasons: WithdrawalReason[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (payload: LockedCandidateWithdrawal) => void;
};

export function LockedWithdrawalDialog({
  candidate,
  reasons,
  pending,
  error,
  onClose,
  onConfirm,
}: LockedWithdrawalDialogProps) {
  const [reason, setReason] = useState<WithdrawalReason | null>(null);
  const [note, setNote] = useState("");
  const noteMissing = Boolean(reason?.note_required) && !note.trim();

  return (
    <ConfirmDialog
      title={`Withdraw ${candidate.name}`}
      eyebrow="Locked-session override"
      confirmLabel="Withdraw candidate"
      pendingLabel="Withdrawing…"
      pending={pending}
      error={error}
      confirmDisabled={!reason || noteMissing}
      danger
      onClose={onClose}
      onConfirm={() => {
        if (reason) onConfirm({ withdrawal_reason: reason.value, withdrawal_note: note.trim() });
      }}
    >
      <p className="subtext">
        Use this only when the candidate cannot finish the locked grading. Existing assessment work remains on record;
        any unfinalised outcome proposal is removed.
      </p>
      <fieldset className="attendance-candidate-list">
        <legend className="field__legend">Reason</legend>
        {reasons.map((option, index) => (
          <label key={option.value} className="attendance-candidate-option">
            <input
              type="radio"
              name="withdrawal-reason"
              value={option.value}
              data-dialog-autofocus={index === 0 ? "true" : undefined}
              checked={reason?.value === option.value}
              onChange={() => setReason(option)}
            />
            <span>
              <strong>{option.label}</strong>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="field field--sentence">
        <span>
          {reason?.note_required ? "What happened" : "Additional note"}{" "}
          <small>{reason?.note_required ? "(required)" : "(optional)"}</small>
        </span>
        <textarea
          rows={4}
          required={reason?.note_required}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Record any useful context without adding unnecessary personal detail."
        />
      </label>
    </ConfirmDialog>
  );
}

type MoveRegistrationDialogProps = {
  candidate: AttendanceCandidate;
  sessions: { id: number; label: string }[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (sessionId: number) => void;
};

export function MoveRegistrationDialog({
  candidate,
  sessions,
  pending,
  error,
  onClose,
  onConfirm,
}: MoveRegistrationDialogProps) {
  const [sessionId, setSessionId] = useState("");

  return (
    <ConfirmDialog
      title={`Move ${candidate.name}`}
      eyebrow="Registration"
      confirmLabel="Move registration"
      pendingLabel="Moving…"
      pending={pending}
      error={error}
      confirmDisabled={!sessionId}
      onClose={onClose}
      onConfirm={() => onConfirm(Number(sessionId))}
    >
      <p className="subtext">
        Moves this registration to another draft or open session. It is refused once an assessment has been prepared.
      </p>
      <label className="field field--sentence">
        <span>Move to</span>
        <select
          required
          data-dialog-autofocus="true"
          value={sessionId}
          onChange={(event) => setSessionId(event.target.value)}
        >
          <option value="">Select a session</option>
          {sessions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {sessions.length === 0 && <p className="subtext">No other draft or open session to move to.</p>}
    </ConfirmDialog>
  );
}

type RemoveRegistrationDialogProps = {
  candidate: AttendanceCandidate;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
};

export function RemoveRegistrationDialog({
  candidate,
  pending,
  error,
  onClose,
  onConfirm,
}: RemoveRegistrationDialogProps) {
  return (
    <ConfirmDialog
      title={`Remove ${candidate.name}`}
      eyebrow="Registration"
      confirmLabel="Remove registration"
      pendingLabel="Removing…"
      pending={pending}
      error={error}
      danger
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <p className="subtext">
        Removes this registration and its assessment, which has not been started. Use it for a registration made in
        error; the removal is kept in the audit log. To record that a candidate did not grade, withdraw them instead.
      </p>
    </ConfirmDialog>
  );
}
