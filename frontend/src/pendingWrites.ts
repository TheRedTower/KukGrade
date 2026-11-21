import type { MutationFilters, QueryClient } from "@tanstack/react-query";

/**
 * Sent on the window as a sign-out begins, before the session ends: a screen
 * holding work not yet saved starts its save, which sign-out then waits for.
 */
export const SIGNING_OUT_EVENT = "kukgrade:signing-out";

/**
 * Resolves once no write matching `filters` is waiting or on its way, or
 * after `timeoutMs` if given, so a write that cannot be sent (no network)
 * never holds the caller for good.
 */
export function writesLanded(queryClient: QueryClient, filters: MutationFilters, timeoutMs?: number): Promise<void> {
  const cache = queryClient.getMutationCache();
  const busy = () => cache.findAll({ ...filters, status: "pending" }).length > 0;
  if (!busy()) return Promise.resolve();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      unsubscribe();
      clearTimeout(timer);
      resolve();
    };
    const unsubscribe = cache.subscribe(() => {
      if (!busy()) done();
    });
    if (timeoutMs !== undefined) timer = setTimeout(done, timeoutMs);
  });
}

/**
 * Marks a write that saves work in the background, which signing out must
 * let land first (`meta` on the mutation). Writes the viewer started and is
 * waiting on need no mark: a sign-out wrapped in one must not wait for itself.
 */
export const LANDS_BEFORE_SIGN_OUT = { landsBeforeSignOut: true };

/** The writes marked with LANDS_BEFORE_SIGN_OUT. */
export const landingBeforeSignOut: MutationFilters = {
  predicate: (mutation) => mutation.options.meta?.landsBeforeSignOut === true,
};
