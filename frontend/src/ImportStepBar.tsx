import type { DataImportBatch, DataImportKind } from "./api";
import { useImportSteps } from "./importSteps";
import { cx } from "./cx";
import { CheckIcon } from "./Icons";

/** The import's steps, with the one shown now (a step the server names). */
export function ImportStepBar({ kind, current }: { kind: DataImportKind; current: DataImportBatch["next_step"] }) {
  const names = useImportSteps()(kind);
  const at = names.findIndex((step) => step.value === current);
  if (at < 0) return null;
  return (
    <nav aria-label="Import steps" className="ix-steps">
      <ol className="list-plain">
        {names.map((step, index) => {
          const state = index < at ? "done" : index === at ? "current" : "todo";
          return (
            <li
              key={step.value}
              aria-current={index === at ? "step" : undefined}
              className={cx("ix-step meta", `ix-step-${state}`, state === "current" && "item-title")}
            >
              <span aria-hidden="true" className="ix-step-bar" />
              <span className="ix-step-label">
                <span aria-hidden="true" className="mark mark--small ix-step-dot">
                  {state === "done" ? <CheckIcon size={12} /> : index + 1}
                </span>
                <span className="visually-hidden--phone">{step.label}</span>
                {state === "done" ? <span className="visually-hidden">, done</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {/* A phone shows the numbers only, and the current step's name here once
          (the list above still names every step for a screen reader). */}
      <p aria-hidden="true" className="ix-step-caption meta">
        <strong>
          Step {at + 1} of {names.length}: {names[at].label}
        </strong>
      </p>
    </nav>
  );
}
