import { useState, type FormEvent } from "react";

import { ApiError } from "./api";
import { useAuth } from "./auth";
import { LoginBrandPanel, ThemeToggle } from "./AuthChrome";
import { PasswordRequirements } from "./PasswordRequirements";
import { Button } from "./Button";

type Field = "code" | "email" | "first_name" | "last_name" | "password" | "confirm";

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string[]>>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    if (password !== confirm) {
      setFieldErrors({ confirm: ["The passwords do not match."] });
      return;
    }

    setIsSubmitting(true);
    try {
      await setUp({
        code,
        email,
        first_name: firstName,
        last_name: lastName,
        password,
      });
    } catch (submitError) {
      if (submitError instanceof ApiError) {
        const fields: Partial<Record<Field, string[]>> = {};
        for (const name of ["code", "email", "first_name", "last_name", "password"] as const) {
          const messages = submitError.messagesFor(name);
          if (messages.length) fields[name] = messages;
        }
        setFieldErrors(fields);
        if (Object.keys(fields).length === 0) {
          setError(submitError.nonFieldMessages.join(" ") || submitError.message);
        }
      } else {
        setError("KukGrade could not be reached. Check your connection and try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function errorsFor(field: Field) {
    return fieldErrors[field]?.map((message) => (
      <p className="form-field-error" id={`setup-${field}-error`} key={message}>
        {message}
      </p>
    ));
  }

  function described(field: Field) {
    return fieldErrors[field] ? `setup-${field}-error` : undefined;
  }

  const inputType = showPasswords ? "text" : "password";

  return (
    <main className="login-page">
      <LoginBrandPanel />
      <div className="login-column">
        <section className="login-content" aria-labelledby="setup-title">
          <h1 id="setup-title">Set up KukGrade</h1>
          <p className="login-subtitle">
            Create the main administrator account. You will need the setup code from the
            server&rsquo;s log.
          </p>

          <div className="setup-theme">
            <span className="setup-theme-label">Display theme</span>
            <ThemeToggle />
            <p className="setup-theme-help">
              Light, dark, or match this device. You can change it later in Settings.
            </p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <label>
              Setup code
              <input
                aria-describedby={described("code")}
                aria-invalid={Boolean(fieldErrors.code)}
                autoCapitalize="characters"
                autoComplete="off"
                name="code"
                onChange={(event) => setCode(event.target.value)}
                required
                spellCheck={false}
                value={code}
              />
            </label>
            {errorsFor("code")}
            <label>
              Email address
              <input
                aria-describedby={described("email")}
                aria-invalid={Boolean(fieldErrors.email)}
                autoComplete="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            {errorsFor("email")}
            <div className="setup-name-row">
              <div>
                <label>
                  First name
                  <input
                    aria-describedby={described("first_name")}
                    autoComplete="given-name"
                    name="first_name"
                    onChange={(event) => setFirstName(event.target.value)}
                    value={firstName}
                  />
                </label>
                {errorsFor("first_name")}
              </div>
              <div>
                <label>
                  Last name
                  <input
                    aria-describedby={described("last_name")}
                    autoComplete="family-name"
                    name="last_name"
                    onChange={(event) => setLastName(event.target.value)}
                    value={lastName}
                  />
                </label>
                {errorsFor("last_name")}
              </div>
            </div>
            <label>
              Password
              <div className="password-field">
                {/* Named here, not by the label that also holds the button. */}
                <input
                  aria-describedby={described("password")}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-label="Password"
                  autoComplete="new-password"
                  name="password"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type={inputType}
                  value={password}
                />
                <button
                  aria-label={showPasswords ? "Hide passwords" : "Show passwords"}
                  className="password-toggle"
                  onClick={() => setShowPasswords((previous) => !previous)}
                  type="button"
                >
                  {showPasswords ? "Hide" : "Show"}
                </button>
              </div>
            </label>
            {errorsFor("password")}
            <PasswordRequirements password={password} />
            <label>
              Confirm password
              <input
                aria-describedby={described("confirm")}
                aria-invalid={Boolean(fieldErrors.confirm)}
                autoComplete="new-password"
                name="confirm"
                onChange={(event) => setConfirm(event.target.value)}
                required
                type={inputType}
                value={confirm}
              />
            </label>
            {errorsFor("confirm")}
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <Button variant="primary" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Setting up" : "Create administrator"}
            </Button>
          </form>
          <p className="login-security-note">
            This page is shown once. After setup, every other account is added from the Users
            screen.
          </p>
        </section>
      </div>
    </main>
  );
}
