import { useState, type ReactNode } from "react";

import { useAuth } from "./auth";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { KukGradeLogo } from "./KukGradeLogo";
import { Button } from "./Button";

type MustChangePasswordProps = {
  themeToggle?: ReactNode;
};

export function MustChangePassword({ themeToggle }: MustChangePasswordProps) {
  const { user, logout } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    setSignOutError(null);
    setIsSigningOut(true);
    try {
      await logout();
    } catch {
      // The session may still be live, so the page stays rather than
      // showing a signed-out screen backed by a valid cookie.
      setSignOutError("Could not sign out. Check your connection and retry.");
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="must-change-password-page">
      <div className="must-change-password-header">
        <KukGradeLogo className="must-change-password-logo" />
        {themeToggle ? <div className="theme-toggle-bar">{themeToggle}</div> : null}
      </div>

      <main className="must-change-password-card">
        <div className="security-icon-badge" aria-hidden="true">
          <svg
            fill="none"
            height="28"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="28"
          >
            <rect height="11" rx="2" ry="2" width="18" x="3" y="11" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h1 id="change-password-title">Choose a new password</h1>
        <p className="must-change-password-subtitle">
          You signed in with a temporary password. Choose your own password to
          continue.
        </p>

        {user ? (
          <div className="account-pill" aria-label={`Account: ${user.email}`}>
            <span className="account-pill-name">{user.full_name || user.email}</span>
            <span className="account-pill-role">{user.role_display}</span>
          </div>
        ) : null}

        {/* Succeeding refetches the current user, whose cleared
            must_change_password lets the app open. */}
        <ChangePasswordForm
          actionsClassName="must-change-password-actions"
          className="must-change-password-form"
          currentPasswordLabel="Temporary password"
          labelledBy="change-password-title"
          secondaryAction={(isSubmitting) => (
            <Button
              variant="secondary"
              disabled={isSubmitting || isSigningOut}
              onClick={() => void handleSignOut()}
            >
              Sign out
            </Button>
          )}
          submitLabel="Update password and continue"
          submittingLabel="Updating password..."
        />
        {signOutError ? (
          <div className="form-error-banner" role="alert">
            {signOutError}
          </div>
        ) : null}
      </main>
    </div>
  );
}
