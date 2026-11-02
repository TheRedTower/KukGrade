import type { ComponentProps } from "react";

/**
 * What a screen or a panel shows while its data is on the way: a spinner and a line of
 * text (see .loading-state in controls.css). It is announced politely. Say what is
 * loading ("Loading students…"), not just "Loading".
 */
export function LoadingState({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={["loading-state", className].filter(Boolean).join(" ")} role="status" {...rest}>
      <span className="spinner" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
