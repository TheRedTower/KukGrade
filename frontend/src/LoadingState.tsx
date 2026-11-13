import type { ComponentProps } from "react";
import { cx } from "./cx";

/**
 * What a screen or a panel shows while its data is on the way: a spinner and a line of
 * text (see .loading-state in controls.css). It is announced politely. Say what is
 * loading ("Loading students…"), not just "Loading". `compact` is for a row or a small
 * panel: it reads from the start and takes no more room than a line of text.
 */
export function LoadingState({ className, children, compact, ...rest }: ComponentProps<"div"> & { compact?: boolean }) {
  return (
    <div className={cx("loading-state", compact && "loading-state--compact", className)} role="status" {...rest}>
      <span className="spinner" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
