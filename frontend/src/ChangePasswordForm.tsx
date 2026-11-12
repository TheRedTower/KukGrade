import { Field } from "./Field";
import { PasswordToggle } from "./PasswordToggle";
import { useServerForm } from "./forms";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";

import { useAuth } from "./auth";
import { PasswordRequirements } from "./PasswordRequirements";

const FIELDS = ["current_password", "new_password", "confirm_password"] as const;

type ChangePasswordFormProps = {
  /** "Temporary password" on the forced screen, "Current password" in Settings. */
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
};

/**
 * Changing your own password: current password, new password, confirmation.
 *
 * The one form for it, used by the forced change after a temporary password
 * and by Settings, so both send the same request and report the
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
}: ChangePasswordFormProps) {
  const { changePassword } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const form = useServerForm(FIELDS);
  const submit = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => onChanged?.(),
    onError: (error) => form.handle(error, "The password could not be changed. Try again in a moment."),
  });
  const isSubmitting = submit.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    form.reset();
    if (newPassword !== confirmPassword) {
      form.setClientErrors({ confirm_password: ["The passwords do not match."] });
      return;
    }
    submit.mutate();
  }

  const inputType = showPasswords ? "text" : "password";

  return (
    <form aria-labelledby={labelledBy} className={className} onSubmit={handleSubmit}>
      <Field label={currentPasswordLabel} error={form.errorFor("current_password")}>
        {(control) => (
          <div className="password-field">
            <input
              {...control}
              autoComplete="current-password"
              name="current_password"
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              type={inputType}
              value={currentPassword}
            />
            <PasswordToggle
              noun="passwords"
              onToggle={() => setShowPasswords((previous) => !previous)}
              shown={showPasswords}
            />
          </div>
        )}
      </Field>

      <Field label="New password" error={form.errorFor("new_password")}>
        {(control) => (
          <div className="password-field">
            <input
              {...control}
              autoComplete="new-password"
              name="new_password"
              onChange={(e) => setNewPassword(e.target.value)}
              required
              type={inputType}
              value={newPassword}
            />
          </div>
        )}
      </Field>
      <PasswordRequirements password={newPassword} />

      <Field label="Confirm new password" error={form.errorFor("confirm_password")}>
        {(control) => (
          <div className="password-field">
            <input
              {...control}
              autoComplete="new-password"
              name="confirm_password"
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              type={inputType}
              value={confirmPassword}
            />
          </div>
        )}
      </Field>

      {form.banner ? <Alert>{form.banner}</Alert> : null}

      <div className={actionsClassName}>
        <Button variant="primary" disabled={isSubmitting} type="submit">
          {isSubmitting ? submittingLabel : submitLabel}
        </Button>
        {secondaryAction?.(isSubmitting)}
      </div>
    </form>
  );
}
