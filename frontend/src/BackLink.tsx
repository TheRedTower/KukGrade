import { Link } from "react-router-dom";

/**
 * The one way back to the page above (see .back-link in layout.css): a real
 * link, so it opens in a new tab, with a muted arrow before its words.
 */
export function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <Link className="back-link" to={to}>
      <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="15">
        <path d="M20 12H5M10 7l-5 5 5 5" />
      </svg>
      {children}
    </Link>
  );
}
