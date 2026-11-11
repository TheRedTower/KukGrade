import { useChoices } from "./choices";
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";

import { Alert } from "./Alert";
import { Badge } from "./Badge";
import { Field } from "./Field";
import { splitServerErrors } from "./forms";
import { useAuth } from "./auth";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { SettingsRow } from "./SettingsRow";
import { Button } from "./Button";
import { EmailAddress } from "./EmailAddress";

/** Your own first and last name: the only part of your profile you edit. */
function NameRow() {
  const { user, updateName } = useAuth();
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const save = useMutation({ mutationFn: () => updateName(firstName.trim(), lastName.trim()) });
  if (!user) return null;
  const saving = save.isPending;
  const saved = save.isSuccess;
  // A missing name is said beside its box; anything else above the button.
  const errors = save.error
    ? splitServerErrors(save.error, ["first_name", "last_name"], "Could not save your name.")
    : null;

  const changed = firstName.trim() !== user.first_name || lastName.trim() !== user.last_name;

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <SettingsRow description="Shown on gradings and in the audit log." title="Name">
      <form className="stack stack--4 st-name-form" onSubmit={submit}>
        <div className="st-name-fields">
          <Field error={errors?.fields.first_name?.join(" ")} label="First name">
            {(control) => (
              <input
                {...control}
                onChange={(event) => {
                  setFirstName(event.target.value);
                  save.reset();
                }}
                required
                value={firstName}
              />
            )}
          </Field>
          <Field error={errors?.fields.last_name?.join(" ")} label="Last name">
            {(control) => (
              <input
                {...control}
                onChange={(event) => {
                  setLastName(event.target.value);
                  save.reset();
                }}
                required
                value={lastName}
              />
            )}
          </Field>
        </div>
        {/* Below the boxes, so an error under one never moves it. */}
        <div className="st-form-actions">
          <Button variant="secondary" disabled={saving || !changed} type="submit">
            {saving ? "Saving…" : "Save name"}
          </Button>
        </div>
        {errors?.banner ? <Alert>{errors.banner}</Alert> : null}
        {saved ? (
          <p className="st-saved item-title" role="status">
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
            className="stack stack--4 st-password-form"
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
            <span className="st-saved item-title" role="status">
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
  const authorities = useChoices().authorities;
  if (!user) return null;

  return (
    <section aria-label="Account" className="card card--flush">
      <NameRow />
      <SettingsRow description="An administrator changes it on the Users page." title="Email">
        <span>
          <EmailAddress address={user.email} />
        </span>
      </SettingsRow>
      <PasswordRow />
      <SettingsRow
        below={
          <>
            <ul className="list-plain st-capabilities">
              {authorities.map((capability) => {
                const granted = Boolean(user[capability.value]);
                return (
                  <li key={capability.value}>
                    <span>{capability.label}</span>
                    <Badge tone={granted ? "success" : "neutral"}>{granted ? "Granted" : "Not granted"}</Badge>
                  </li>
                );
              })}
            </ul>
            <p className="st-row-description subtext">Capabilities are independent of your role.</p>
          </>
        }
        description={`${user.role_display}. What you can do beyond your role is set by an administrator.`}
        title="Role and permissions"
      />
    </section>
  );
}
