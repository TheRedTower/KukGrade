import type { SelectHTMLAttributes } from "react";

import type { FieldControl } from "./Field";

/** One choice a select offers: what it stands for, and its name on screen. */
export type SelectOption = { value: string; label: string };

/**
 * A drop-down list, the one way a screen offers a choice of values. It goes
 * inside a Field, which gives it its label and ids:
 *
 *   <Field label="Status" look="label">
 *     {(control) => <Select {...control} all="All statuses" options={statuses} value={status} onChange={…} />}
 *   </Field>
 *
 * `all` puts a first entry that chooses none of them (a filter's "All ..."),
 * standing for `allValue`.
 */
export function Select({
  options,
  all,
  allValue = "",
  value,
  onChange,
  ...rest
}: FieldControl & {
  options: readonly SelectOption[];
  all?: string;
  allValue?: string;
  value: string;
  onChange: (value: string) => void;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "children" | keyof FieldControl> & {
    "data-testid"?: string;
  }) {
  return (
    <select {...rest} value={value} onChange={(event) => onChange(event.target.value)}>
      {all !== undefined && <option value={allValue}>{all}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
