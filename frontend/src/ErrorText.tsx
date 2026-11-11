import type { ComponentProps, ElementType } from "react";
import { cx } from "./cx";

interface ErrorTextProps extends ComponentProps<"p"> {
  /** The element to draw, when a paragraph does not fit (a list item, or text inside a line). */
  as?: ElementType;
  /** A message under one form control: smaller, and spaced from the control. */
  field?: boolean;
  /** Announce it as it appears. Turn off where a banner or the focused control already says so. */
  announce?: boolean;
}

/**
 * A short error in the middle of a form or a page: one line of red text (see .error-text
 * in controls.css), announced at once. Use Alert for a boxed message with a title or an
 * action. Give it the `id` the control points at with aria-describedby.
 */
export function ErrorText({ as: Tag = "p", field, announce = true, className, role, ...rest }: ErrorTextProps) {
  return (
    <Tag
      className={cx("error-text", field && "error-text--field", className)}
      role={role ?? (announce ? "alert" : undefined)}
      {...rest}
    />
  );
}
