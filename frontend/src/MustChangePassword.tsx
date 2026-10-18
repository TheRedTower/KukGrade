import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "./api";
import { useAuth } from "./auth";
import { KukGradeLogo } from "./KukGradeLogo";

type MustChangePasswordProps = {
  themeToggle?: ReactNode;
};

export function MustChangePassword({ themeToggle }: MustChangePasswordProps) {
  const { user, changePassword, logout } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    current_password?: string[];
    new_password?: string[];
    confirm_password?: string[];
  }>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    if (newPassword !== confirmPassword) {
      setFieldErrors({
        confirm_password: ["New passwords do not match."],
      });
      return;
    }

    // The password rules are the server's validators; their messages come
    // back as new_password field errors rather than being restated here.
    setIsSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (submitError) {
      if (submitError instanceof ApiError) {
        if (submitError.fields) {
          setFieldErrors({
            current_password: submitError.messagesFor("current_password"),
            new_password: submitError.messagesFor("new_password"),
          });
        }
        if (submitError.nonFieldMessages.length > 0) {
          setError(submitError.nonFieldMessages.join(" "));
        } else if (submitError.message && !submitError.fields) {
          setError(submitError.message);
        }
      } else {
        setError("Could not update password. Check your connection and try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    setError(null);
    setIsSubmitting(true);
    try {
      await logout();
    } catch {
      // The session may still be live, so the page stays rather than
      // showing a signed-out screen backed by a valid cookie.
      setError("Could not sign out. Check your connection and retry.");
    } finally {
      setIsSubmitting(false);
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
          Your account was provisioned with a temporary password. To protect
          student records and grading outcomes, please set your personal password.
        </p>

        {user ? (
          <div className="account-pill" aria-label={`Account: ${user.email}`}>
            <span className="account-pill-name">{user.full_name || user.email}</span>
            <span className="account-pill-role">{user.role_display}</span>
          </div>
        ) : null}

        <form
          aria-labelledby="change-password-title"
          className="must-change-password-form"
          onSubmit={handleSubmit}
        >
          <label>
            Temporary or current password
            <div className="password-field">
              <input
                autoComplete="current-password"
                name="current_password"
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                type={showPasswords ? "text" : "password"}
                value={currentPassword}
              />
              <button
                aria-label={showPasswords ? "Hide passwords" : "Show passwords"}
                className="password-toggle"
                onClick={() => setShowPasswords((prev) => !prev)}
                type="button"
              >
                {showPasswords ? "Hide" : "Show"}
              </button>
            </div>
            {fieldErrors.current_password?.map((msg) => (
              <p className="form-field-error" key={msg}>
                {msg}
              </p>
            ))}
          </label>

          <label>
            New password
            <div className="password-field">
              <input
                autoComplete="new-password"
                name="new_password"
                onChange={(e) => setNewPassword(e.target.value)}
                required
                type={showPasswords ? "text" : "password"}
                value={newPassword}
              />
            </div>
            {fieldErrors.new_password?.map((msg) => (
              <p className="form-field-error" key={msg}>
                {msg}
              </p>
            ))}
          </label>

          <label>
            Confirm new password
            <div className="password-field">
              <input
                autoComplete="new-password"
                name="confirm_password"
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                type={showPasswords ? "text" : "password"}
                value={confirmPassword}
              />
            </div>
            {fieldErrors.confirm_password?.map((msg) => (
              <p className="form-field-error" key={msg}>
                {msg}
              </p>
            ))}
          </label>

          {error ? (
            <div className="form-error-banner" role="alert">
              {error}
            </div>
          ) : null}

          <div className="must-change-password-actions">
            <button
              className="primary-button"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Updating password..." : "Update password and continue"}
            </button>
            <button
              className="secondary-button"
              disabled={isSubmitting}
              onClick={() => void handleSignOut()}
              type="button"
            >
              Sign out
            </button>
          </div>
        </form>

        <p className="security-guarantee-note">
          KukGrade stores only a salted hash of your password, never the password itself.
        </p>
      </main>
    </div>
  );
}
