import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Whether the sidebar is a strip of icons (FDR-056). Per browser, like the
 * theme: a person's own habit, not the club's setting. One state shared by the
 * sidebar and the Appearance tab, so a change in either shows in both.
 */
const STORAGE_KEY = "kukgrade-sidebar";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "icons";
  } catch {
    return false;
  }
}

type Sidebar = { collapsed: boolean; setCollapsed: (next: boolean) => void };

const SidebarContext = createContext<Sidebar>({ collapsed: false, setCollapsed: () => {} });

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(readCollapsed);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    try {
      if (next) window.localStorage.setItem(STORAGE_KEY, "icons");
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // It still applies for this page load; it just will not be remembered.
    }
  }, []);

  const value = useMemo(() => ({ collapsed, setCollapsed }), [collapsed, setCollapsed]);
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSidebar(): Sidebar {
  return useContext(SidebarContext);
}
