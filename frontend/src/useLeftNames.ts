import { useMutation, useQueryClient } from "@tanstack/react-query";

import { putBackSetAsideName, setAsideNames } from "./api";
import { keys } from "./queryKeys";

/**
 * Names on the linking page put aside for now: the viewer's own note of what
 * to come back to, kept on the server, so it follows them and leaves no
 * names in the browser. The lists it filters are asked for again on a change.
 */
export function useLeftNames() {
  const queryClient = useQueryClient();

  // The server filters the lists by what is aside, so they are asked for again.
  function changed() {
    void queryClient.invalidateQueries({ queryKey: keys.legacyPeople.all() });
  }

  const leave = useMutation({ mutationFn: (key: string) => setAsideNames([key]), onSuccess: changed });
  const putBack = useMutation({ mutationFn: (key: string) => putBackSetAsideName(key), onSuccess: changed });
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
