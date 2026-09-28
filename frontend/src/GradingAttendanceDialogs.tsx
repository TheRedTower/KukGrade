import { useState } from "react";

import type { LockedCandidateWithdrawal } from "./api";
import { useDialogFocus } from "./useDialogFocus";
import "./GradingAttendance.css";

export type AttendanceCandidate = {
  id: number;
  name: string;
  wksaId: string;
};

type DialogFrameProps = {
  title: string;
  eyebrow: string;
  pending: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

function DialogFrame({ title, eyebrow, pending, onClose, children }: DialogFrameProps) {
  // Nothing closes the dialog while its request is in flight.
  const dialogRef = useDialogFocus<HTMLDivElement>({
    isOpen: true,
    onClose,
    canClose: !pending,
  });

  return (
    <div
      className="attendance-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="attendance-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="attendance-dialog-title"
      >
        <header className="attendance-dialog-header">
          <div>
            <p>{eyebrow}</p>
            <h2 id="attendance-dialog-title">{title}</h2>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
            Close
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

type NoShowDialogProps = {
  candidates: AttendanceCandidate[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (candidateIds: number[]) => void;
};

export function NoShowDialog({
  candidates,
  pending,
  error,
  onClose,
  onConfirm,
}: NoShowDialogProps) {
  const [selected, setSelected] = useState<number[]>([]);

  return (
    <DialogFrame
      title="Confirm attendance"
      eyebrow="Before assessment"
      pending={pending}
      onClose={onClose}
    >
      <p className="attendance-dialog-copy">
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
                  event.target.checked
                    ? [...current, candidate.id]
                    : current.filter((id) => id !== candidate.id),
                );
              }}
            />
            <span>
              <strong>{candidate.name}</strong>
              {candidate.wksaId && <small>WKSA: {candidate.wksaId}</small>}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="attendance-dialog-summary" aria-live="polite">
        {selected.length === 0
          ? "No no-shows selected"
          : `${selected.length} no-show${selected.length === 1 ? "" : "s"} selected`}
      </div>
      {error && <div className="attendance-dialog-error" role="alert">{error}</div>}
      <div className="attendance-dialog-actions">
        <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary attendance-danger-button"
          onClick={() => onConfirm(selected)}
          disabled={pending || selected.length === 0}
        >
          {pending ? "Confirming…" : "Mark selected as no-show"}
        </button>
      </div>
    </DialogFrame>
  );
}

type LockedWithdrawalDialogProps = {
  candidate: AttendanceCandidate;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (payload: LockedCandidateWithdrawal) => void;
};

export function LockedWithdrawalDialog({
  candidate,
  pending,
  error,
  onClose,
  onConfirm,
}: LockedWithdrawalDialogProps) {
  const [reason, setReason] = useState<LockedCandidateWithdrawal["withdrawal_reason"] | "">("");
  const [note, setNote] = useState("");

  return (
    <DialogFrame
      title={`Withdraw ${candidate.name}`}
      eyebrow="Locked-session override"
      pending={pending}
      onClose={onClose}
    >
      <p className="attendance-dialog-copy">
        Use this only when the candidate cannot finish the locked grading. Existing assessment work remains on record; any unfinalised outcome proposal is removed.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!reason) return;
          onConfirm({ withdrawal_reason: reason, withdrawal_note: note.trim() });
        }}
      >
        <label className="attendance-field">
          <span>Reason</span>
          <select
            required
            data-dialog-autofocus="true"
            value={reason}
            onChange={(event) =>
              setReason(event.target.value as LockedCandidateWithdrawal["withdrawal_reason"] | "")
            }
          >
            <option value="">Select a reason</option>
            <option value="INJURY">Injured during grading</option>
            <option value="WITHDREW">Withdrew voluntarily</option>
            <option value="ABSENT">Did not attend</option>
            <option value="ADMIN_ERROR">Registered in error</option>
          </select>
        </label>
        <label className="attendance-field">
          <span>Additional note <small>(optional)</small></span>
          <textarea
            rows={4}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Record any useful context without adding unnecessary personal detail."
          />
        </label>
        {error && <div className="attendance-dialog-error" role="alert">{error}</div>}
        <div className="attendance-dialog-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary attendance-danger-button"
            disabled={pending || !reason}
          >
            {pending ? "Withdrawing…" : "Withdraw candidate"}
          </button>
        </div>
      </form>
    </DialogFrame>
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
    <DialogFrame
      title={`Move ${candidate.name}`}
      eyebrow="Registration"
      pending={pending}
      onClose={onClose}
    >
      <p className="attendance-dialog-copy">
        Moves this registration to another draft or open session. It is refused once an assessment has been prepared.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (sessionId) onConfirm(Number(sessionId));
        }}
      >
        <label className="attendance-field">
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
        {sessions.length === 0 && (
          <p className="attendance-dialog-copy">No other draft or open session to move to.</p>
        )}
        {error && <div className="attendance-dialog-error" role="alert">{error}</div>}
        <div className="attendance-dialog-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={pending || !sessionId}>
            {pending ? "Moving…" : "Move registration"}
          </button>
        </div>
      </form>
    </DialogFrame>
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
    <DialogFrame
      title={`Remove ${candidate.name}`}
      eyebrow="Registration"
      pending={pending}
      onClose={onClose}
    >
      <p className="attendance-dialog-copy">
        Removes this registration and any assessment work recorded for it. Use it for a registration made in error; the removal is kept in the audit log. To record that a candidate did not grade, withdraw them instead.
      </p>
      {error && <div className="attendance-dialog-error" role="alert">{error}</div>}
      <div className="attendance-dialog-actions">
        <button
          type="button"
          className="btn-ghost"
          data-dialog-autofocus="true"
          onClick={onClose}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary attendance-danger-button"
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? "Removing…" : "Remove registration"}
        </button>
      </div>
    </DialogFrame>
  );
}
