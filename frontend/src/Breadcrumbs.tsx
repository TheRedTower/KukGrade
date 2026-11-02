import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export interface Crumb {
  label: ReactNode;
  /** Where it goes. The last crumb has none: it is the page you are on. */
  to?: string;
}

/**
 * The trail of links above a page title (see .crumbs in layout.css). Every link is a real
 * link, so it opens in a new tab; the last one names the current page.
 */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumbs" className={className ? `crumbs ${className}` : "crumbs"}>
      {items.map((item, index) => (
        <span className="crumbs__item" key={index}>
          {index > 0 ? (
            <span className="crumbs__sep" aria-hidden="true">
              /
            </span>
          ) : null}
          {item.to ? <Link to={item.to}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}
