import { render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import App from "./App";
import { authUser, fetchSignedInAs, stubFetch } from "./appTestSupport";

// The Markdown reader is loaded on its own; here it never arrives (a new
// release replaced the file, or the connection dropped).
vi.mock("./MarkdownText", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("says the text could not be loaded, rather than loading for ever, when the reader does not arrive", async () => {
  window.history.replaceState({}, "", "/settings/about/security");
  stubFetch(fetchSignedInAs(authUser));

  render(<App />);

  const text = within(await screen.findByRole("article", { name: "Security text" }));
  expect(await text.findByText("The text could not be loaded. Reload the page to try again.")).toBeVisible();
  expect(text.queryByText("Loading the text…")).not.toBeInTheDocument();
});
