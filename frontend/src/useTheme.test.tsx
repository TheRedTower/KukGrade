import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "./useTheme";

/** A system colour scheme the test can switch, as the OS would. */
function stubSystemScheme(dark: boolean) {
  const listeners = new Set<() => void>();
  let matches = dark;
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query === "(prefers-color-scheme: dark)" ? matches : false;
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  return (next: boolean) => {
    matches = next;
    listeners.forEach((listener) => listener());
  };
}

function Shown() {
  return <p>{useTheme().resolvedTheme}</p>;
}

describe("ThemeProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("follows an OS switch in System mode with no theme control on screen", () => {
    const switchTo = stubSystemScheme(false);
    render(
      <ThemeProvider>
        <Shown />
      </ThemeProvider>,
    );
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    act(() => switchTo(true));

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByText("dark")).toBeInTheDocument();
  });

  it("keeps an explicit choice whatever the OS does", () => {
    window.localStorage.setItem("kukgrade-theme", "light");
    const switchTo = stubSystemScheme(false);
    render(
      <ThemeProvider>
        <Shown />
      </ThemeProvider>,
    );

    act(() => switchTo(true));

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});
