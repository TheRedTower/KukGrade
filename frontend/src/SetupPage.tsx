import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { PasswordToggle } from "./PasswordToggle";
import { useServerForm } from "./forms";

import { Field } from "./Field";
import { Alert } from "./Alert";
import { useAuth } from "./auth";
import { LoginBrandPanel, ThemeToggle } from "./AuthChrome";
import { PasswordRequirements } from "./PasswordRequirements";
import { Button } from "./Button";

const FIELDS = ["code", "email", "first_name", "last_name", "password", "confirm"] as const;

/**
 * A new deployment's first screen: creating the main administrator.
 *
 * Shown in place of everything else while the server says setup is needed.
 * The setup code is the one each server start writes to its log until this
 * is done, proving the person here is the deployment's owner; the server
 * checks it, and the password, and signs the new administrator in
 * (accounts/setup.py). The theme chosen here is the one KukGrade opens with.
 */
export function SetupPage() {
  const { setUp } = useAuth();
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const form = useServerForm(FIELDS);
  const submit = useMutation({
    mutationFn: () => setUp({ code, email, first_name: firstName, last_name: lastName, password }),
    onError: (error) => form.handle(error, "KukGrade could not be set up. Try again in a moment."),
  });
  const isSubmitting = submit.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    form.reset();
    if (password !== confirm) {
      form.setClientErrors({ confirm: ["The passwords do not match."] });
      return;
    }
    submit.mutate();
  }

  const inputType = showPasswords ? "text" : "password";

  return (
    <main className="login-page">
      <LoginBrandPanel />
      <div className="login-column">
        <section className="login-content" aria-labelledby="setup-title">
          <h1 id="setup-title">Set up KukGrade</h1>
          <p className="login-subtitle">
            Create the main administrator account. You will need the setup code from the server&rsquo;s log.
          </p>

          <div className="setup-theme">
            <span className="item-title">Display theme</span>
            <ThemeToggle />
            <p className="setup-theme-help subtext">
              Light, dark, or match this device. You can change it later in Settings.
            </p>
          </div>

          <form className="stack stack--4" onSubmit={handleSubmit}>
            <Field label="Setup code" error={form.errorFor("code")}>
              {(control) => (
                <input
                  {...control}
                  autoCapitalize="characters"
                  autoComplete="off"
                  name="code"
                  onChange={(event) => setCode(event.target.value)}
                  required
                  spellCheck={false}
                  value={code}
                />
              )}
            </Field>
            <Field label="Email address" error={form.errorFor("email")}>
              {(control) => (
                <input
                  {...control}
                  autoComplete="email"
                  name="email"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              )}
            </Field>
            <div className="setup-name-row tiles tiles--narrow">
              <Field label="First name" error={form.errorFor("first_name")}>
                {(control) => (
                  <input
                    {...control}
                    autoComplete="given-name"
                    name="first_name"
                    onChange={(event) => setFirstName(event.target.value)}
                    required
                    value={firstName}
                  />
                )}
              </Field>
              <Field label="Last name" error={form.errorFor("last_name")}>
                {(control) => (
                  <input
                    {...control}
                    autoComplete="family-name"
                    name="last_name"
                    onChange={(event) => setLastName(event.target.value)}
                    required
                    value={lastName}
                  />
                )}
              </Field>
            </div>
            <Field label="Password" error={form.errorFor("password")}>
              {(control) => (
                <div className="password-field">
                  <input
                    {...control}
                    autoComplete="new-password"
                    name="password"
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    type={inputType}
                    value={password}
                  />
                  <PasswordToggle
                    noun="passwords"
                    onToggle={() => setShowPasswords((previous) => !previous)}
                    shown={showPasswords}
                  />
                </div>
              )}
            </Field>
            <PasswordRequirements password={password} />
            <Field label="Confirm password" error={form.errorFor("confirm")}>
              {(control) => (
                <input
                  {...control}
                  autoComplete="new-password"
                  name="confirm"
                  onChange={(event) => setConfirm(event.target.value)}
                  required
                  type={inputType}
                  value={confirm}
                />
              )}
            </Field>
            {form.banner ? <Alert>{form.banner}</Alert> : null}
            <Button variant="primary" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Setting up" : "Create administrator"}
            </Button>
          </form>
          <p className="login-security-note meta">
            This page is shown once. After setup, every other account is added from the Users screen.
          </p>
        </section>
      </div>
    </main>
  );
}
