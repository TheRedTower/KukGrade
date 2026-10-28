export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonStyle {
  variant?: ButtonVariant;
  /** A smaller button, for a row of actions inside a table or card. */
  small?: boolean;
}

/** The classes of a button, for something that is not a <button> (a link that looks like one). */
export function buttonClass({ variant = "secondary", small }: ButtonStyle, extra?: string): string {
  return ["btn", `btn--${variant}`, small ? "btn--sm" : "", extra ?? ""]
    .filter(Boolean)
    .join(" ");
}
