import type { ComponentProps } from "react";

import { type ButtonStyle, buttonClass } from "./buttonClass";

/**
 * Every button in the app. A screen picks a variant (primary for the one thing
 * to do, secondary or ghost beside it, danger for what cannot be undone); its
 * look is in controls.css and nowhere else.
 */
export function Button({
  variant,
  small,
  block,
  className,
  type = "button",
  ...rest
}: ButtonStyle & ComponentProps<"button">) {
  return <button type={type} className={buttonClass({ variant, small, block }, className)} {...rest} />;
}
