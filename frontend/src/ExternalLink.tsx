import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * A link that opens in a new tab: out of KukGrade (GitHub, a credit's
 * homepage, `href`), or to a page of KukGrade kept beside this one (`to`). It
 * keeps this page from being reached through the new tab, and says so to a
 * screen reader.
 */
export function ExternalLink({
  className,
  title,
  "aria-label": ariaLabel,
  children,
  ...place
}: ({ href: string; to?: never } | { to: string; href?: never }) & {
  className?: string;
  title?: string;
  /** For an icon-only link; say "(opens in a new tab)" in it too. */
  "aria-label"?: string;
  children: ReactNode;
}) {
  const shared = { "aria-label": ariaLabel, className, rel: "noopener noreferrer", target: "_blank", title };
  const content = (
    <>
      {children}
      {ariaLabel ? null : <span className="visually-hidden"> (opens in a new tab)</span>}
    </>
  );
  return place.to !== undefined ? (
    <Link {...shared} to={place.to}>
      {content}
    </Link>
  ) : (
    <a {...shared} href={place.href}>
      {content}
    </a>
  );
}
