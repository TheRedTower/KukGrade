import { NavLink, useLocation, type NavLinkProps } from "react-router-dom";

import { useSmoothNavigate } from "./smoothly";

/**
 * A NavLink between views of one screen (settings tabs, About sections) whose
 * change eases in (smoothly.ts). A click that opens a new tab or window, or one
 * on the page already shown, stays the link's own.
 */
export function SmoothNavLink(props: NavLinkProps & { to: string }) {
  const go = useSmoothNavigate();
  const { pathname } = useLocation();
  return (
    <NavLink
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        if (event.defaultPrevented || props.to === pathname) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        go(props.to);
      }}
    />
  );
}
