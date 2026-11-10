import { useState, type FormEvent } from "react";

import type { StudentStatus } from "./api";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { StudentStatusBadge } from "./StatusBadge";
import { useChoices } from "./choices";

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

  function save(event: FormEvent) {
    event.preventDefault();
    onSave(selected);
  }

  return (
    <Dialog title="Change student status" closeLabel="Close dialog" onClose={onClose} canClose={!saving}>
      {error && <Alert className="form-alert">{error}</Alert>}

      <form className="stack" onSubmit={save}>
        <div>
          <p className="modal-lead-text">
            Update status for <strong>{name}</strong>:
          </p>

          <div className="status-radio-options" role="radiogroup" aria-label="Student status options">
            {choices.map((choice) => (
              <label className={`status-radio-card ${selected === choice.value ? "selected" : ""}`} key={choice.value}>
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
        </div>

        <div className="action-row action-row--end">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Updating..." : "Update status"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
