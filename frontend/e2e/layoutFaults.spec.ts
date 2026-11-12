import { expect, test } from "@playwright/test";

import { findLayoutFaults } from "./overflow";

// The checks in findLayoutFaults pass on every screen, so this proves they
// still find something: one of each fault, on a page made to have them.
test("findLayoutFaults reports a split word, a ragged column, unstyled controls and a box that scrolls", async ({
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
  // A bare button is known by the grey Chrome and Firefox give it; WebKit
  // draws its own, so that check is proved in Chrome, which runs every screen.
  const bareButton = browserName === "chromium";
  expect(
    faults.some((f) => f.startsWith("a button has no style")),
    faults.join("\n"),
  ).toBe(bareButton);
  expect(faults).toHaveLength(bareButton ? 5 : 4);
});
