import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

import { smoothly } from "./smoothly";
import { useMediaQuery } from "./useMediaQuery";

/**
 * "system" means no explicit choice has been made: the page follows
 * prefers-color-scheme. Whatever the preference, the resolved theme is
 * always written to `<html data-theme>`, so a component's
 * `[data-theme="dark"] .x` override applies in System mode on a dark OS as
 * it does after an explicit Dark choice. index.html writes it before first
 * paint; ThemeProvider, mounted at the app root, keeps it current on every
 * screen, so an OS switch in System mode shows at once.
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

type Theme = {
  preference: ThemePreference;
  resolvedTheme: "light" | "dark";
  setTheme: (next: ThemePreference) => void;
};

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(readStoredPreference);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");

  const setTheme = useCallback((next: ThemePreference) => {
    // The page fades from one theme to the other (smoothly.ts).
    smoothly(() => setPreference(next));
    try {
      if (next === "system") {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      // The choice still applies for this page load; it just will not
      // survive a reload.
    }
  }, []);

  const resolvedTheme: "light" | "dark" = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  // Before the browser paints, so the picture of the new look has the new theme.
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

  const value = useMemo(() => ({ preference, resolvedTheme, setTheme }), [preference, resolvedTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme needs a ThemeProvider above it.");
  return theme;
}
