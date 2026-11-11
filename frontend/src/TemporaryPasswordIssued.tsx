import { useEffect, useRef } from "react";

import type { IssuedTemporaryPassword } from "./api";
import { formatDateTime } from "./dates";
import { Button } from "./Button";
import { useClipboard } from "./useClipboard";

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
  const { copied, copy } = useClipboard();
  const copyRef = useRef<HTMLButtonElement>(null);

  // The form that issued it has gone, and focus with it.
  useEffect(() => copyRef.current?.focus(), []);

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
      <p className="users-issued-password-warning item-title">
        Copy this temporary password now. It will not be shown again.
      </p>
      <p className="users-form-note meta">
        It stops working at {formatDateTime(issued.temporary_password_expires_at)}.
      </p>
      <p className="users-form-note meta" role="status">
        {copied === "done"
          ? "Copied."
          : copied === "failed"
            ? "It couldn't be copied. Select it and copy it instead."
            : ""}
      </p>
      <div className="action-row users-dialog-actions">
        <Button
          ref={copyRef}
          variant="secondary"
          onClick={() => void copy(issued.temporary_password)}
        >
          Copy password
        </Button>
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
