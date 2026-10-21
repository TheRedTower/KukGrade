import type { DataImportKind } from "./api";
import { importStepNames } from "./importSteps";

export function ImportStepBar({ kind, current }: { kind: DataImportKind; current: number }) {
  const names = importStepNames(kind);
  return (
    <nav aria-label="Import steps" className="ix-steps">
      <ol>
        {names.map((name, index) => {
          const state = index < current ? "done" : index === current ? "current" : "todo";
          return (
            <li
              key={name}
              aria-current={index === current ? "step" : undefined}
              className={`ix-step ix-step-${state}`}
            >
              <span aria-hidden="true" className="ix-step-bar" />
              <span className="ix-step-label">
                <span aria-hidden="true" className="ix-step-dot">
                  {state === "done" ? "✓" : index + 1}
                </span>
                <span>{name}</span>
                {state === "done" ? <span className="ix-visually-hidden">, done</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
