import { useState } from "react";

import type { StudentStatus } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { StudentStatusBadge } from "./StatusBadge";
import { useChoices } from "./choices";
import { cx } from "./cx";

/** Choosing a student's status: each with what it means, the current one chosen to start with. */
export function StudentStatusDialog({
  name,
  status,
  saving,
  error,
  onSave,
  onClose,
}: {
  name: string;
  status: StudentStatus;
  saving: boolean;
  error: string | null;
  onSave: (status: StudentStatus) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(status);
  const choices = useChoices().student_statuses;

  return (
    <ConfirmDialog
      title="Change student status"
      confirmLabel="Update status"
      pendingLabel="Updating…"
      pending={saving}
      error={error}
      onClose={onClose}
      onConfirm={() => onSave(selected)}
    >
      <p>
        Update status for <strong>{name}</strong>:
      </p>
      <div className="status-radio-options" role="radiogroup" aria-label="Student status options">
        {choices.map((choice) => (
          <label className={cx("status-radio-card", selected === choice.value && "selected")} key={choice.value}>
            <input
              type="radio"
              name="status"
              value={choice.value}
              checked={selected === choice.value}
              onChange={() => setSelected(choice.value)}
              data-dialog-autofocus={selected === choice.value ? true : undefined}
            />
            <div className="status-radio-content">
              <div>
                <StudentStatusBadge status={choice.value} label={choice.label} />
              </div>
              <p className="status-radio-desc meta">{choice.description}</p>
            </div>
          </label>
        ))}
      </div>
    </ConfirmDialog>
  );
}
