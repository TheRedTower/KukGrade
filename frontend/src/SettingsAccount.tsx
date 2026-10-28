import { useState, type FormEvent } from "react";

import { errorMessage } from "./api";
import { useAuth } from "./auth";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { SettingsRow } from "./SettingsRow";
import { Button } from "./Button";

const CAPABILITIES = [
  { key: "can_make_final_grading_decision", label: "Final grading decisions" },
  { key: "can_promote_student", label: "Promote students" },
  { key: "can_override_locked_session", label: "Override locked sessions" },
  { key: "can_view_grading_audit_log", label: "View grading audit log" },
] as const;

/** Your own first and last name: the only part of your profile you edit. */
function NameRow() {
  const { user, updateName } = useAuth();
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!user) return null;

  const changed = firstName.trim() !== user.first_name || lastName.trim() !== user.last_name;

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateName(firstName.trim(), lastName.trim());
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, "Could not save your name."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsRow description="Shown on gradings and in the audit log." title="Name">
      <form className="st-name-form" onSubmit={save}>
        <label>
          <span className="st-small-label">First name</span>
          <input
            onChange={(event) => {
              setFirstName(event.target.value);
              setSaved(false);
            }}
            value={firstName}
          />
        </label>
        <label>
          <span className="st-small-label">Last name</span>
          <input
            onChange={(event) => {
              setLastName(event.target.value);
              setSaved(false);
            }}
            value={lastName}
          />
        </label>
        <Button variant="secondary" disabled={saving || !changed} type="submit">
          {saving ? "Saving…" : "Save name"}
        </Button>
        {error ? (
          <p className="form-error st-full" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="st-saved st-full" role="status">
            Your name is saved.
          </p>
        ) : null}
      </form>
    </SettingsRow>
  );
}

/** Changing your own password, behind your current one. */
function PasswordRow() {
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState(false);

  return (
    <SettingsRow
      below={
        open ? (
          <ChangePasswordForm
            actionsClassName="st-form-actions"
            className="st-password-form"
            currentPasswordLabel="Current password"
            onChanged={() => {
              setOpen(false);
              setChanged(true);
            }}
            secondaryAction={(isSubmitting) => (
              <Button variant="ghost" disabled={isSubmitting} onClick={() => setOpen(false)}>
                Cancel
              </Button>
            )}
            submitLabel="Change password"
            submittingLabel="Changing…"
          />
        ) : null
      }
      description="You need your current password to set a new one. The rules show as you type."
      title="Password"
    >
      {open ? null : (
        <>
          {changed ? (
            <span className="st-saved" role="status">
              Your password has been changed.
            </span>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => {
              setChanged(false);
              setOpen(true);
            }}
          >
            Change password…
          </Button>
        </>
      )}
    </SettingsRow>
  );
}

export function SettingsAccount() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <section aria-label="Account" className="st-card">
      <NameRow />
      <SettingsRow description="An administrator changes it on the Users page." title="Email">
        <span>{user.email}</span>
      </SettingsRow>
      <PasswordRow />
      <SettingsRow
        below={
          <>
            <ul className="st-capabilities">
              {CAPABILITIES.map((capability) => {
                const granted = Boolean(user[capability.key]);
                return (
                  <li key={capability.key}>
                    <span>{capability.label}</span>
                    <span className={`st-badge ${granted ? "granted" : "not-granted"}`}>
                      {granted ? "Granted" : "Not granted"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="st-row-description">Capabilities are independent of your role.</p>
          </>
        }
        description={`${user.role_display}. What you can do beyond your role is set by an administrator.`}
        title="Role and permissions"
      />
    </section>
  );
}
