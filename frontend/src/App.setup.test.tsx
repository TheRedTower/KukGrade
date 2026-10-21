import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { authRequiredResponse, authUser, jsonResponse, signedInResponse } from "./appTestSupport";

const owner = {
  ...authUser,
  email: "owner@example.com",
  first_name: "Ada",
  last_name: "Owner",
  full_name: "Ada Owner",
  role_display: "Administrator",
};

const policy = {
  min_length: 16,
  max_length: 64,
  character_rules: [{ code: "number", label: "A number", pattern: "[0-9]" }],
  checked_on_save: [],
};

/** A new deployment: nobody signed in, setup needed until the POST succeeds. */
function newDeployment(onSetup: (body: Record<string, string>) => Response) {
  let signedIn = false;
  return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("/api/setup/") && init?.method === "POST") {
      const response = onSetup(JSON.parse(init.body as string));
      signedIn = response.ok;
      return response;
    }
    if (url.includes("/api/setup/")) return jsonResponse(200, { setup_needed: true });
    if (url.includes("/api/site/")) {
      return jsonResponse(200, {
        club_name: "Test Club",
        time_zone: "Europe/London",
        password_policy: policy,
        wksa_id: { hint: "", forms: [] },
      });
    }
    return signedIn ? signedInResponse(url, owner) : authRequiredResponse();
  });
}

async function fillIn(user: ReturnType<typeof userEvent.setup>, password = "First-Admin-Pass-2026!") {
  await user.type(screen.getByLabelText("Setup code"), "kcq7-abcd-efgh");
  await user.type(screen.getByLabelText("Email address"), "owner@example.com");
  await user.type(screen.getByLabelText("First name"), "Ada");
  await user.type(screen.getByLabelText("Last name"), "Owner");
  await user.type(screen.getByLabelText("Password"), password);
  await user.type(screen.getByLabelText("Confirm password"), "First-Admin-Pass-2026!");
}

describe("First-time setup", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/students");
    document.cookie = "csrftoken=test-csrf-token";
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("shows only the setup page, on any path, until it is done", async () => {
    vi.stubGlobal("fetch", newDeployment(() => jsonResponse(500, {})));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Set up KukGrade" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /Sign in|Welcome back/ })).not.toBeInTheDocument();
    expect(screen.getByText("Display theme")).toBeVisible();
    expect(await screen.findByRole("list", { name: "Password requirements" })).toBeVisible();
  });

  it("lets the first choice of theme stick", async () => {
    vi.stubGlobal("fetch", newDeployment(() => jsonResponse(500, {})));
    const user = userEvent.setup();

    render(<App />);
    const theme = await screen.findByRole("group", { name: "Theme" });
    await user.click(within(theme).getByRole("button", { name: "Dark" }));

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem("kukgrade-theme")).toBe("dark");
  });

  it("creates the administrator and opens KukGrade signed in", async () => {
    const sent: Record<string, string>[] = [];
    const fetchMock = newDeployment((body) => {
      sent.push(body);
      return jsonResponse(201, owner);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { name: "Set up KukGrade" });
    await fillIn(user);
    await user.click(screen.getByRole("button", { name: "Create administrator" }));

    expect(await screen.findByRole("link", { name: "Ada Owner, Administrator: your account" })).toBeVisible();
    expect(sent).toEqual([
      {
        code: "kcq7-abcd-efgh",
        email: "owner@example.com",
        first_name: "Ada",
        last_name: "Owner",
        password: "First-Admin-Pass-2026!",
      },
    ]);
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect((post![1] as RequestInit).headers).toBeInstanceOf(Headers);
    expect(((post![1] as RequestInit).headers as Headers).get("X-CSRFToken")).toBe(
      "test-csrf-token",
    );
  });

  it("puts the server's refusal beside the field it is about", async () => {
    vi.stubGlobal(
      "fetch",
      newDeployment(() =>
        jsonResponse(400, {
          error: {
            code: "validation_error",
            message: "That setup code is not right. Use the one in the server's log.",
            fields: { code: ["That setup code is not right. Use the one in the server's log."] },
          },
        }),
      ),
    );
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { name: "Set up KukGrade" });
    await fillIn(user);
    await user.click(screen.getByRole("button", { name: "Create administrator" }));

    expect(
      await screen.findByText("That setup code is not right. Use the one in the server's log."),
    ).toBeVisible();
    expect(screen.getByLabelText("Setup code")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("heading", { name: "Set up KukGrade" })).toBeVisible();
  });

  it("checks the confirmation before sending anything", async () => {
    const fetchMock = newDeployment(() => jsonResponse(201, owner));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { name: "Set up KukGrade" });
    await fillIn(user, "Different-Pass-2026!");
    await user.click(screen.getByRole("button", { name: "Create administrator" }));

    expect(await screen.findByText("The passwords do not match.")).toBeVisible();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("never asks a signed-in visitor", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async (url: string) => signedInResponse(url, authUser));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() => expect(screen.getByText("Casey Instructor")).toBeVisible());
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/setup/"))).toBe(
      false,
    );
  });
});
