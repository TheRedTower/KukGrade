import type { MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ArrowLeftIcon } from "./Icons";
import { historyIndex, useCameFrom } from "./pageTrail";

// Followed as a link, the page it opens goes back to the page above it, not here.
const BACK = { back: true };

/**
 * The one way back (see .back-link in layout.css): a real link, so it opens in
 * a new tab, with a muted arrow before its words. It returns to the page this
 * one was opened from, named by its title (pageTrail.tsx); a page opened any
 * other way goes back to the page above it, `to` and `children`.
 */
export function BackLink({ to, children }: { to: string; children: string }) {
  const came = useCameFrom();
  const navigate = useNavigate();
  if (!came) {
    return (
      <Link className="back-link" to={to}>
        <ArrowLeftIcon size={15} />
        {children}
      </Link>
    );
  }
  const goBack = (event: MouseEvent<HTMLAnchorElement>) => {
    // A plain click is the browser's own Back, so the page returns as it was
    // left; a new tab or window still opens the link.
    const now = historyIndex();
    if (came.index === undefined || now === undefined || came.index >= now) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    void navigate(came.index - now);
  };
  return (
    <Link className="back-link" to={came.path} state={BACK} onClick={goBack}>
      <ArrowLeftIcon size={15} />
      {came.label}
    </Link>
  );
}
