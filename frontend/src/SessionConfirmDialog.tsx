import { ConfirmDialog } from "./ConfirmDialog";
import type { SessionAction } from "./sessionDetail";

export interface SessionConfirm {
  action: SessionAction;
  title: string;
  message: string;
}

interface SessionConfirmDialogProps {
  confirm: SessionConfirm;
  pending: boolean;
  /** Abandoning a locked session must say why (server rule). */
  reasonRequired: boolean;
  reason: string;
  onReason: (reason: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

/** The question asked before a session is opened, locked, completed, cancelled, archived, restored or deleted. */
export function SessionConfirmDialog({
  confirm,
  pending,
  reasonRequired,
  reason,
  onReason,
  onConfirm,
  onClose,
}: SessionConfirmDialogProps) {
  const cancelling = confirm.action === "CANCEL";
  const deleting = confirm.action === "DELETE";
  return (
    <ConfirmDialog
      title={confirm.title}
      confirmLabel={deleting ? "Delete session" : "Confirm"}
      pendingLabel={deleting ? "Deleting…" : "Confirm"}
      pending={pending}
      confirmDisabled={cancelling && reasonRequired && !reason.trim()}
      danger={cancelling || deleting}
      // Every session move is one way, so each starts on Cancel.
      startOnCancel
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p className="subtext">{confirm.message}</p>
      {cancelling && (
        <div className="field field--sentence">
          <label htmlFor="cancellation-reason">
            {reasonRequired ? "Cancellation reason (required)" : "Cancellation reason (optional)"}
          </label>
          <textarea
            id="cancellation-reason"
            rows={3}
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            placeholder="Explain why the session is being cancelled…"
          />
        </div>
      )}
    </ConfirmDialog>
  );
}
