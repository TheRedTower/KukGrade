import { type ReactNode, useId } from "react";

import { Button } from "./Button";
import { useDialogFocus } from "./useDialogFocus";

interface DialogProps {
  title: string;
  /** A short line above the title, such as what kind of record this is. */
  eyebrow?: string;
  /** Names the close button for assistive technology; its text is "Close". */
  closeLabel?: string;
  onClose: () => void;
  /** False for a confirmation that has its own Cancel button. */
  closeButton?: boolean;
  /** False while something is being saved: Escape, the backdrop and Close do nothing. */
  canClose?: boolean;
  /** False where a stray click outside would lose something, such as a password shown once. */
  closeOnBackdrop?: boolean;
  children: ReactNode;
}

/**
 * The one dialog: a card in the middle of a desktop screen, a sheet from the
 * bottom edge on a phone (see .dialog in layout.css). Render it only while it
 * is open. Focus starts on the first control, or on a child marked data-dialog-autofocus (a destructive
 * confirmation marks Cancel); it stays inside, and Escape or a click outside closes it.
 */
export function Dialog({ title, eyebrow, closeLabel = "Close", onClose, canClose = true, closeOnBackdrop = true, closeButton = true, children }: DialogProps) {
  const titleId = useId();
  const ref = useDialogFocus<HTMLElement>({ isOpen: true, onClose, canClose });
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (canClose && closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        tabIndex={-1}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="dialog__header">
          <div className="dialog__title">
            {eyebrow && <p className="dialog__eyebrow">{eyebrow}</p>}
            <h2 className="dialog__heading" id={titleId}>{title}</h2>
          </div>
          {closeButton && (
            <Button variant="ghost" onClick={onClose} aria-label={closeLabel} disabled={!canClose}>
              Close
            </Button>
          )}
        </header>
        {children}
      </section>
    </div>
  );
}
