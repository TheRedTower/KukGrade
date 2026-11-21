import type { Page } from "@playwright/test";

/**
 * What "does not fit" means, in one place. Reported, in the browser, for the
 * page as it is now:
 *  - the page itself scrolls sideways;
 *  - a box's content is wider than the box (it spills, is cut off, or sits in
 *    a sideways scroller);
 *  - something sits outside the screen;
 *  - a date input is wider than the box it sits in (iOS sizes them itself);
 *  - two boxes with a rounded border all round, one after the other (stacked
 *    or side by side), with no gap between them.
 * A deliberate sideways scroller carries data-scroll-ok (it and everything in
 * it is left alone); text meant to be shortened with an ellipsis, or the box a
 * popup menu opens from (the menu is a child, still checked against the screen),
 * carries data-clip-ok (only that element is left alone).
 */
export async function findOverflow(page: Page, width: number): Promise<string[]> {
  return page.evaluate((width) => {
    const found: { el: Element; why: string }[] = [];
    const culpritsExtra: string[] = [];
    let pageScrolls = "";
    // A mobile browser may widen its layout viewport to fit a too-wide page;
    // the width that was asked for is the one that counts.
    const screenWidth = Math.min(document.documentElement.clientWidth, width);
    const label = (el: Element): string => {
      const id = el.id ? `#${el.id}` : "";
      const cls = [...el.classList]
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join("");
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
      return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ""}`;
    };
    // Hidden on purpose: the visually-hidden class, or a box clipped to nothing
    // (a table's header row once its rows are cards).
    const hiddenOnPurpose = (el: Element) => {
      for (let up: Element | null = el; up; up = up.parentElement) {
        if (up.classList.contains("visually-hidden")) return true;
        if (getComputedStyle(up).clipPath.startsWith("inset(50%")) return true;
      }
      return false;
    };
    const skipped = (el: Element) => el.closest("[data-scroll-ok], svg") !== null || hiddenOnPurpose(el);

    if (document.documentElement.scrollWidth > screenWidth) {
      pageScrolls = `the page scrolls sideways (${document.documentElement.scrollWidth} > ${screenWidth})`;
    }
    for (const el of document.body.querySelectorAll("*")) {
      if (skipped(el)) continue;
      if (["INPUT", "SELECT", "TEXTAREA", "OPTION", "SCRIPT", "STYLE"].includes(el.tagName)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const html = el as HTMLElement;
      if (html.hasAttribute("data-clip-ok")) continue;
      const style = getComputedStyle(html);
      if (style.visibility === "hidden" || style.opacity === "0") continue;
      if (html.clientWidth > 2 && html.scrollWidth > html.clientWidth + 1) {
        const overflowX = style.overflowX;
        const how =
          overflowX === "visible"
            ? "spills out of"
            : overflowX === "auto" || overflowX === "scroll"
              ? "scrolls sideways inside"
              : "is cut off inside";
        found.push({ el, why: `content ${how} its box` });
      } else if (rect.right > screenWidth + 1 || rect.left < -1) {
        found.push({ el, why: "sits outside the screen" });
      }
    }
    for (const input of document.body.querySelectorAll('input[type="date"]')) {
      if (skipped(input)) continue;
      const box = (input.closest(".field") ?? input.parentElement)?.getBoundingClientRect();
      const rect = input.getBoundingClientRect();
      if (box && rect.width > 0 && rect.right > box.right + 1) {
        culpritsExtra.push(`a date input is wider than its box: ${label(input)}`);
      }
    }
    // A box drawn with a rounded border all round: a card, a filter bar. Two
    // of them, one after the other, need room between. A bar kept in view
    // (sticky or fixed) is left out: the page scrolls under it on purpose.
    const boxed = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.position === "sticky" || style.position === "fixed") return false;
      const sides = ["Top", "Right", "Bottom", "Left"] as const;
      return (
        sides.every(
          (side) =>
            parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 &&
            style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none",
        ) && parseFloat(style.borderTopLeftRadius) > 0
      );
    };
    for (const box of document.body.querySelectorAll("*")) {
      const next = box.nextElementSibling;
      if (!next || skipped(box) || skipped(next) || !boxed(box) || !boxed(next)) continue;
      const rect = box.getBoundingClientRect();
      const nextRect = next.getBoundingClientRect();
      if (rect.height === 0 || nextRect.height === 0) continue;
      const stacked = nextRect.top >= rect.top + rect.height / 2;
      const beside = !stacked && nextRect.left >= rect.left + rect.width / 2;
      const gap = stacked ? nextRect.top - rect.bottom : beside ? nextRect.left - rect.right : Infinity;
      if (gap < 1) culpritsExtra.push(`boxes touch with no gap: ${label(box)} / ${label(next)}`);
    }
    // Report the outermost culprit only; its children are the same fault.
    const culprits = found
      .filter(({ el }) => !found.some((other) => other.el !== el && other.el.contains(el)))
      .map(({ el, why }) => `${why}: ${label(el)}`)
      .slice(0, 12)
      .concat(culpritsExtra);
    if (!pageScrolls) return culprits;
    // The page is wider than the screen: name the innermost boxes that stick out.
    const sticking = [...document.body.querySelectorAll("*")].filter(
      (el) =>
        !skipped(el) && el.getBoundingClientRect().right > screenWidth + 1 && el.getBoundingClientRect().width > 0,
    );
    const innermost = sticking.filter((el) => !sticking.some((other) => other !== el && el.contains(other)));
    return [pageScrolls, ...innermost.slice(0, 5).map((el) => `sticks out: ${label(el)}`), ...culprits];
  }, width);
}

/**
 * Controls too small to hit with a finger, on a touch screen: a button, a
 * form control or a link styled as a button under 44px either way. Links that
 * run inside a sentence are left alone (a text link), as is anything visually
 * hidden or marked data-target-ok. A checkbox or radio counts as its label
 * (the label is what is tapped).
 */
export async function findSmallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const min = 44;
    const seen = new Set<string>();
    const selector =
      'button, select, input:not([type="hidden"]), textarea, [role="button"], [role="menuitem"], a.btn, summary';
    for (const el of document.body.querySelectorAll(selector)) {
      if (el.closest("[data-target-ok], .visually-hidden, svg")) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
      // A checkbox or radio is hit through its label where it has one.
      const isChoice = el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type);
      const label = isChoice ? ((el as HTMLInputElement).labels?.[0] ?? el.closest("label")) : null;
      const target = label ?? el;
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (el instanceof HTMLSelectElement && style.backgroundImage === "none") {
        out.push(
          `select${[...el.classList]
            .slice(0, 1)
            .map((c) => `.${c}`)
            .join("")} has no arrow, so it does not look like a dropdown`,
        );
      }
      if (rect.height >= min - 0.5 && rect.width >= min - 0.5) continue;
      const cls = [...el.classList]
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join("");
      const text = (target.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
      const key = `${el.tagName.toLowerCase()}${cls} "${text}" ${Math.round(rect.width)}x${Math.round(rect.height)}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
    return out;
  });
}

