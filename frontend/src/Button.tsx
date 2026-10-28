import type { ButtonHTMLAttributes } from "react";

import { type ButtonStyle, buttonClass } from "./buttonClass";

/**
 * Every button in the app. A screen picks a variant (primary for the one thing
 * to do, secondary or ghost beside it, danger for what cannot be undone); its
 * look is in controls.css and nowhere else.
 */
export function Button({
  variant,
  small,
  className,
  type = "button",
  ...rest
}: ButtonStyle & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={buttonClass({ variant, small }, className)} {...rest} />;
}
