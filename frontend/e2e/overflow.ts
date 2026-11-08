import type { Page } from "@playwright/test";

/**
 * What "does not fit" means, in one place. Reported, in the browser, for the
 * page as it is now:
 *  - the page itself scrolls sideways;
 *  - a box's content is wider than the box (it spills, is cut off, or sits in
 *    a sideways scroller);
 *  - something sits outside the screen;
 *  - a date input is wider than the box it sits in (iOS sizes them itself);
 *  - two `.card` boxes stacked with no gap between them (only that class).
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
      const cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join("");
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
    const skipped = (el: Element) =>
      el.closest("[data-scroll-ok], svg") !== null || hiddenOnPurpose(el);

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
        const how = overflowX === "visible" ? "spills out of" : overflowX === "auto" || overflowX === "scroll" ? "scrolls sideways inside" : "is cut off inside";
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
    for (const card of document.body.querySelectorAll(".card")) {
      const next = card.nextElementSibling;
      if (!next?.classList.contains("card") || skipped(card) || skipped(next)) continue;
      const rect = card.getBoundingClientRect();
      const nextRect = next.getBoundingClientRect();
      // Only cards that really stack (not side by side, not hidden).
      if (nextRect.height === 0 || nextRect.top < rect.top + rect.height / 2) continue;
      if (nextRect.top - rect.bottom < 1) culpritsExtra.push(`cards touch with no gap: ${label(card)}`);
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
      (el) => !skipped(el) && el.getBoundingClientRect().right > screenWidth + 1 && el.getBoundingClientRect().width > 0,
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
        out.push(`select${[...el.classList].slice(0, 1).map((c) => `.${c}`).join("")} has no arrow, so it does not look like a dropdown`);
      }
      if (rect.height >= min - 0.5 && rect.width >= min - 0.5) continue;
      const cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join("");
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
 *    grey), because no shared style reached it.
 * data-clip-ok and data-scroll-ok leave an element alone, as in findOverflow.
 */
export async function findLayoutFaults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const label = (el: Element): string => {
      const cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join("");
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
      return `${el.tagName.toLowerCase()}${cls}${text ? ` "${text}"` : ""}`;
    };
    const shown = (el: Element) => {
      for (let up: Element | null = el; up; up = up.parentElement) {
        if (up.matches(".visually-hidden, [data-scroll-ok], [data-clip-ok], svg")) return false;
        const style = getComputedStyle(up);
        if (style.display === "none" || style.visibility === "hidden" || style.clipPath.startsWith("inset(50%")) return false;
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
      if (!parent || !/\S{2}/.test(text) || ["SCRIPT", "STYLE", "TEXTAREA", "OPTION"].includes(parent.tagName)) continue;
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
    return out;
  });
}
