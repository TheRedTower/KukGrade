import type { ReactNode } from "react";

/**
 * One setting: its name and a plain line on the left, its control on
 * the right. A row can carry more underneath, such as a form it opens.
 */
export function SettingsRow({
  title,
  description,
  htmlFor,
  children,
  below,
}: {
  title: string;
  description?: ReactNode;
  htmlFor?: string;
  children?: ReactNode;
  below?: ReactNode;
}) {
  return (
    <div className="st-row">
      <div className="st-row-label">
        {htmlFor ? (
          <label className="st-row-title" htmlFor={htmlFor}>
            {title}
          </label>
        ) : (
          <p className="st-row-title">{title}</p>
        )}
        {description ? <p className="st-row-description">{description}</p> : null}
      </div>
      {children ? <div className="st-row-control">{children}</div> : null}
      {below ? <div className="st-row-below">{below}</div> : null}
    </div>
  );
}
