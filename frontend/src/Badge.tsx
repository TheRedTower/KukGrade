import type { ComponentProps, ReactNode } from "react";

import { type BadgeTone, badgeClass } from "./badgeClass";

interface BadgeStyle {
  tone: BadgeTone;
  /** A small round mark before the label. */
  dot?: boolean;
  /** An icon before the label; the shared icons are already hidden from assistive technology. */
  icon?: ReactNode;
}

/**
 * Every badge in the app: a short label with a tone (see .badge in controls.css).
 * Use StatusBadge for a status the system defines, so the same status looks the
 * same everywhere.
 */
export function Badge({ tone, dot, icon, className, children, ...rest }: BadgeStyle & ComponentProps<"span">) {
  return (
    <span className={badgeClass(tone, className)} {...rest}>
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {icon}
      {children}
    </span>
  );
}
