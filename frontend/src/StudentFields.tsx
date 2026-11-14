import type { ReactNode } from "react";

import { Field } from "./Field";
import { todayIsoDate } from "./dates";
import { STUDENT_LABELS, type useServerForm } from "./forms";

/** A student's own details as a form holds them while they are typed. */
export type StudentValues = {
  wksa_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
};

type Part = "names" | "wksa_id" | "date_of_birth";

/**
 * A student's name, WKSA ID and date of birth: the same fields wherever a
 * student is added or corrected. `parts` says which to show, in that order, so
 * a form can place them in its own cards.
 */
export function StudentFields({
  parts,
  values,
  onChange,
  form,
  disabled,
  wksaIdRequired = false,
  wksaIdHint,
  wksaIdPlaceholder,
  dateOfBirthHint,
  focusFirstName = false,
}: {
  parts: readonly Part[];
  values: StudentValues;
  onChange: (changes: Partial<StudentValues>) => void;
  form: ReturnType<typeof useServerForm>;
  disabled: boolean;
  wksaIdRequired?: boolean;
  wksaIdHint?: ReactNode;
  wksaIdPlaceholder?: string;
  dateOfBirthHint?: ReactNode;
  /** Put the cursor in the first name when a dialog opens. */
  focusFirstName?: boolean;
}) {
  const shown: Record<Part, ReactNode> = {
    names: (
      <div className="form-row-grid-2 tiles" key="names">
        <Field label={STUDENT_LABELS.first_name} required error={form.errorFor("first_name")}>
          {(control) => (
            <input
              {...control}
              type="text"
              placeholder="e.g. Alex"
              value={values.first_name}
              onChange={(e) => onChange({ first_name: e.target.value })}
              disabled={disabled}
              data-dialog-autofocus={focusFirstName || undefined}
            />
          )}
        </Field>

        <Field label={STUDENT_LABELS.last_name} required error={form.errorFor("last_name")}>
          {(control) => (
            <input
              {...control}
              type="text"
              placeholder="e.g. Carter"
              value={values.last_name}
              onChange={(e) => onChange({ last_name: e.target.value })}
              disabled={disabled}
            />
          )}
        </Field>
      </div>
    ),
    wksa_id: (
      <Field
        key="wksa_id"
        label={STUDENT_LABELS.wksa_id}
        required={wksaIdRequired}
        error={form.errorFor("wksa_id")}
        hint={wksaIdHint}
      >
        {(control) => (
          <input
            {...control}
            type="text"
            placeholder={wksaIdPlaceholder}
            value={values.wksa_id}
            onChange={(e) => onChange({ wksa_id: e.target.value })}
            disabled={disabled}
          />
        )}
      </Field>
    ),
    date_of_birth: (
      <Field
        key="date_of_birth"
        label={STUDENT_LABELS.date_of_birth}
        required
        error={form.errorFor("date_of_birth")}
        hint={dateOfBirthHint}
      >
        {(control) => (
          <input
            {...control}
            type="date"
            value={values.date_of_birth}
            max={todayIsoDate()}
            onChange={(e) => onChange({ date_of_birth: e.target.value })}
            disabled={disabled}
          />
        )}
      </Field>
    ),
  };
  return <>{parts.map((part) => shown[part])}</>;
}
