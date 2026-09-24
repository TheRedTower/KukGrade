// DOM matchers (toBeInTheDocument, toHaveFocus, ...) for every test file.
import "@testing-library/jest-dom/vitest";

// This jsdom build does not implement localStorage either (window.localStorage
// is undefined, not throwing) - both auth.tsx and useTheme.ts already treat a
// throwing localStorage as "unavailable, fall back gracefully", but a
// genuinely missing property needs something to call methods on at all.
if (!window.localStorage) {
  const store = new Map<string, string>();
  window.localStorage = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

// jsdom does not implement matchMedia. useTheme.ts calls it unconditionally
// (to read the system colour-scheme preference and watch it for changes),
// so every test that renders anything using that hook needs this present.
// Defaults to "no dark preference matched" - a test that needs to exercise
// the system-dark branch stubs this itself.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
