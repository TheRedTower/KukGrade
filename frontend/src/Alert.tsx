import type { ComponentProps, ReactNode } from "react";

import { Button } from "./Button";

export type AlertTone = "error" | "warning" | "success" | "info";

interface AlertProps extends Omit<ComponentProps<"div">, "title"> {
  tone?: AlertTone;
  /** A bold first line above the message. */
  title?: ReactNode;
  /** An icon before the message; the shared icons are already hidden from assistive technology. */
  icon?: ReactNode;
  /** Something to do about it (a link or button), at the end of the message. */
  action?: ReactNode;
  /** Shows a close button that calls this. */
  onDismiss?: () => void;
}

/**
 * Every boxed message in the app: what went wrong, a warning, or a confirmation
 * (see .alert in controls.css). An error or a warning is announced at once; a
 * confirmation or a note waits its turn. Pass `role` to override.
 */
export function Alert({ tone = "error", title, icon, action, onDismiss, role, className, children, ...rest }: AlertProps) {
  return (
    <div
      className={["alert", `alert--${tone}`, className].filter(Boolean).join(" ")}
      role={role ?? (tone === "error" || tone === "warning" ? "alert" : "status")}
      {...rest}
    >
      {icon}
      <div className="alert__body">
        {title ? (
          <>
            <strong className="alert__title">{title}</strong>{" "}
          </>
        ) : null}
        {children}
      </div>
      {action}
      {onDismiss ? (
        <Button variant="ghost" small className="alert__dismiss" aria-label="Dismiss message" onClick={onDismiss}>
          <span aria-hidden="true">✕</span>
        </Button>
      ) : null}
    </div>
  );
}
