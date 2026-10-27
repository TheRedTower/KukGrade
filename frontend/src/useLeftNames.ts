import { useState } from "react";

/**
 * Names on the linking page put aside for now. Per browser, like the
 * theme: a personal note about what to come back to, not data the club keeps.
 * The page sends these to the server as group keys, which accepts at most
 * this many, so the oldest drop off first.
 */
const STORAGE_KEY = "kukgrade-left-names";
const LEFT_NAMES_LIMIT = 100;

function read(): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

export function useLeftNames() {
  const [left, setLeft] = useState(read);

  function save(next: string[]) {
    setLeft(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // It still applies for this page load; it just will not be remembered.
    }
  }

  return {
    left,
    leave: (key: string) => save([...left.filter((other) => other !== key), key].slice(-LEFT_NAMES_LIMIT)),
    putBack: (key: string) => save(left.filter((other) => other !== key)),
  };
}
