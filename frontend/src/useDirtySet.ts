import { useCallback, useState } from "react";

/**
 * The cells of a table with changes not yet saved, by key: `mark` adds or
 * takes one away as its state changes; `any` holds the screen back from
 * moving on while one is unsaved.
 */
export function useDirtySet() {
  const [keys, setKeys] = useState<string[]>([]);
  function mark(key: string, dirty: boolean) {
    setKeys((current) =>
      dirty ? (current.includes(key) ? current : [...current, key]) : current.filter((item) => item !== key),
    );
  }
  /** Forgets every mark, for a screen whose cells are replaced by others. */
  const clear = useCallback(() => setKeys((current) => (current.length ? [] : current)), []);
  return { any: keys.length > 0, mark, clear };
}
