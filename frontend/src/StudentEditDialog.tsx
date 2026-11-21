import { useState, type FormEvent } from "react";

import type { StudentDetail, updateStudent } from "./api";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { requiredErrors, STUDENT_LABELS, type useServerForm } from "./forms";
import { StudentFields, type StudentValues } from "./StudentFields";

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
  const [details, setDetails] = useState<StudentValues>({
    wksa_id: student.wksa_id,
    first_name: student.first_name,
    last_name: student.last_name,
    date_of_birth: student.date_of_birth,
  });

  function save(event: FormEvent) {
    event.preventDefault();
    form.reset();

    const errors = requiredErrors({
      first_name: [details.first_name, STUDENT_LABELS.first_name],
      last_name: [details.last_name, STUDENT_LABELS.last_name],
      date_of_birth: [details.date_of_birth, STUDENT_LABELS.date_of_birth],
    });

    if (Object.keys(errors).length > 0) {
      form.setClientErrors(errors);
      return;
    }

    onSave({
      // Sent only when changed: the server allows one change, a student ID
      // to the black belt ID, and refuses any other.
      ...(details.wksa_id !== student.wksa_id ? { wksa_id: details.wksa_id } : {}),
      first_name: details.first_name.trim(),
      last_name: details.last_name.trim(),
      date_of_birth: details.date_of_birth,
    });
  }

  return (
    <Dialog title="Edit student record" closeLabel="Close dialog" onClose={onClose} canClose={!saving}>
      {form.banner && <Alert className="form-alert">{form.banner}</Alert>}

      <form className="stack" onSubmit={save} noValidate>
        <div className="stack">
          <StudentFields
            parts={["wksa_id", "names", "date_of_birth"]}
            values={details}
            onChange={(changes) => setDetails((current) => ({ ...current, ...changes }))}
            form={form}
            disabled={saving}
            wksaIdHint={
              student.wksa_id_can_change
                ? "Correct a mistyped ID, or record the black belt ID handed out at the national grading."
                : "Correct a mistyped black belt ID. It never goes back to a student ID."
            }
            focusFirstName
          />
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
