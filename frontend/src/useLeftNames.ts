import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { putBackSetAsideName, setAsideNames } from "./api";

/** Where an earlier version kept them, in the browser; moved to the server once. */
const OLD_STORAGE_KEY = "kukgrade-left-names";

function oldNames(): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(OLD_STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((key): key is string => typeof key === "string").slice(-100) : [];
  } catch {
    return [];
  }
}

function forgetOldNames() {
  try {
    window.localStorage.removeItem(OLD_STORAGE_KEY);
  } catch {
    // Nothing to forget, or the browser will not say.
  }
}

/**
 * Names on the linking page put aside for now: the viewer's own note of what
 * to come back to, kept on the server, so it follows them and leaves no
 * names in the browser. The lists it filters are asked for again on a change.
 */
export function useLeftNames() {
  const queryClient = useQueryClient();

  // The server filters the lists by what is aside, so they are asked for again.
  function changed() {
    void queryClient.invalidateQueries({ queryKey: ["legacyPeople"] });
  }

  const leave = useMutation({ mutationFn: (key: string) => setAsideNames([key]), onSuccess: changed });
  const putBack = useMutation({ mutationFn: (key: string) => putBackSetAsideName(key), onSuccess: changed });
  // Forgotten here only once the server has them; a failed move is tried
  // again the next time the page opens.
  const moveOld = useMutation({
    mutationFn: (keys: string[]) => setAsideNames(keys),
    onSuccess: () => {
      forgetOldNames();
      changed();
    },
  });
  const moveOldNames = moveOld.mutate;

  useEffect(() => {
    const old = oldNames();
    if (old.length > 0) moveOldNames(old);
  }, [moveOldNames]);

  return {
    leave: leave.mutate,
    putBack: putBack.mutate,
    /** The last leave or put back that failed, until the next one is tried. */
    error: leave.error ?? putBack.error,
    reset: () => {
      leave.reset();
      putBack.reset();
    },
  };
}
