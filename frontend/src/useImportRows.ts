import { useState } from "react";

import { ApiError, getDataImportRows } from "./api";
import { keys } from "./queryKeys";
import { usePagedQuery } from "./usePagedQuery";

type RowParams = Omit<NonNullable<Parameters<typeof getDataImportRows>[1]>, "page" | "page_size">;

/**
 * One import's rows a page at a time. The page is the list's own (a review
 * shows several lists at once); a change of filter starts again at the
 * first, and a page emptied by the last change (its rows fixed or left out)
 * falls back to the first.
 */
export function usePagedRows(batchId: number, params: RowParams, pageSize: number) {
  const filters = JSON.stringify(params);
  const [paging, setPaging] = useState({ filters, page: 1 });
  const page = paging.filters === filters ? paging.page : 1;
  if (paging.filters !== filters) setPaging({ filters, page: 1 });
  const rows = usePagedQuery({
    queryKey: keys.imports.rowsPage(batchId, filters, page),
    // The last page stays on screen while the next loads - never another
    // filter's rows, which would show under the wrong heading.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[3] === filters ? previous : undefined),
    queryFn: () => getDataImportRows(batchId, { ...params, page, page_size: pageSize }),
    page,
    pageSize,
    onPage: (next) => setPaging({ filters, page: next }),
  });
  if (page > 1 && rows.query.error instanceof ApiError && rows.query.error.status === 404) {
    setPaging({ filters, page: 1 });
  }
  return rows;
}