/**
 * What fits but still looks broken, reported for the page as it is now:
 *  - a word split across two lines between letters (a break at a hyphen,
 *    slash or dash is a place a word may break; a run of text wider than
 *    most of the screen, such as a long web address, is left alone);
 *  - a table column whose rows do not start at one left edge (a column of
 *    text, read from the start: centred and end-aligned cells are left alone);
 *  - a link or button the browser draws itself (its default blue, purple or
 *    grey), because no shared style reached it;
 *  - a box that scrolls up and down inside the page: the page is the only
 *    scroller (src/stickyParts.ts), apart from the sidebar beside it and a
 *    dialog over it.
 * data-clip-ok and data-scroll-ok leave an element alone, as in findOverflow.
 */
export async function findLayoutFaults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const label = (el: Element): string => {
      const cls = [...el.classList]
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join("");
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
      return `${el.tagName.toLowerCase()}${cls}${text ? ` "${text}"` : ""}`;
    };
    const shown = (el: Element) => {
      for (let up: Element | null = el; up; up = up.parentElement) {
        if (up.matches(".visually-hidden, [data-scroll-ok], [data-clip-ok], svg")) return false;
        const style = getComputedStyle(up);
        if (style.display === "none" || style.visibility === "hidden" || style.clipPath.startsWith("inset(50%"))
          return false;
      }
      return true;
    };

    // Words split between letters.
    const split = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      const parent = node.parentElement;
      if (!parent || !/\S{2}/.test(text) || ["SCRIPT", "STYLE", "TEXTAREA", "OPTION"].includes(parent.tagName))
        continue;
      if (!shown(parent)) continue;
      // A run of text too long for any box on this screen (a long web
      // address) has nowhere whole to go. Its own box is not the measure: a
      // table squeezes a column until a word no longer fits, which is the fault.
      const room = document.documentElement.clientWidth * 0.6;
      for (const run of text.matchAll(/\S+/g)) {
        range.setStart(node, run.index);
        range.setEnd(node, run.index + run[0].length);
        if (range.getBoundingClientRect().width === 0) continue;
        const runWidth = [...range.getClientRects()].reduce((sum, r) => sum + r.width, 0);
        if (runWidth > room) continue;
        for (const match of run[0].matchAll(/[^\-/–—·]{2,}/g)) {
          range.setStart(node, run.index + match.index);
          range.setEnd(node, run.index + match.index + match[0].length);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0);
          if (rects.length < 2 || Math.abs(rects[0].top - rects[rects.length - 1].top) < 2) continue;
          split.add(`a word is split across lines: "${match[0]}" in ${label(parent)}`);
        }
      }
    }
    out.push(...[...split].slice(0, 8));

    // Table columns that do not line up.
    for (const table of document.body.querySelectorAll("table")) {
      if (!shown(table) || getComputedStyle(table).display !== "table") continue;
      const starts = new Map<number, number[]>();
      for (const row of table.tBodies[0]?.rows ?? []) {
        [...row.cells].forEach((cell, index) => {
          if (cell.colSpan > 1 || !/^(start|left)$/.test(getComputedStyle(cell).textAlign)) return;
          const first = [...cell.querySelectorAll("*"), cell].find(
            (el) => el.getBoundingClientRect().width > 0 && (el.textContent ?? "").trim() !== "",
          );
          if (!first) return;
          const r = document.createRange();
          r.selectNodeContents(first);
          const left = r.getClientRects()[0]?.left ?? first.getBoundingClientRect().left;
          starts.set(index, [...(starts.get(index) ?? []), left]);
        });
      }
      for (const [index, lefts] of starts) {
        if (lefts.length > 1 && Math.max(...lefts) - Math.min(...lefts) > 1.5) {
          const head = table.tHead?.rows[0]?.cells[index]?.textContent?.trim() || `column ${index + 1}`;
          out.push(`a table column does not start at one edge: "${head}" in ${label(table).slice(0, 40)}`);
        }
      }
    }

    // Links and buttons the browser draws itself.
    const browserColours = new Set(["rgb(0, 0, 238)", "rgb(85, 26, 139)", "rgb(0, 0, 255)", "rgb(238, 0, 0)"]);
    for (const el of document.body.querySelectorAll("a[href], button")) {
      if (!shown(el) || el.getBoundingClientRect().width === 0) continue;
      const style = getComputedStyle(el);
      const bare =
        el.tagName === "A"
          ? browserColours.has(style.color)
          : ["rgb(239, 239, 239)", "rgb(240, 240, 240)", "rgb(233, 233, 237)"].includes(style.backgroundColor);
      if (bare) out.push(`${el.tagName === "A" ? "a link" : "a button"} has no style of its own: ${label(el)}`);
    }

    // A box that scrolls inside the scrolling page.
    for (const el of document.body.querySelectorAll("*")) {
      if (el.closest(".nav-rail, .dialog") || !shown(el)) continue;
      const overflowY = getComputedStyle(el).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1) {
        out.push(`a box scrolls inside the page: ${label(el)}`);
      }
    }

    // A gap on a box that lays nothing out: its grid or flex was lost, and its parts touch.
    for (const el of document.body.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      if (!["block", "inline", "inline-block"].includes(style.display) || el.closest("select, table") || !shown(el))
        continue;
      if (style.rowGap !== "normal" || style.columnGap !== "normal") {
        out.push(`a gap on a box that is not a grid or flex: ${label(el)}`);
      }
    }

    // Tiles whose last row ends in a hole, or an even set whose rows differ (layout.css).
    for (const set of document.body.querySelectorAll(".tiles, .even-set__items")) {
      if (!shown(set)) continue;
      const items = [...set.children].filter((el) => el.getBoundingClientRect().width > 0);
      const rows = new Map<number, number>();
      for (const item of items) {
        const top = Math.round(item.getBoundingClientRect().top);
        rows.set(top, (rows.get(top) ?? 0) + 1);
      }
      const counts = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, count]) => count);
      const last = items[items.length - 1];
      if (!last || counts.length < 2) continue;
      const end = set.getBoundingClientRect().right - parseFloat(getComputedStyle(set).paddingRight);
      const uneven = set.matches(".even-set__items") && new Set(counts).size > 1;
      if (end - last.getBoundingClientRect().right > 8 || uneven) {
        out.push(`a row ends in a gap: ${label(set)} (${counts.join(" + ")})`);
      }
    }
    return out;
  });
}

