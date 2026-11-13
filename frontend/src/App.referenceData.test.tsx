import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";

import App from "./App";
import { authUser, fetchSignedInAs, stubFetch } from "./appTestSupport";

/** How many requests went to `path`, whatever their query. */
function calls(fetchMock: Mock, path: string): number {
  return fetchMock.mock.calls.filter(([url]) => new URL(String(url), "http://localhost").pathname === path).length;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/students");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("reads ranks, age bands and the site settings once a visit, and the records on every visit", async () => {
  const fetchMock = fetchSignedInAs(authUser);
  stubFetch(fetchMock);
  const user = userEvent.setup();
  render(<App />);
  const navigation = within(await screen.findByRole("navigation", { name: "Main navigation" }));
  await waitFor(() => expect(calls(fetchMock, "/api/students/")).toBe(1));

  for (const screenName of ["Syllabus", "Students", "Syllabus", "Students"]) {
    await user.click(navigation.getByRole("link", { name: screenName }));
    await screen.findByRole("heading", { level: 1, name: screenName });
  }

  await waitFor(() => expect(calls(fetchMock, "/api/students/")).toBe(3));
  expect(calls(fetchMock, "/api/ranks/")).toBe(1);
  expect(calls(fetchMock, "/api/syllabus/age-bands/")).toBe(1);
  expect(calls(fetchMock, "/api/site/")).toBe(1);
});

it("reads what is running again each time About opens, as it shows the database's state", async () => {
  const fetchMock = fetchSignedInAs(authUser);
  stubFetch(fetchMock);
  const user = userEvent.setup();
  render(<App />);
  const sidebar = within(await screen.findByRole("complementary", { name: "Sidebar" }));
  await waitFor(() => expect(calls(fetchMock, "/api/about/")).toBe(1));

  await user.click(sidebar.getByRole("link", { name: /^About/ }));
  await screen.findByRole("region", { name: "Version details" });
  await waitFor(() => expect(calls(fetchMock, "/api/about/")).toBe(2));
  await user.click(
    within(sidebar.getByRole("navigation", { name: "Main navigation" })).getByRole("link", { name: "Students" }),
  );
  await user.click(sidebar.getByRole("link", { name: /^About/ }));

  await waitFor(() => expect(calls(fetchMock, "/api/about/")).toBe(3));
});
