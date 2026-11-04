import type { ReactNode, Ref } from "react";

import { BackLink } from "./BackLink";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";

interface PageHeaderProps {
  title: ReactNode;
  /** The h1's id, for the page's aria-labelledby. */
  titleId: string;
  /** One line under the title saying what the page is for. */
  subtitle?: ReactNode;
  /** A short line above the title, such as the area the page is in. */
  eyebrow?: string;
  /** Beside the title: a small badge, such as who the page is for. */
  tag?: ReactNode;
  /** The page above this one, as a link back. */
  back?: { to: string; label: string };
  /** The trail above the title, for a page deeper than one level. */
  crumbs?: Crumb[];
  /** The page's own buttons, at the end of the title row. */
  actions?: ReactNode;
  /** For a page that moves focus to its title. */
  titleRef?: Ref<HTMLHeadingElement>;
  /** Anything else under the subtitle, such as the page's key facts. */
  children?: ReactNode;
}

/**
 * Every page's title area (see .page-header in layout.css): one title size,
 * one subtitle style, one place for a way back and for the page's buttons.
 */
export function PageHeader({ title, titleId, subtitle, eyebrow, tag, back, crumbs, actions, titleRef, children }: PageHeaderProps) {
  return (
    <header className={`page-header${back || crumbs ? "" : " page-header--bare"}`}>
      {back ? <BackLink to={back.to}>{back.label}</BackLink> : null}
      {crumbs ? <Breadcrumbs items={crumbs} /> : null}
      <div className="page-header__row">
        <div className="page-header__text">
          {eyebrow ? <p className="page-header__eyebrow">{eyebrow}</p> : null}
          <div className="page-header__title-row">
            <h1 className="page-header__title" id={titleId} ref={titleRef} tabIndex={titleRef ? -1 : undefined}>
              {title}
            </h1>
            {tag}
          </div>
          {subtitle ? <p className="page-header__subtitle">{subtitle}</p> : null}
          {children}
        </div>
        {actions ? <div className="page-header__actions">{actions}</div> : null}
      </div>
    </header>
  );
}