/**
 * A bar kept at the foot of the window (`position: sticky; bottom: 0`, or
 * fixed) with something else drawn over it: a control from the page showing
 * through the bar, as a row's buttons once did on the decision board. The page
 * is scrolled from top to bottom, since what passes under the bar changes, and
 * left at the top. A dialog or a menu opened over the bar is meant to cover it.
 */
export async function findCoveredBars(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const label = (el: Element): string => {
      const cls = [...el.classList]
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join("");
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
      return `${el.tagName.toLowerCase()}${cls}${text ? ` "${text}"` : ""}`;
    };
    const bars = [...document.body.querySelectorAll<HTMLElement>("*")].filter((el) => {
      const style = getComputedStyle(el);
      const pinned = style.position === "fixed" || (style.position === "sticky" && style.bottom === "0px");
      return pinned && !el.closest(".dialog-backdrop, [role=menu], .nav-rail") && el.getBoundingClientRect().height > 0;
    });
    const found = new Set<string>();
    if (bars.length === 0) return [];
    const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const step = Math.max(100, Math.floor(window.innerHeight / 3));
    for (let top = 0; top <= document.documentElement.scrollHeight; top += step) {
      window.scrollTo(0, top);
      await frame();
      for (const bar of bars) {
        const box = bar.getBoundingClientRect();
        const [left, right] = [Math.max(box.left, 0), Math.min(box.right, window.innerWidth)];
        const [above, below] = [Math.max(box.top, 0), Math.min(box.bottom, window.innerHeight)];
        if (right - left < 8 || below - above < 8) continue;
        for (let across = 1; across < 16; across++) {
          for (let down = 1; down < 4; down++) {
            const hit = document.elementFromPoint(
              left + ((right - left) * across) / 16,
              above + ((below - above) * down) / 4,
            );
            if (!hit || bar.contains(hit) || hit.contains(bar) || hit.closest(".dialog-backdrop, [role=menu]"))
              continue;
            found.add(`drawn over the bar at the foot of the window (${label(bar).slice(0, 24)}): ${label(hit)}`);
          }
        }
      }
    }
    window.scrollTo(0, 0);
    await frame();
    return [...found].slice(0, 6);
  });
}

