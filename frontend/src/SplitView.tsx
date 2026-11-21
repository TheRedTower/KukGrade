import type { ReactNode } from "react";

/**
 * A page beside the list it was opened from, where there is room (a laptop):
 * the list on the left, the page on the right. Narrower, only the page shows,
 * and the list is its own page as ever (.split-view in layout.css).
 */
export function SplitView({ list, children }: { list: ReactNode; children: ReactNode }) {
  if (!list) return <>{children}</>;
  return (
    <div className="split-view">
      <div className="split-view__panes">
        <aside className="split-view__list">{list}</aside>
        <div className="split-view__page">{children}</div>
      </div>
    </div>
  );
}
