import type { ReactNode } from "react";

import { Dialog } from "./Dialog";
import { Button } from "./Button";

/** A short confirmation: two sentences and two buttons. */
export function ImportDialog({
  title,
  children,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Not yet",
  pending,
  error,
  confirmDisabled = false,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel?: string;
  pending: boolean;
  error?: string | null;
  confirmDisabled?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={title} onClose={onClose} canClose={!pending}>
      <div className="ix-section ix-dialog-body">{children}</div>
      {error ? (
        <p className="ix-danger-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="ix-actions dialog__actions">
        <Button variant="ghost" disabled={pending} onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          data-dialog-autofocus
          disabled={pending || confirmDisabled}
          onClick={onConfirm}
        >
          {pending ? pendingLabel : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
