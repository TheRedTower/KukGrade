import { useState } from "react";

import { Alert } from "./Alert";
import type { LockedCandidateWithdrawal, WithdrawalReason } from "./api";
import { Dialog } from "./Dialog";
import "./GradingAttendance.css";
import { Button } from "./Button";

export type AttendanceCandidate = {
  id: number;
  name: string;
  wksaId: string;
};

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
    <Dialog
      title="Confirm attendance"
      eyebrow="Before assessment"
      closeButton={false}
      onClose={onClose}
      canClose={!pending}
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
      {error && <Alert className="attendance-dialog-alert">{error}</Alert>}
      <div className="attendance-dialog-actions">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={() => onConfirm(selected)}
          disabled={pending || selected.length === 0}
        >
          {pending ? "Confirming…" : "Mark selected as no-show"}
        </Button>
      </div>
    </Dialog>
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
    <Dialog
      title={`Withdraw ${candidate.name}`}
      eyebrow="Locked-session override"
      closeButton={false}
      onClose={onClose}
      canClose={!pending}
    >
      <p className="attendance-dialog-copy">
        Use this only when the candidate cannot finish the locked grading. Existing assessment work remains on record; any unfinalised outcome proposal is removed.
      </p>
      <form
        className="attendance-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!reason || noteMissing) return;
          onConfirm({ withdrawal_reason: reason.code, withdrawal_note: note.trim() });
        }}
      >
        <fieldset className="attendance-candidate-list">
          <legend className="field__legend">Reason</legend>
          {reasons.map((option, index) => (
            <label key={option.code} className="attendance-candidate-option">
              <input
                type="radio"
                name="withdrawal-reason"
                value={option.code}
                data-dialog-autofocus={index === 0 ? "true" : undefined}
                checked={reason?.code === option.code}
                onChange={() => setReason(option)}
              />
              <span>
                <strong>{option.name}</strong>
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
        {error && <Alert className="attendance-dialog-alert">{error}</Alert>}
        <div className="attendance-dialog-actions">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            disabled={pending || !reason || noteMissing}
          >
            {pending ? "Withdrawing…" : "Withdraw candidate"}
          </Button>
        </div>
      </form>
    </Dialog>
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
    <Dialog
      title={`Move ${candidate.name}`}
      eyebrow="Registration"
      closeButton={false}
      onClose={onClose}
      canClose={!pending}
    >
      <p className="attendance-dialog-copy">
        Moves this registration to another draft or open session. It is refused once an assessment has been prepared.
      </p>
      <form
        className="attendance-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (sessionId) onConfirm(Number(sessionId));
        }}
      >
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
        {sessions.length === 0 && (
          <p className="attendance-dialog-copy">No other draft or open session to move to.</p>
        )}
        {error && <Alert className="attendance-dialog-alert">{error}</Alert>}
        <div className="attendance-dialog-actions">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending || !sessionId}>
            {pending ? "Moving…" : "Move registration"}
          </Button>
        </div>
      </form>
    </Dialog>
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
    <Dialog
      title={`Remove ${candidate.name}`}
      eyebrow="Registration"
      closeButton={false}
      onClose={onClose}
      canClose={!pending}
    >
      <p className="attendance-dialog-copy">
        Removes this registration and its assessment, which has not been started. Use it for a registration made in error; the removal is kept in the audit log. To record that a candidate did not grade, withdraw them instead.
      </p>
      {error && <Alert className="attendance-dialog-alert">{error}</Alert>}
      <div className="attendance-dialog-actions">
        <Button
          variant="ghost"
          data-dialog-autofocus="true"
          onClick={onClose}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? "Removing…" : "Remove registration"}
        </Button>
      </div>
    </Dialog>
  );
}
