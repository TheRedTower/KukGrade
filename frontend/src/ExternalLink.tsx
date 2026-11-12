import type { ReactNode } from "react";

/**
 * A link out of KukGrade (GitHub, a credit's homepage): it opens in a new
 * tab, keeps this page from being reached through it, and says so to a
 * screen reader.
 */
export function ExternalLink({
  href,
  className,
  title,
  "aria-label": ariaLabel,
  children,
}: {
  href: string;
  className?: string;
  title?: string;
  /** For an icon-only link; say "(opens in a new tab)" in it too. */
  "aria-label"?: string;
  children: ReactNode;
}) {
  return (
    <a aria-label={ariaLabel} className={className} href={href} rel="noopener noreferrer" target="_blank" title={title}>
      {children}
      {ariaLabel ? null : <span className="visually-hidden"> (opens in a new tab)</span>}
    </a>
  );
}
