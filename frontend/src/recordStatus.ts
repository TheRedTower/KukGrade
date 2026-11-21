import { useParams } from "react-router-dom";

import { ApiError } from "./api";

/** Where a record's page is before it can show the record. */
export type RecordStatus = "missing" | "loading" | "failed";

/**
 * A record's id in the address: a whole number above nought, or null for
 * anything else. Number(), not parseInt: "12abc" is no record, not record 12.
 */
export function useIdParam(name = "id"): number | null {
  const value = Number(useParams()[name]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * What a record's page shows instead of the record, or null once it is
 * there: missing for a bad id (null) or a record the server does not have,
 * failed for any other refusal, loading until it arrives.
 */
export function recordStatus(
  id: number | string | null,
  query: { isPending: boolean; isError: boolean; error: unknown },
): RecordStatus | null {
  if (id === null) return "missing";
  if (query.error instanceof ApiError && query.error.status === 404) return "missing";
  if (query.isError) return "failed";
  if (query.isPending) return "loading";
  return null;
}
