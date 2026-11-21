// @vitest-environment-options { "url": "https://localhost/" }
import { afterEach, describe, expect, it, vi } from "vitest";

import { logoutUser } from "./api";

const clear = (name: string) => {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; Path=/`;
};

/** The form token a write sends, from the cookie Django set. */
async function sentToken(): Promise<string | null> {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  await logoutUser();
  const [input, init] = fetchMock.mock.calls[0] as [Request | string, RequestInit | undefined];
  const headers = input instanceof Request ? input.headers : new Headers(init?.headers);
  return headers.get("X-CSRFToken");
}

describe("the form token", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clear("__Host-csrftoken");
    clear("csrftoken");
  });

  it("is read from the host-only cookie Django sets over HTTPS", async () => {
    document.cookie = "__Host-csrftoken=host-token; Secure; Path=/";
    expect(await sentToken()).toBe("host-token");
  });

  it("is read from the plain cookie over HTTP", async () => {
    document.cookie = "csrftoken=plain-token";
    expect(await sentToken()).toBe("plain-token");
  });

  it("prefers the host-only cookie when both are there", async () => {
    document.cookie = "csrftoken=planted";
    document.cookie = "__Host-csrftoken=host-token; Secure; Path=/";
    expect(await sentToken()).toBe("host-token");
  });
});
