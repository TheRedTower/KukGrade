import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SiteSettings } from "./api";
import { jsonResponse } from "./appTestSupport";
import { PasswordRequirements } from "./PasswordRequirements";

// Deliberately not the real policy: the checklist must follow whatever the
// server serves, keeping no rules of its own.
const served: SiteSettings = {
  club_name: "Test Club",
  password_policy: {
    min_length: 5,
    max_length: 6,
    character_rules: [
      { code: "two_digits", label: "Two numbers", pattern: "[0-9].*[0-9]" },
      { code: "hash", label: "A hash sign", pattern: "#" },
    ],
    checked_on_save: ["Not a commonly used password"],
  },
};

function renderWith(password: string) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, served)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PasswordRequirements password={password} />
    </QueryClientProvider>,
  );
}

function state(list: HTMLElement, label: string) {
  return within(list).getByText(label).closest("li")!.classList.contains("is-met");
}

describe("PasswordRequirements", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ticks off the served rules as the password is typed", async () => {
    renderWith("a1b2#");

    const list = await screen.findByRole("list", { name: "Password requirements" });
    expect(state(list, "5 to 6 characters")).toBe(true);
    expect(state(list, "Two numbers")).toBe(true);
    expect(state(list, "A hash sign")).toBe(true);
    expect(screen.getByText(/Checked when you save: not a commonly used password/)).toBeVisible();
  });

  it("shows what is still missing", async () => {
    renderWith("abcdefg");

    const list = await screen.findByRole("list", { name: "Password requirements" });
    expect(state(list, "5 to 6 characters")).toBe(false);
    expect(state(list, "Two numbers")).toBe(false);
    expect(within(list).getByText("Two numbers").closest("li")).toHaveTextContent("(not yet)");
  });

  it("counts characters as the server does, not UTF-16 units", async () => {
    // Six characters, seven UTF-16 units: inside a 5-6 limit.
    renderWith("12#ab\u{1F600}");

    const list = await screen.findByRole("list", { name: "Password requirements" });
    expect(state(list, "5 to 6 characters")).toBe(true);
  });
});
