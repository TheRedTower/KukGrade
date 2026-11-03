import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getSetAsideNames, putBackSetAsideName, setAsideNames } from "./api";

/** Where an earlier version kept them, in the browser; moved to the server once. */
const OLD_STORAGE_KEY = "kukgrade-left-names";

function takeOldNames(): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(OLD_STORAGE_KEY) ?? "[]");
    window.localStorage.removeItem(OLD_STORAGE_KEY);
    return Array.isArray(stored) ? stored.filter((key): key is string => typeof key === "string").slice(-100) : [];
  } catch {
    return [];
  }
}

/**
 * Names on the linking page put aside for now: the viewer's own note of what
 * to come back to, kept on the server, so it follows them and leaves no
 * names in the browser. The lists it filters are asked for again on a change.
 */
export function useLeftNames() {
  const queryClient = useQueryClient();
  const names = useQuery({ queryKey: ["setAsideNames"], queryFn: getSetAsideNames });

  function changed(keys?: string[]) {
    if (keys) queryClient.setQueryData(["setAsideNames"], keys);
    else void queryClient.invalidateQueries({ queryKey: ["setAsideNames"] });
    void queryClient.invalidateQueries({ queryKey: ["legacyPeople"] });
  }

  const leave = useMutation({ mutationFn: (key: string) => setAsideNames([key]), onSuccess: changed });
  const putBack = useMutation({ mutationFn: (key: string) => putBackSetAsideName(key), onSuccess: () => changed() });
  const moveOld = useMutation({ mutationFn: (keys: string[]) => setAsideNames(keys), onSuccess: changed });
  const moveOldNames = moveOld.mutate;

  useEffect(() => {
    const old = takeOldNames();
    if (old.length > 0) moveOldNames(old);
  }, [moveOldNames]);

  return {
    left: names.data ?? [],
    leave: leave.mutate,
    putBack: putBack.mutate,
  };
}
