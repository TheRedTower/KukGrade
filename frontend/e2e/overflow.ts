import type { Page } from "@playwright/test";

/**
 * What "does not fit" means, in one place. Reported, in the browser, for the
 * page as it is now:
 *  - the page itself scrolls sideways;
 *  - a box's content is wider than the box (it spills, is cut off, or sits in
 *    a sideways scroller);
 *  - something sits outside the screen.
 * A deliberate sideways scroller carries data-scroll-ok (it and everything in
 * it is left alone); text meant to be shortened with an ellipsis carries
 * data-clip-ok (only that element is left alone).
 */
export async function findOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: { el: Element; why: string }[] = [];
    let pageScrolls = "";
    const screenWidth = document.documentElement.clientWidth;
    const label = (el: Element): string => {
      const id = el.id ? `#${el.id}` : "";
      const cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join("");
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
      return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ""}`;
    };
    const skipped = (el: Element) =>
      el.closest("[data-scroll-ok], svg, .visually-hidden") !== null;

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
    // Report the outermost culprit only; its children are the same fault.
    const culprits = found
      .filter(({ el }) => !found.some((other) => other.el !== el && other.el.contains(el)))
      .map(({ el, why }) => `${why}: ${label(el)}`)
      .slice(0, 12);
    return pageScrolls ? [pageScrolls, ...culprits] : culprits;
  });
}
