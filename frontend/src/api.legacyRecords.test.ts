import { afterEach, expect, it, vi } from "vitest";

import { getAllLegacyGradingRecords } from "./api";
import { jsonResponse } from "./appTestSupport";

afterEach(() => vi.unstubAllGlobals());

it("reads every page of the server's historical name group within one import", async () => {
  const fetchMock = vi.fn().mockImplementation(async (rawUrl: string) => {
    const url = new URL(rawUrl);
    const page = Number(url.searchParams.get("page"));
    const results = page === 1
      ? Array.from({ length: 200 }, (_, index) => ({ id: index + 1 }))
      : [{ id: 201 }];
    return jsonResponse(200, {
      count: 201,
      next: page === 1 ? "?page=2" : null,
      previous: page === 2 ? "?page=1" : null,
      results,
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const group = await getAllLegacyGradingRecords({
    group_key: "zac w",
    batch: 7,
    linked: false,
    voided: false,
  });

  expect(group.results).toHaveLength(201);
  expect(group.results.at(-1)?.id).toBe(201);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [rawUrl] of fetchMock.mock.calls) {
    const url = new URL(rawUrl);
    expect(url.searchParams.get("group_key")).toBe("zac w");
    expect(url.searchParams.get("batch")).toBe("7");
    expect(url.searchParams.get("linked")).toBe("false");
    expect(url.searchParams.get("page_size")).toBe("200");
  }
});
