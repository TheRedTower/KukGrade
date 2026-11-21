import { useSearchParams } from "react-router-dom";

type Value = string | number | boolean | null | undefined;

/**
 * A list's filters and page, kept in the address so a reload, a shared link
 * and the back button keep them. An empty value takes a filter away, and
 * changing a filter goes back to the first page.
 */
export function useUrlFilters() {
  const [params, setParams] = useSearchParams();

  function set(updates: Record<string, Value>) {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(updates)) {
      if (value === "" || value === null || value === undefined || value === false) next.delete(name);
      else next.set(name, String(value));
    }
    if (!("page" in updates)) next.delete("page");
    setParams(next, { replace: true });
  }

  return {
    /** A filter's value, "" when it is not set. */
    value: (name: string) => params.get(name) ?? "",
    /** One of `allowed`, or `fallback` when the address holds anything else. */
    oneOf: <T extends string>(name: string, allowed: readonly T[], fallback: T): T =>
      allowed.find((item) => item === params.get(name)) ?? fallback,
    page: Math.max(1, Number(params.get("page")) || 1),
    set,
    setPage: (page: number) => set({ page: page > 1 ? page : null }),
    /** The filters as an address query, for a link that keeps them. */
    query: params.toString(),
    /** Takes every filter named away (and the page). */
    clear: (...names: string[]) => set(Object.fromEntries(names.map((name) => [name, null]))),
  };
}
