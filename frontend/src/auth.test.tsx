import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getStudents } from "./api";
import { AuthProvider, useAuth } from "./auth";

const authUser = {
  id: "7d3c55f4-e9e7-4b2b-b5d0-5fc9e899df17",
  email: "casey@example.com",
  first_name: "Casey",
  last_name: "Instructor",
  role: "INSTRUCTOR",
};

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function SignOutButton() {
  const { user, logout } = useAuth();
  return (
    <>
      <span>{user ? user.email : "anonymous"}</span>
      <button onClick={() => void logout()}>Sign out</button>
    </>
  );
}

function ExpiringRead() {
  useQuery({
    queryKey: ["students", "expiring"],
    queryFn: () => getStudents(),
    retry: false,
  });
  return null;
}

async function renderSignedIn(children: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>,
  );
  await screen.findByText(authUser.email);
  queryClient.setQueryData(["students", "all"], { results: [{ id: 1 }] });
  return queryClient;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ending a session", () => {
  it("drops everything fetched under it when the viewer signs out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) =>
        url.includes("/api/auth/logout/") ? response(204, undefined) : response(200, authUser),
      ),
    );
    const queryClient = await renderSignedIn(<SignOutButton />);

    await act(async () => screen.getByRole("button", { name: "Sign out" }).click());

    await waitFor(() => expect(screen.getByText("anonymous")).toBeVisible());
    expect(queryClient.getQueryData(["students", "all"])).toBeUndefined();
  });

  it("drops it too when the server says the session has expired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/auth/me/")) return response(200, authUser);
        return response(401, {});
      }),
    );
    const queryClient = await renderSignedIn(<SignOutButton />);

    render(
      <QueryClientProvider client={queryClient}>
        <ExpiringRead />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(queryClient.getQueryData(["students", "all"])).toBeUndefined());
    expect(queryClient.getQueryData(["currentUser"])).toBeNull();
  });
});
