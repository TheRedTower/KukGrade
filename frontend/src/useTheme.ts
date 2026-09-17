import { useCallback, useEffect, useState } from "react";

/**
 * "system" means no explicit choice has been made: the page follows
 * prefers-color-scheme automatically (see theme.css) and this hook exists
 * only to offer an override, not to own the default.
 */
export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "kukgrade-theme";

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // Private browsing or a blocked store: fall back to the system default.
  }
  return "system";
}

function applyPreference(preference: ThemePreference): void {
  if (preference === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", preference);
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useTheme(): {
  preference: ThemePreference;
  resolvedTheme: "light" | "dark";
  setTheme: (next: ThemePreference) => void;
} {
  const [preference, setPreference] = useState<ThemePreference>(readStoredPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange(event: MediaQueryListEvent) {
      setSystemDark(event.matches);
    }
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    applyPreference(preference);
  }, [preference]);

  const setTheme = useCallback((next: ThemePreference) => {
    setPreference(next);
    try {
      if (next === "system") {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      // The choice still applies for this page load via component state;
      // it just will not survive a reload.
    }
  }, []);

  const resolvedTheme: "light" | "dark" =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;

  return { preference, resolvedTheme, setTheme };
}
