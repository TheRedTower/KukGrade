import { type ReactNode, useId } from "react";

import { ActionBar } from "./ActionBar";
import { PageHeader } from "./PageHeader";

/**
 * One thing in full, on a page of its own - its own address, so Back works -
 * never a panel opened inside a list or shown below it. Where the thing sits
 * in the work (eyebrow: "Past gradings · Step 3 of 5") and the progress are at
 * the top; its one primary action is in the bar at the foot (ActionBar).
 */
export function DetailPage({
  title,
  back,
  eyebrow,
  progress,
  actions,
  status,
  children,
  testId,
}: {
  title: string;
  back: { to: string; label: string };
  eyebrow?: string;
  /** Under the title, such as a Progress. */
  progress?: ReactNode;
  /** The bar's buttons; none, and there is no bar. */
  actions?: ReactNode;
  /** What the bar says beside them. */
  status?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="page" data-testid={testId}>
      <PageHeader back={back} eyebrow={eyebrow} title={title} titleId={titleId}>
        {progress}
      </PageHeader>
      {children}
      {actions ? <ActionBar status={status}>{actions}</ActionBar> : null}
    </section>
  );
}
