import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { smoothly } from "./smoothly";
import { SmoothNavLink } from "./SmoothNavLink";

type Update = () => void | Promise<void>;

/** A browser with view transitions: records each one and the promise its update returned. */
function withViewTransitions() {
  const finished: Promise<void>[] = [];
  const start = vi.fn((update: Update) => {
    finished.push(Promise.resolve(update()));
    return {} as ViewTransition;
  });
  Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
  return { start, finished };
}

function reducedMotion(reduce: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) => ({ matches: reduce && query.includes("reduce"), media: query }) as MediaQueryList,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "startViewTransition");
});

describe("smoothly", () => {
  it("makes the change at once where the browser has no view transitions", () => {
    const change = vi.fn();
    smoothly(change);
    expect(change).toHaveBeenCalledOnce();
  });

  it("makes the change inside a view transition where the browser has them", () => {
    reducedMotion(false);
    const { start } = withViewTransitions();
    const change = vi.fn();
    smoothly(change);
    expect(start).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledOnce();
  });

  it("makes the change at once for a person who asked for reduced motion", () => {
    reducedMotion(true);
    const { start } = withViewTransitions();
    const change = vi.fn();
    smoothly(change);
    expect(start).not.toHaveBeenCalled();
    expect(change).toHaveBeenCalledOnce();
  });
});

function Tabs() {
  return (
    <MemoryRouter initialEntries={["/settings/account"]}>
      <SmoothNavLink to="/settings/account">Account</SmoothNavLink>
      <SmoothNavLink to="/settings/appearance">Appearance</SmoothNavLink>
      <Routes>
        <Route element={<h1>Account page</h1>} path="/settings/account" />
        <Route element={<h1>Appearance page</h1>} path="/settings/appearance" />
      </Routes>
    </MemoryRouter>
  );
}

describe("SmoothNavLink", () => {
  it("goes to its page, and the transition waits until that page is shown", async () => {
    reducedMotion(false);
    const { start, finished } = withViewTransitions();
    render(<Tabs />);

    await userEvent.click(screen.getByRole("link", { name: "Appearance" }));

    expect(start).toHaveBeenCalledOnce();
    await act(() => finished[0]);
    expect(screen.getByRole("heading", { name: "Appearance page" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Appearance" })).toHaveAttribute("aria-current", "page");
  });

  it("leaves a click on the page already shown, or one that opens a new tab, to the link", async () => {
    reducedMotion(false);
    const { start } = withViewTransitions();
    // jsdom cannot open a new tab; stop the browser's own follow after the link has had its say.
    const stay = (event: Event) => event.preventDefault();
    document.addEventListener("click", stay);
    render(<Tabs />);

    await userEvent.click(screen.getByRole("link", { name: "Account" }));
    const user = userEvent.setup();
    await user.keyboard("{Meta>}");
    await user.click(screen.getByRole("link", { name: "Appearance" }));
    await user.keyboard("{/Meta}");
    document.removeEventListener("click", stay);

    expect(start).not.toHaveBeenCalled();
  });

  it("still goes to its page where the browser has no view transitions", async () => {
    render(<Tabs />);
    await userEvent.click(screen.getByRole("link", { name: "Appearance" }));
    expect(await screen.findByRole("heading", { name: "Appearance page" })).toBeInTheDocument();
  });
});
