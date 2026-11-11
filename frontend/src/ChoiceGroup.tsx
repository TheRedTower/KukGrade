import type { ReactNode } from "react";
import { cx } from "./cx";

interface Choice<Value extends string> {
  value: Value;
  label: ReactNode;
  /** How many there are of it, shown beside the label (a filter's count). */
  count?: ReactNode;
}

interface ChoiceGroupProps<Value extends string> {
  /** Names the group for assistive technology. */
  label: string;
  choices: readonly Choice<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  /**
   * "segments": a switch between a few settings, joined in one pill.
   * "chips": a row of filters that wraps, each with its count.
   */
  look?: "segments" | "chips";
  className?: string;
}

/**
 * Every pick-one row of buttons (see .choices in controls.css): each a real
 * button, the chosen one pressed, so it reads as a set of toggles.
 */
export function ChoiceGroup<Value extends string>({ label, choices, value, onChange, look = "segments", className }: ChoiceGroupProps<Value>) {
  return (
    <div aria-label={label} className={cx("choices", `choices--${look}`, className)} role="group">
      {choices.map((choice) => (
        <button aria-pressed={choice.value === value} key={choice.value} type="button" onClick={() => onChange(choice.value)}>
          {choice.label}
          {choice.count !== undefined ? <span className="choices__count">{choice.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
