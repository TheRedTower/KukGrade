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
      if (el.closest("[data-target-ok], .visually-hidden, .ix-visually-hidden, svg")) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
      // A checkbox or radio is hit through its label where it has one.
      const isChoice = el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type);
      const label = isChoice ? ((el as HTMLInputElement).labels?.[0] ?? el.closest("label")) : null;
      const target = label ?? el;
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
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
