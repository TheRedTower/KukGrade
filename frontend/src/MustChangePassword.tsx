import { type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";

import { Alert } from "./Alert";
import { SIGN_OUT_ERROR, useAuth } from "./auth";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { KukGradeLogo } from "./KukGradeLogo";
import { Button } from "./Button";
import { LockIcon } from "./Icons";

type MustChangePasswordProps = {
  themeToggle?: ReactNode;
};

export function MustChangePassword({ themeToggle }: MustChangePasswordProps) {
  const { user, logout } = useAuth();
  // On failure the session may still be live, so the page stays rather
  // than showing a signed-out screen backed by a valid cookie.
  const signOut = useMutation({ mutationFn: logout });
  const isSigningOut = signOut.isPending;
  const signOutError = signOut.isError ? SIGN_OUT_ERROR : null;

  return (
    <div className="must-change-password-page">
      <div className="must-change-password-header">
        <KukGradeLogo className="must-change-password-logo" />
        {themeToggle ? <div className="theme-toggle-bar">{themeToggle}</div> : null}
      </div>

      <main className="must-change-password-card">
        <div className="security-icon-badge" aria-hidden="true">
          <LockIcon size={28} />
        </div>

        <h1 id="change-password-title">Choose a new password</h1>
        <p className="must-change-password-subtitle subtext">
          You signed in with a temporary password. Choose your own password to continue.
        </p>

        {user ? (
          <div className="account-pill" aria-label={`Account: ${user.email}`}>
            <span className="item-title">{user.full_name}</span>
            <span className="eyebrow account-pill-role">{user.role_display}</span>
          </div>
        ) : null}

        {/* Succeeding refetches the current user, whose cleared
            must_change_password lets the app open. */}
        <ChangePasswordForm
          actionsClassName="stack stack--2 must-change-password-actions"
          className="stack stack--4 must-change-password-form"
          currentPasswordLabel="Temporary password"
          labelledBy="change-password-title"
          secondaryAction={(isSubmitting) => (
            <Button variant="secondary" disabled={isSubmitting || isSigningOut} onClick={() => signOut.mutate()}>
              Sign out
            </Button>
          )}
          submitLabel="Update password and continue"
          submittingLabel="Updating password…"
        />
        {signOutError ? <Alert>{signOutError}</Alert> : null}
      </main>
    </div>
  );
}
