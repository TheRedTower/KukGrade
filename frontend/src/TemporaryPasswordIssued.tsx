import { useEffect, useRef, useState } from "react";

import type { IssuedTemporaryPassword } from "./api";
import { formatDateTime } from "./dates";

/**
 * A temporary password the server has just issued, shown this once.
 *
 * Only its hash is kept, so once this closes nobody can see it again;
 * resetting the password issues a new one instead. Used by adding a user and
 * by resetting one's password.
 */
export function TemporaryPasswordIssued({
  issued,
  onDone,
}: {
  issued: IssuedTemporaryPassword;
  onDone: () => void;
}): React.ReactElement {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const copyRef = useRef<HTMLButtonElement>(null);

  // The form that issued it has gone, and focus with it.
  useEffect(() => copyRef.current?.focus(), []);

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(issued.temporary_password);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <div className="users-issued-password">
      <p>
        Give this temporary password to <strong>{issued.full_name}</strong>. They'll choose their
        own password when they first sign in.
      </p>
      <div className="users-issued-password-value">
        <span id="issued-password-label">Temporary password</span>
        <code aria-labelledby="issued-password-label">{issued.temporary_password}</code>
      </div>
      <p className="users-issued-password-warning">
        Copy this temporary password now. It will not be shown again.
      </p>
      <p className="users-form-note">
        It stops working at {formatDateTime(issued.temporary_password_expires_at)}.
      </p>
      <p className="users-form-note" role="status">
        {copy === "copied"
          ? "Copied."
          : copy === "failed"
            ? "It couldn't be copied. Select it and copy it instead."
            : ""}
      </p>
      <div className="action-row users-dialog-actions">
        <button
          ref={copyRef}
          type="button"
          className="users-secondary-button"
          onClick={() => void copyPassword()}
        >
          Copy password
        </button>
        <button type="button" className="users-primary-button" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
