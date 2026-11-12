import { useState, type FormEvent } from "react";

import type { StudentDetail, updateStudent } from "./api";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Field } from "./Field";
import { todayIsoDate } from "./dates";
import type { useServerForm } from "./forms";

/** Correcting a student's record: WKSA ID, names and date of birth, checked here and by the server. */
export function StudentEditDialog({
  student,
  form,
  saving,
  onSave,
  onClose,
}: {
  student: StudentDetail;
  form: ReturnType<typeof useServerForm>;
  saving: boolean;
  onSave: (changes: Parameters<typeof updateStudent>[1]) => void;
  onClose: () => void;
}) {
  const [wksaId, setWksaId] = useState(student.wksa_id);
  const [firstName, setFirstName] = useState(student.first_name);
  const [lastName, setLastName] = useState(student.last_name);
  const [dob, setDob] = useState(student.date_of_birth);

  function save(event: FormEvent) {
    event.preventDefault();
    form.reset();

    const errors: Record<string, string[]> = {};
    if (!firstName.trim()) {
      errors.first_name = ["First name is required."];
    }
    if (!lastName.trim()) {
      errors.last_name = ["Last name is required."];
    }
    if (!dob) {
      errors.date_of_birth = ["Date of birth is required."];
    }

    if (Object.keys(errors).length > 0) {
      form.setClientErrors(errors);
      return;
    }

    onSave({
      // Sent only when changed: the server allows one change, a student ID
      // to the black belt ID, and refuses any other.
      ...(wksaId !== student.wksa_id ? { wksa_id: wksaId } : {}),
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      date_of_birth: dob,
    });
  }

  return (
    <Dialog title="Edit student record" closeLabel="Close dialog" onClose={onClose} canClose={!saving}>
      {form.banner && <Alert className="form-alert">{form.banner}</Alert>}

      <form className="stack" onSubmit={save} noValidate>
        <div className="stack">
          <Field
            label="WKSA ID"
            error={form.errorFor("wksa_id")}
            hint={
              student.wksa_id_can_change
                ? "Correct a mistyped ID, or record the black belt ID handed out at the national grading."
                : "Correct a mistyped black belt ID. It never goes back to a student ID."
            }
          >
            {(control) => (
              <input
                {...control}
                type="text"
                value={wksaId}
                onChange={(e) => setWksaId(e.target.value)}
                disabled={saving}
              />
            )}
          </Field>

          <div className="form-row-grid-2 tiles">
            <Field label="First name" required error={form.errorFor("first_name")}>
              {(control) => (
                <input
                  {...control}
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={saving}
                  data-dialog-autofocus
                />
              )}
            </Field>

            <Field label="Last name" required error={form.errorFor("last_name")}>
              {(control) => (
                <input
                  {...control}
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={saving}
                />
              )}
            </Field>
          </div>

          <Field label="Date of birth" required error={form.errorFor("date_of_birth")}>
            {(control) => (
              <input
                {...control}
                type="date"
                value={dob}
                max={todayIsoDate()}
                onChange={(e) => setDob(e.target.value)}
                disabled={saving}
              />
            )}
          </Field>
        </div>

        <div className="action-row action-row--end">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
