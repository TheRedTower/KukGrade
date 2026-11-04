import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

/** The least space left between an open menu and the screen's edge. */
const MENU_EDGE_PX = 8;

/**
 * An actions menu opened from a button: it closes on a click outside, on Escape (focus
 * returns to the button) and on Tab; it takes focus when it opens; arrow keys, Home and
 * End move within it; and where it would run off the left of the screen it opens from
 * the other edge. Put `menuRef` on the element that holds the button and the menu.
 */
export function useActionsMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  // The menu opens from the button's right edge; where that would push it off the
  // left of the screen (the button is near the left on a phone), open from the
  // left edge instead.
  useLayoutEffect(() => {
    const menu = menuRef.current?.querySelector<HTMLElement>(".gsd-dropdown-menu");
    if (!open || !menu) return;
    const place = () => {
      delete menu.dataset.align;
      if (menu.getBoundingClientRect().left < MENU_EDGE_PX) menu.dataset.align = "start";
    };
    place();
    // A phone turned round while the menu is open.
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (at + 1) % items.length
            : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return { open, setOpen, menuRef, buttonRef, onMenuKeyDown };
}
