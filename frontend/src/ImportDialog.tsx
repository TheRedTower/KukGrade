import type { ReactNode } from "react";

import { useDialogFocus } from "./useDialogFocus";
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
  const dialogRef = useDialogFocus<HTMLDivElement>({
    isOpen: true,
    onClose,
    canClose: !pending,
  });

  return (
    <div
      className="ix-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        aria-labelledby="ix-dialog-title"
        aria-modal="true"
        className="ix-dialog"
        role="dialog"
        tabIndex={-1}
      >
        <h2 id="ix-dialog-title">{title}</h2>
        <div className="ix-section">{children}</div>
        {error ? (
          <p className="ix-danger-text" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ix-actions ix-dialog-actions">
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
      </div>
    </div>
  );
}
