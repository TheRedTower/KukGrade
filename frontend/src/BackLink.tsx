import { Link } from "react-router-dom";
import { ArrowLeftIcon } from "./Icons";

/**
 * The one way back to the page above (see .back-link in layout.css): a real
 * link, so it opens in a new tab, with a muted arrow before its words.
 */
export function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <Link className="back-link" to={to}>
      <ArrowLeftIcon size={15} />
      {children}
    </Link>
  );
}
