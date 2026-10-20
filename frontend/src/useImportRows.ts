import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { ApiError, getDataImportRows } from "./api";

type RowParams = Omit<NonNullable<Parameters<typeof getDataImportRows>[1]>, "page" | "page_size">;

/**
 * One import's rows a page at a time. A change of filter starts again at the
 * first page, and a page emptied by the last change (its rows fixed or left
 * out) falls back to the first.
 */
export function usePagedRows(batchId: number, params: RowParams, pageSize: number) {
  const filters = JSON.stringify(params);
  const [paging, setPaging] = useState({ filters, page: 1 });
  const page = paging.filters === filters ? paging.page : 1;
  const query = useQuery({
    queryKey: ["imports", "rows", batchId, filters, page],
    // The last page stays on screen while the next loads - never another
    // filter's rows, which would show under the wrong heading.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[3] === filters ? previous : undefined,
    queryFn: () => getDataImportRows(batchId, { ...params, page, page_size: pageSize }),
  });
  if (page > 1 && query.error instanceof ApiError && query.error.status === 404) {
    setPaging({ filters, page: 1 });
  }

  const total = query.data?.count ?? 0;
  return {
    query,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    total,
    setPage: (next: number) => setPaging({ filters, page: next }),
  };
}
