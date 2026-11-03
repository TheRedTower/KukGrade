import { Pagination } from "./Pagination";

/** The shared page controls, at the foot of an import list's card. */
export function ImportPager({
  label,
  page,
  pages,
  total,
  onPage,
}: {
  label: string;
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <div className="ix-table-foot">
      <Pagination label={label} page={page} totalPages={pages} onPage={onPage} summary={`${total} in all`} />
    </div>
  );
}
