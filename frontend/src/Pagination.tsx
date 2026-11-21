import { counted } from "./plural";
import { pageCount } from "./usePagedQuery";
import { cx } from "./cx";

interface PaginationProps {
  /** Names the navigation for assistive technology. */
  label: string;
  /** What the list holds, one and many: ["student", "students"]. */
  noun: [string, string];
  page: number;
  pageSize: number;
  count: number;
  onPage: (page: number) => void;
  /** At the foot of a flush card: its own padding and a rule above. */
  flush?: boolean;
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

/**
 * Page controls for every list: what is shown ("Showing 1–10 of 390
 * events"), then the pages, wrapping on a narrow screen. Nothing when the
 * list is empty; no page buttons when it fits on one.
 */
export function Pagination({ label, noun, page, pageSize, count, onPage, flush = false }: PaginationProps) {
  if (count === 0) return null;
  const totalPages = pageCount(count, pageSize);
  const from = Math.min((page - 1) * pageSize + 1, count);
  const to = Math.min(page * pageSize, count);
  return (
    <nav className={cx("action-row pager", flush && "pager--foot")} aria-label={label}>
      <span>
        Showing {from}–{to} of {counted(count, ...noun)}
      </span>
      {totalPages > 1 && (
        <div className="pager__buttons">
          <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
            ‹
          </button>
          {visiblePages(page, totalPages).map((entry, index) =>
            entry === "ellipsis" ? (
              <span key={`ellipsis-${index}`} aria-hidden="true">
                …
              </span>
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
