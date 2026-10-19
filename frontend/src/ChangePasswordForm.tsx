import { useState, type FormEvent, type ReactNode } from "react";

import { ApiError } from "./api";
import { useAuth } from "./auth";
import { PasswordRequirements } from "./PasswordRequirements";

type FieldErrors = {
  current_password?: string[];
  new_password?: string[];
  confirm_password?: string[];
};

type ChangePasswordFormProps = {
  /** "Temporary password" on the forced screen, "Current password" in the menu. */
  currentPasswordLabel: string;
  submitLabel: string;
  submittingLabel: string;
  className: string;
  labelledBy?: string;
  /** Called once the server has accepted the new password. */
  onChanged?: () => void;
  /** Rendered beside the submit button: Sign out, or Cancel. */
  secondaryAction?: (isSubmitting: boolean) => ReactNode;
  actionsClassName: string;
  submitClassName: string;
};

/**
 * Changing your own password: current password, new password, confirmation.
 *
 * The one form for it, used by the forced change after a temporary password
 * and by the account menu, so both send the same request and report the
 * server's answer the same way. The password rules are the server's: the
 * checklist shows the policy it serves, and its messages come back as
 * `new_password` errors. Only the confirmation is checked in the browser,
 * since the server never sees it.
 */
export function ChangePasswordForm({
  currentPasswordLabel,
  submitLabel,
  submittingLabel,
  className,
  labelledBy,
  onChanged,
  secondaryAction,
  actionsClassName,
  submitClassName,
}: ChangePasswordFormProps) {
  const { changePassword } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    if (newPassword !== confirmPassword) {
      setFieldErrors({ confirm_password: ["New passwords do not match."] });
      return;
    }

    setIsSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      onChanged?.();
    } catch (submitError) {
      if (submitError instanceof ApiError) {
        const current = submitError.messagesFor("current_password");
        const next = submitError.messagesFor("new_password");
        setFieldErrors({ current_password: current, new_password: next });
        // Anything not shown beside a field goes in the banner, so no error
        // the server sends is left unsaid.
        const banner =
          submitError.nonFieldMessages.join(" ") ||
          (current.length || next.length ? "" : submitError.message);
        if (banner) setError(banner);
      } else {
        setError("Could not update password. Check your connection and try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function errorsFor(field: keyof FieldErrors) {
    return fieldErrors[field]?.map((message) => (
      <p className="form-field-error" key={message}>
        {message}
      </p>
    ));
  }

  const inputType = showPasswords ? "text" : "password";

  return (
    <form aria-labelledby={labelledBy} className={className} onSubmit={handleSubmit}>
      <label>
        {currentPasswordLabel}
        <div className="password-field">
          {/* Named here rather than by the label, which also holds the
              Show button and would add its name to this field's. */}
          <input
            aria-label={currentPasswordLabel}
            autoComplete="current-password"
            name="current_password"
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            type={inputType}
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
        {errorsFor("current_password")}
      </label>

      <label>
        New password
        <div className="password-field">
          <input
            autoComplete="new-password"
            name="new_password"
            onChange={(e) => setNewPassword(e.target.value)}
            required
            type={inputType}
            value={newPassword}
          />
        </div>
        {errorsFor("new_password")}
      </label>
      <PasswordRequirements password={newPassword} />

      <label>
        Confirm new password
        <div className="password-field">
          <input
            autoComplete="new-password"
            name="confirm_password"
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            type={inputType}
            value={confirmPassword}
          />
        </div>
        {errorsFor("confirm_password")}
      </label>

      {error ? (
        <div className="form-error-banner" role="alert">
          {error}
        </div>
      ) : null}

      <div className={actionsClassName}>
        <button className={submitClassName} disabled={isSubmitting} type="submit">
          {isSubmitting ? submittingLabel : submitLabel}
        </button>
        {secondaryAction?.(isSubmitting)}
      </div>
    </form>
  );
}
