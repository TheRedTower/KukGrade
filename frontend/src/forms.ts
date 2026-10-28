import { useCallback, useState } from "react";

import { ApiError, errorMessage } from "./api";

/** What a person sees when a request never reached the server. */
export const NETWORK_ERROR = "A network error occurred. Please check your connection.";

/** The line to show for any failed request: the server's reason, or the network error. */
export function failureMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? errorMessage(err, fallback) : NETWORK_ERROR;
}

export interface ServerErrors {
  /** Messages for the fields the form shows, keyed by field name. */
  fields: Record<string, string[]>;
  /** What belongs above the form: whatever the server said that no shown field can carry. */
  banner: string | null;
}

/**
 * Splits a failed request into what to show beside each field and what to show
 * above the form. Anything the form has no place for (a problem with the request
 * as a whole, or with a field it does not show) goes in the banner, so a server
 * error is never left unsaid.
 */
export function splitServerErrors(err: unknown, shown: readonly string[], fallback: string): ServerErrors {
  if (!(err instanceof ApiError)) return { fields: {}, banner: NETWORK_ERROR };

  const fields: Record<string, string[]> = {};
  const rest: string[] = [];
  for (const [name, value] of Object.entries(err.fields ?? {})) {
    const messages = Array.isArray(value) ? value.filter((message): message is string => typeof message === "string") : [];
    if (messages.length === 0) continue;
    if (shown.includes(name)) fields[name] = messages;
    else rest.push(...messages);
  }
  if (rest.length > 0) return { fields, banner: rest.join(" ") };
  if (Object.keys(fields).length > 0) return { fields, banner: null };
  return { fields, banner: errorMessage(err, fallback) };
}

/** The field errors and banner of one form, filled from the browser's own checks or from the server. */
export function useServerForm(shown: readonly string[]) {
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [banner, setBanner] = useState<string | null>(null);

  const reset = useCallback(() => {
    setFields({});
    setBanner(null);
  }, []);

  /** Checks the browser made: field messages only. */
  const setClientErrors = useCallback((errors: Record<string, string[]>) => {
    setFields(errors);
    setBanner(null);
  }, []);

  /** A failed request: pass this as a mutation's onError. */
  const key = shown.join("|");
  const handle = useCallback(
    (err: unknown, fallback: string) => {
      const split = splitServerErrors(err, key.split("|"), fallback);
      setFields(split.fields);
      setBanner(split.banner);
    },
    [key],
  );

  const errorFor = useCallback((field: string): string | null => fields[field]?.[0] ?? null, [fields]);

  return { fields, banner, errorFor, reset, setClientErrors, handle };
}
