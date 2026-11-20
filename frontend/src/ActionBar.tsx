import type { ReactNode } from "react";

import { footBar } from "./stickyParts";

/**
 * The bar fixed to the foot of the window that holds a screen's one primary
 * action, within reach of a thumb (see .action-bar in layout.css). What the bar
 * says - a count, the last result, a failure - takes the room at the start; the
 * buttons sit at the end. A side panel's foot stays above it (stickyParts.ts).
 */
export function ActionBar({
  children,
  status,
  testId,
}: {
  /** The buttons: the one primary action, and at most a secondary beside it. */
  children: ReactNode;
  /** What the bar says, beside the buttons. */
  status?: ReactNode;
  testId?: string;
}) {
  return (
    <footer className="action-bar" data-testid={testId} ref={footBar}>
      {status ? <div className="action-bar__status">{status}</div> : null}
      <div className="action-bar__actions">{children}</div>
    </footer>
  );
}
