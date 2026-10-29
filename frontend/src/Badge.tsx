import type { ReactNode } from "react";

export type BadgeTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "draft"
  | "open"
  | "locked"
  | "completed"
  | "cancelled";

interface BadgeProps {
  tone: BadgeTone;
  /** A small round mark before the label. */
  dot?: boolean;
  /** An icon before the label; the shared icons are already hidden from assistive technology. */
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Every badge in the app: a short label with a tone (see .badge in controls.css).
 * Use StatusBadge for a status the system defines, so the same status looks the
 * same everywhere.
 */
export function Badge({ tone, dot, icon, className, children }: BadgeProps) {
  return (
    <span className={`badge badge--${tone}${className ? ` ${className}` : ""}`}>
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {icon}
      {children}
    </span>
  );
}
