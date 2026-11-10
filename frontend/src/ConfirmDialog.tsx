import type { ReactNode } from "react";

import { Alert } from "./Alert";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

/**
 * The one question asked before a change: a few sentences (and any field the
 * change needs), the reason it failed if it did, and two buttons. A
 * destructive confirmation starts on Cancel, so Enter does not destroy;
 * any other starts on the confirm button, unless a field in it asks for the
 * focus first. Built on Dialog.
 */
export function ConfirmDialog({
  title,
  eyebrow,
  children,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  pending,
  error,
  confirmDisabled = false,
  danger = false,
  startOnCancel = danger,
  onConfirm,
  onClose,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel?: string;
  pending: boolean;
  error?: string | null;
  confirmDisabled?: boolean;
  danger?: boolean;
  /** Start on Cancel, for a change that cannot be taken back; a destructive one always does. */
  startOnCancel?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={title} eyebrow={eyebrow} closeButton={false} onClose={onClose} canClose={!pending}>
      {/* A form, so Enter in one of its fields confirms as the button would. */}
      <form
        className="dialog__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending && !confirmDisabled) onConfirm();
        }}
      >
        <div className="dialog__body">{children}</div>
        {error ? <Alert>{error}</Alert> : null}
        <div className="action-row dialog__actions">
          <Button variant="secondary" data-dialog-autofocus={startOnCancel || undefined} disabled={pending} onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            variant={danger ? "danger" : "primary"}
            data-dialog-autofocus={startOnCancel ? undefined : true}
            disabled={pending || confirmDisabled}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
