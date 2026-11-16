import { expect, test } from "@playwright/test";

import { findChoicesLostOnHover, findCoveredBars, findLayoutFaults } from "./overflow";

// The checks in findLayoutFaults pass on every screen, so this proves they
// still find something: one of each fault, on a page made to have them.
test("findLayoutFaults reports a split word, a ragged column, unstyled controls, a box that scrolls, a row with a gap and a lost layout", async ({
  page,
  browserName,
}) => {
  await page.setContent(`<body style="width: 300px">
    <table>
      <thead><tr><th>Name</th></tr></thead>
      <tbody>
        <tr><td><span>Alex</span></td></tr>
        <tr><td><span style="margin-left: 6px">Ian</span></td></tr>
      </tbody>
    </table>
    <a href="/somewhere">a link</a> <button>A button</button>
    <p style="width: 60px; overflow-wrap: anywhere">Administrator</p>
    <div class="trap" style="height: 40px; overflow-y: auto"><div style="height: 200px"></div></div>
    <div class="tiles" style="display: grid; grid-template-columns: 1fr 1fr"><i>a</i><i>b</i><i>c</i></div>
    <div class="lost" style="gap: 8px"><i>d</i></div>
  </body>`);
  const faults = await findLayoutFaults(page);
  expect(
    faults.some((f) => f.includes('split across lines: "Administrator"')),
    faults.join("\n"),
  ).toBe(true);
  expect(
    faults.some((f) => f.includes('does not start at one edge: "Name"')),
    faults.join("\n"),
  ).toBe(true);
  expect(
    faults.some((f) => f.startsWith("a link has no style")),
    faults.join("\n"),
  ).toBe(true);
  expect(
    faults.some((f) => f.startsWith("a box scrolls inside the page: div.trap")),
    faults.join("\n"),
  ).toBe(true);
  expect(
    faults.some((f) => f.startsWith("a row ends in a gap: div.tiles")),
    faults.join("\n"),
  ).toBe(true);
  expect(
    faults.some((f) => f.startsWith("a gap on a box that is not a grid or flex: div.lost")),
    faults.join("\n"),
  ).toBe(true);
  // A bare button is known by the grey Chrome and Firefox give it; WebKit
  // draws its own, so that check is proved in Chrome, which runs every screen.
  const bareButton = browserName === "chromium";
  expect(
    faults.some((f) => f.startsWith("a button has no style")),
    faults.join("\n"),
  ).toBe(bareButton);
  expect(faults).toHaveLength(bareButton ? 7 : 6);
});

test("findCoveredBars reports what is drawn over a bar at the foot of the window, and passes a bar on top", async ({
  page,
}) => {
  const body = (bar: string) => `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
  <body style="margin: 0">
    <div style="height: 2000px">
      <button class="leak" style="position: relative; z-index: 1; margin-top: 900px; height: 60px">Pass</button>
    </div>
    <footer class="bar" style="position: sticky; bottom: 0; height: 80px; background: white; ${bar}">Record</footer>
  </body>`;
  await page.setViewportSize({ width: 400, height: 600 });
  await page.setContent(body(""));
  const faults = await findCoveredBars(page);
  expect(faults.join("\n")).toContain("drawn over the bar at the foot of the window (footer.bar");
  expect(faults.join("\n")).toContain("button.leak");
  expect(await page.evaluate(() => window.scrollY), "the page is left at the top").toBe(0);

  await page.setContent(body("z-index: 3"));
  expect(await findCoveredBars(page)).toEqual([]);
});

test("findChoicesLostOnHover reports a chosen control repainted under the pointer, and passes one that keeps its colours", async ({
  page,
}) => {
  await page.setContent(`<!doctype html><body>
    <style>
      button { border: 1px solid rgb(0, 128, 0); background: rgb(0, 128, 0); color: rgb(255, 255, 255); }
      .lost:hover { background: rgb(40, 40, 40); }
      .kept:hover { outline: 2px solid rgb(0, 0, 0); }
      a { color: rgb(200, 150, 0); }
      a:hover { background: rgb(240, 240, 240); }
    </style>
    <button class="lost" aria-pressed="true" data-tone="success">Met</button>
    <button class="kept" aria-pressed="true" data-tone="success">Pass</button>
    <a href="#here" aria-current="page">Here</a>
  </body>`);
  const faults = await findChoicesLostOnHover(page);
  expect(faults, faults.join("\n")).toHaveLength(1);
  expect(faults[0]).toContain("loses its fill under the pointer: button.lost");
});