/**
 * A chosen control that stops looking chosen under the pointer: a pressed
 * button, one that carries a tone (a mark, an outcome), the current page's
 * link or a ticked choice whose text colour changes on hover, or whose fill or
 * border is replaced. The pointer is still on a button that was just pressed,
 * so a hover that wins hides the choice just made until the pointer moves
 * away, as it once did for Met and Not met. One of each kind of control is tried.
 */
export async function findChoicesLostOnHover(page: Page): Promise<string[]> {
  const out: string[] = [];
  const chosen = page.locator(
    'button[aria-pressed="true"], button[data-tone], a[data-tone], a[aria-current], [role="tab"][aria-selected="true"], label:has(input:checked)',
  );
  const look = (el: Element) => {
    const style = getComputedStyle(el);
    // No colour at all: rgba(…, 0), or the newer "… / 0)".
    const clear = (colour: string) => colour === "transparent" || /^rgba\([^)]*,\s*0\)$|\/\s*0\)$/.test(colour);
    return {
      text: style.color,
      // A wash that appears on a control with no fill of its own is the hover saying "here".
      fill: clear(style.backgroundColor) ? "" : style.backgroundColor,
      border: parseFloat(style.borderTopWidth) > 0 && !clear(style.borderTopColor) ? style.borderTopColor : "",
    };
  };
  // Read once it has stopped changing: colours ease over `--duration`.
  const settledLook = async (index: number) => {
    let last = "";
    for (let tries = 0; tries < 20; tries++) {
      const now = JSON.stringify(await chosen.nth(index).evaluate(look));
      if (now === last) break;
      last = now;
      await page.waitForTimeout(120);
    }
    return JSON.parse(last) as ReturnType<typeof look>;
  };
  const seen = new Set<string>();
  const count = Math.min(await chosen.count(), 60);
  for (let index = 0; index < count; index++) {
    const control = chosen.nth(index);
    if (!(await control.isVisible()) || !(await control.isEnabled())) continue;
    const kind = await control.evaluate(
      (el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}${el.getAttribute("data-tone") ?? ""}`,
    );
    if (seen.has(kind)) continue;
    seen.add(kind);
    await page.mouse.move(0, 0);
    const rest = await settledLook(index);
    await control.scrollIntoViewIfNeeded();
    await control.hover({ force: true });
    if (!(await control.evaluate((el) => el.matches(":hover")))) continue;
    const over = await settledLook(index);
    const lost = (["text", "fill", "border"] as const).filter((part) => rest[part] !== "" && rest[part] !== over[part]);
    if (lost.length > 0) {
      const text = ((await control.textContent()) ?? "").trim().slice(0, 24);
      out.push(`a chosen control loses its ${lost.join(" and ")} under the pointer: ${kind.slice(0, 60)} "${text}"`);
    }
  }
  await page.mouse.move(0, 0);
  return out;
}

/**
 * A control the browser draws in its own blue instead of the theme's colours:
 * a radio, a tick, a slider or a progress bar with no accent colour, or a box
 * that is typed in or chosen from which shows the browser's focus ring. One of
 * each kind of box is given the keyboard and let go again; nothing is typed.
 */
export async function findBrowserDrawnControls(page: Page): Promise<string[]> {
  const kindOf = (el: Element) => `${el.tagName.toLowerCase()}${[...el.classList].map((name) => `.${name}`).join("")}`;
  const out = await page.evaluate(() => {
    const faults: string[] = [];
    const drawn = 'input[type="radio"], input[type="checkbox"], input[type="range"], progress';
    const seen = new Set<string>();
    for (const el of document.body.querySelectorAll(drawn)) {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      // One the app draws itself (appearance: none), or hides, has no colour of the browser's.
      if (style.appearance === "none" || box.width < 4 || el.closest(".visually-hidden")) continue;
      if (style.accentColor !== "auto") continue;
      const kind = `${el.tagName.toLowerCase()}${[...el.classList].map((name) => `.${name}`).join("")}`;
      if (seen.has(kind)) continue;
      seen.add(kind);
      faults.push(`a control is drawn in the browser's own colour: ${kind}`);
    }
    return faults;
  });
  const boxes = page.locator(
    'textarea, select, input:not([type="checkbox"], [type="radio"], [type="range"], [type="hidden"], [type="file"])',
  );
  const seen = new Set<string>();
  const count = Math.min(await boxes.count(), 80);
  for (let index = 0; index < count; index++) {
    const box = boxes.nth(index);
    if (!(await box.isVisible()) || !(await box.isEnabled())) continue;
    const kind = await box.evaluate(kindOf);
    if (seen.has(kind)) continue;
    seen.add(kind);
    await box.focus();
    // The browser's ring is the one drawn `auto`; the theme's is a solid line.
    const ring = await box.evaluate((el) => (el.matches(":focus") ? getComputedStyle(el).outlineStyle : ""));
    await box.blur();
    if (ring === "auto") out.push(`a box shows the browser's focus ring: ${kind.slice(0, 60)}`);
  }
  return out;
}
