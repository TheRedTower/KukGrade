export function ImportPager({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <div className="ix-table-foot">
      <span>
        Page {page} of {pages} · {total} in all
      </span>
      <div className="ix-actions">
        <button className="btn-ghost" disabled={page <= 1} type="button" onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className="btn-ghost" disabled={page >= pages} type="button" onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
