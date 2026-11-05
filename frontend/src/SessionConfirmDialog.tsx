import { Button } from "./Button";
import { Dialog } from "./Dialog";
import type { SessionAction } from "./sessionDetail";

export interface SessionConfirm {
  action: SessionAction;
  title: string;
  message: string;
}

interface SessionConfirmDialogProps {
  confirm: SessionConfirm;
  pending: boolean;
  deleting: boolean;
  /** Abandoning a locked session must say why (server rule). */
  reasonRequired: boolean;
  reason: string;
  onReason: (reason: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

/** The question asked before a session is opened, locked, completed, cancelled, archived, restored or deleted. */
export function SessionConfirmDialog({ confirm, pending, deleting, reasonRequired, reason, onReason, onConfirm, onClose }: SessionConfirmDialogProps) {
  const cancelling = confirm.action === "CANCEL";
  return (
    <Dialog title={confirm.title} closeButton={false} onClose={onClose} canClose={!pending}>
      <p className="gsd-modal-message">{confirm.message}</p>

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

      <div className="action-row action-row--end">
        <Button
          variant={cancelling || confirm.action === "DELETE" ? "danger" : "primary"}
          onClick={onConfirm}
          disabled={pending || (cancelling && reasonRequired && !reason.trim())}
          data-testid="gsd-modal-confirm-btn"
        >
          {confirm.action === "DELETE" ? (deleting ? "Deleting…" : "Delete session") : "Confirm"}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={pending} data-dialog-autofocus>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
