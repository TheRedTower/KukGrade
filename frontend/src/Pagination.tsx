import type { ReactNode } from "react";

interface PaginationProps {
  /** Names the navigation for assistive technology. */
  label: string;
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  /** What is being shown, such as "Showing 1–10 of 390 events". */
  summary: ReactNode;
}

/** The page numbers to offer: the ends, the current page and its neighbours. */
function visiblePages(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const result: (number | "ellipsis")[] = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) result.push("ellipsis");
    result.push(page);
  });
  return result;
}

/** Page controls for every list: what is shown, then the pages, wrapping on a narrow screen. */
export function Pagination({ label, page, totalPages, onPage, summary }: PaginationProps) {
  return (
    <nav className="action-row pager" aria-label={label}>
      <span className="pager__summary">{summary}</span>
      {totalPages > 1 && (
      <div className="pager__buttons">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          ‹
        </button>
        {visiblePages(page, totalPages).map((entry, index) =>
          entry === "ellipsis" ? (
            <span key={`ellipsis-${index}`} aria-hidden="true">…</span>
          ) : (
            <button
              type="button"
              key={entry}
              className={entry === page ? "is-current" : undefined}
              aria-current={entry === page ? "page" : undefined}
              aria-label={`Page ${entry}`}
              onClick={() => onPage(entry)}
            >
              {entry}
            </button>
          ),
        )}
        <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
          ›
        </button>
      </div>
      )}
    </nav>
  );
}
