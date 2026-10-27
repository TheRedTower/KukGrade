import "./Demo.css";
import { formatDayMonth, formatShortDateTime, formatTime } from "./dates";
import { useSiteSettingsQuery } from "./queries";

/**
 * "18:00", or "28 Oct 2026, 00:00" when the next reset is not today, so a
 * midnight reset is never mistaken for the one that has just passed.
 */
function resetTime(iso: string): string {
  const today = formatDayMonth(new Date().toISOString());
  return formatDayMonth(iso) === today ? formatTime(iso) : formatShortDateTime(iso);
}

/**
 * On the public demo only: one button per shared account, so a visitor can
 * be in the app in one click, and the password those accounts share. The
 * server publishes both (GET /api/site/); on any other deployment the site
 * settings carry no `demo` and this renders nothing.
 */
export function DemoSignIn({
  busy,
  onSignIn,
}: {
  busy: boolean;
  onSignIn: (email: string, password: string) => void;
}) {
  const demo = useSiteSettingsQuery().data?.demo;
  if (!demo) return null;

  return (
    <section aria-labelledby="demo-title" className="demo-card">
      <h2 id="demo-title">Try the demo</h2>
      <p>
        Everything here is made up, and anyone can use these accounts at the same time. The data
        is reset at {resetTime(demo.next_reset_at)}.
      </p>
      <ul className="demo-accounts">
        {demo.accounts.map((account) => (
          <li key={account.key}>
            <button
              className="demo-account"
              disabled={busy}
              onClick={() => onSignIn(account.email, demo.password)}
              type="button"
            >
              <strong>Sign in as {account.label}</strong>
              <span>{account.description}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="demo-password">
        Or sign in below with an email above and the password <code>{demo.password}</code>.
      </p>
    </section>
  );
}

/** A slim reminder across the top of the app while the demo is running. */
export function DemoBanner() {
  const demo = useSiteSettingsQuery().data?.demo;
  if (!demo) return null;

  return (
    <div className="demo-banner" role="note">
      You are using a demo with made-up data. It is reset at {resetTime(demo.next_reset_at)}.
    </div>
  );
}
