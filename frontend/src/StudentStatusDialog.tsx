import { useState, type FormEvent } from "react";

import type { StudentStatus } from "./api";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { StudentStatusBadge } from "./StatusBadge";

const CHOICES: { status: StudentStatus; description: string }[] = [
  { status: "ACTIVE", description: "Active student in regular training. Can be registered for gradings." },
  { status: "INACTIVE", description: "Temporary break or medical leave. Blocks nothing, and keeps all history." },
  { status: "LEFT", description: "Has left. Cannot be registered for gradings; all history is kept." },
];

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
            {CHOICES.map((choice) => (
              <label className={`status-radio-card ${selected === choice.status ? "selected" : ""}`} key={choice.status}>
                <input
                  type="radio"
                  name="status"
                  value={choice.status}
                  checked={selected === choice.status}
                  onChange={() => setSelected(choice.status)}
                  data-dialog-autofocus={selected === choice.status ? true : undefined}
                />
                <div className="status-radio-content">
                  <div>
                    <StudentStatusBadge status={choice.status} />
                  </div>
                  <p className="status-radio-desc">{choice.description}</p>
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
