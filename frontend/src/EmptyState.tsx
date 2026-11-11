import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

interface EmptyStateProps extends Omit<ComponentProps<"div">, "title"> {
  /** What there is none of, or what was not found. */
  title?: ReactNode;
  /** The element for the title: a heading where the page needs one, a paragraph otherwise. */
  titleAs?: "p" | "h2" | "h3";
  titleId?: string;
  /** An icon above the title; the shared icons are already hidden from assistive technology. */
  icon?: ReactNode;
  /** What to do next (a Button or a link). */
  action?: ReactNode;
  /** A dashed box, for where a table or a list would have been. */
  framed?: boolean;
  /** Takes the room left in a card or column, so it sits in the middle of it. */
  fill?: boolean;
}

/**
 * What a list, a table or a page shows when there is nothing to show (see .empty-state in
 * controls.css): a title, a line saying why, and the next step. Not announced: it is
 * where the content would have been.
 */
export function EmptyState({
  title,
  titleAs: TitleTag = "p",
  titleId,
  icon,
  action,
  framed,
  fill,
  className,
  children,
  ...rest
}: EmptyStateProps) {
  return (
    <div className={cx("empty-state", framed && "empty-state--framed", fill && "empty-state--fill", className)} {...rest}>
      {icon}
      {title ? (
        <TitleTag className="empty-state__title" id={titleId}>
          {title}
        </TitleTag>
      ) : null}
      {children ? <div className="empty-state__text">{children}</div> : null}
      {action}
    </div>
  );
}
