import { type ReactNode, useId } from "react";

import { cx } from "./cx";
import { ErrorText } from "./ErrorText";

/** What a field's own control is given: its id, and what describes it. */
export type FieldControl = {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby"?: string;
  "aria-required"?: true;
};

/**
 * One labelled control in a form: the label (with its star when needed),
 * the control, then its error - or, while there is none, its hint. The
 * control is wired to both, so a screen never builds the ids itself:
 *
 *   <Field label="First name" required error={form.errorFor("first_name")}>
 *     {(control) => <input {...control} value={…} onChange={…} />}
 *   </Field>
 */
export function Field({
  label,
  required = false,
  error,
  hint,
  look = "sentence",
  className,
  children,
}: {
  label: ReactNode;
  required?: boolean;
  error?: string | null;
  /** Help under the control, shown while there is no error. */
  hint?: ReactNode;
  /** A sentence-case label (forms), or a small capitals one (a row of filters or settings). */
  look?: "sentence" | "label";
  className?: string;
  children: (control: FieldControl) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  return (
    <div className={cx("field", look === "sentence" && "field--sentence", className)}>
      <label htmlFor={id}>
        {label}
        {required ? <span className="required-star"> *</span> : null}
      </label>
      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy,
        "aria-required": required ? true : undefined,
      })}
      {error ? (
        <ErrorText field id={errorId}>
          {error}
        </ErrorText>
      ) : hint ? (
        <div className="field__hint" id={hintId}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
