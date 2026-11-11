import { cx } from "./cx";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-quiet" | "link";

export interface ButtonStyle {
  variant?: ButtonVariant;
  /** A smaller button, for a row of actions inside a table or card. */
  small?: boolean;
  /** As wide as the box it is in. */
  block?: boolean;
}

/** The classes of a button, for something that is not a <button> (a link that looks like one). */
export function buttonClass({ variant = "secondary", small, block }: ButtonStyle, extra?: string): string {
  return cx("btn", `btn--${variant}`, small && "btn--sm", block && "btn--block", extra);
}
