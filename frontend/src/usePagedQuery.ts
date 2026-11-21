import { type QueryKey, type UseQueryOptions, useQuery } from "@tanstack/react-query";

type Page = { count: number; results: unknown[] };

/** How many pages a list of `count` takes, never fewer than one. */
export function pageCount(count: number, pageSize: number): number {
  return Math.max(1, Math.ceil(count / pageSize));
}

/**
 * One page of a server list. The page is the caller's (the address, or a
 * list's own state); `pager` is what `Pagination` needs.
 */
export function usePagedQuery<P extends Page>({
  queryKey,
  queryFn,
  page,
  pageSize,
  onPage,
  placeholderData,
  enabled,
}: {
  queryKey: QueryKey;
  queryFn: () => Promise<P>;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  placeholderData?: UseQueryOptions<P>["placeholderData"];
  enabled?: boolean;
}) {
  const query = useQuery({ queryKey, queryFn, placeholderData, enabled });
  const count = query.data?.count ?? 0;
  return {
    query,
    results: (query.data?.results ?? []) as P["results"],
    count,
    pages: pageCount(count, pageSize),
    pager: { page, pageSize, count, onPage },
  };
}
