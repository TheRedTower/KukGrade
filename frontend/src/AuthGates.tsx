import { FormEvent, ReactNode, useState } from "react";
import { PasswordToggle } from "./PasswordToggle";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { LoadingState } from "./LoadingState";
import { Alert } from "./Alert";
import { ApiError, type AuthUser, getSetupStatus } from "./api";
import { hasSignedInBefore, useAuth } from "./auth";
import { LoginBrandPanel, ThemeToggle } from "./AuthChrome";
import { DemoSignIn } from "./DemoSignIn";
import { MustChangePassword } from "./MustChangePassword";
import { SetupPage } from "./SetupPage";
import { Button } from "./Button";

/**
 * Where sign-in leads: the page that sent the viewer to it (a session that
 * ended mid-work), or the Overview. Only a path inside the app is followed.
 */
function useReturnPath(): string {
  const from: unknown = (useLocation().state as { from?: unknown } | null)?.from;
  return typeof from === "string" && from.startsWith("/") && !from.startsWith("//") && !from.startsWith("/login")
    ? from
    : "/";
}

function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const returnPath = useReturnPath();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Read once per mount rather than kept in state: this browser's history
  // does not change while the login form is on screen.
  const [isReturningVisitor] = useState(hasSignedInBefore);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void signIn(email, password);
  }

  async function signIn(address: string, secret: string) {
    setError(null);
    setIsSubmitting(true);

    try {
      await login(address, secret);
      navigate(returnPath, { replace: true });
    } catch (loginError) {
      if (loginError instanceof ApiError) {
        if (loginError.status === 403) {
          setError("Your sign-in could not be checked. Refresh the page and try again.");
        } else if (loginError.status === 429) {
          // The server's own message names how long to wait.
          setError(loginError.message);
        } else if (loginError.status >= 500) {
          setError(
            "KukGrade is not responding. Your password may be fine - try again in a moment.",
          );
        } else {
          setError("Email or password is incorrect.");
        }
      } else {
        setError("KukGrade could not be reached. Check your connection and try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <LoginBrandPanel />
      <div className="login-column">
        <div className="theme-toggle-bar">
          <ThemeToggle />
        </div>
        <section className="login-content" aria-labelledby="login-title">
          <h1 id="login-title">{isReturningVisitor ? "Welcome back" : "Sign in"}</h1>
          <p className="login-subtitle">Sign in to KukGrade</p>
          <DemoSignIn busy={status === "loading" || isSubmitting} onSignIn={(a, p) => void signIn(a, p)} />
          <form className="login-form" onSubmit={handleSubmit}>
            <label className="field field--sentence">
              <span>Email address</span>
              <input
                autoComplete="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            <label className="field field--sentence">
              <span>Password</span>
              <div className="password-field">
                <input
                  autoComplete="current-password"
                  name="password"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                />
                <PasswordToggle noun="password" onToggle={() => setShowPassword((previous) => !previous)} shown={showPassword} />
              </div>
            </label>
            {error ? <Alert>{error}</Alert> : null}
            <Button
              variant="primary"
              disabled={status === "loading" || isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Signing in" : "Sign in"}
            </Button>
          </form>
          <p className="login-help subtext">
            Having trouble signing in? <strong>Contact your administrator.</strong>
          </p>
          <p className="login-security-note meta">
            Authorised staff only. Student and grading information is protected.
          </p>
        </section>
      </div>
    </main>
  );
}

function ConnectionErrorPage() {
  const { error, retry } = useAuth();

  return (
    <main className="auth-page">
      <section className="login-panel" aria-labelledby="connection-error-title">
        <p className="eyebrow">KukGrade</p>
        <h1 id="connection-error-title">Can&rsquo;t reach KukGrade</h1>
        <Alert>
          {error ?? "Something went wrong."}
        </Alert>
        <Button variant="primary" onClick={retry}>
          Try again
        </Button>
      </section>
    </main>
  );
}

/** The boolean capability flags `/api/auth/me/` reports for the signed-in user. */
type Capability = {
  [K in keyof AuthUser]: AuthUser[K] extends boolean ? K : never;
}[keyof AuthUser];

/** Renders a route only when the server says this user may use it. */
export function RequireAccess({ flag, children }: { flag: Capability; children: ReactNode }) {
  const { user } = useAuth();
  if (!user?.[flag]) {
    return <Navigate replace to="/" />;
  }
  return children;
}

export function LoadingPage() {
  return (
    <main className="auth-page">
      <LoadingState>Loading KukGrade…</LoadingState>
    </main>
  );
}

/**
 * Gates a route on a signed-in session. "error" means the session is
 * unknown, not that the viewer is signed out, so it must not redirect to the
 * login route - it renders in place, on whatever path was requested.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return <LoadingPage />;
  }

  if (status === "error") {
    return <ConnectionErrorPage />;
  }

  if (user === null) {
    return <Navigate replace state={{ from: `${location.pathname}${location.search}` }} to="/login" />;
  }

  if (user.must_change_password) {
    return <MustChangePassword themeToggle={<ThemeToggle />} />;
  }

  return children;
}

/**
 * A new deployment shows only its setup page, on every path, until the
 * first administrator exists. Asked only of a signed-out visitor: before
 * setup nobody can be signed in, so a signed-in session already answers it.
 * A failure to ask falls through to the usual screens.
 */
export function SetupGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const anonymous = status === "anonymous";
  const setup = useQuery({
    queryKey: ["setupStatus"],
    queryFn: getSetupStatus,
    enabled: anonymous,
  });

  if (anonymous && setup.isPending) {
    return <LoadingPage />;
  }

  if (anonymous && setup.data?.setup_needed) {
    return <SetupPage />;
  }

  return children;
}

export function LoginRoute() {
  const { status, user } = useAuth();
  const returnPath = useReturnPath();

  if (status === "loading") {
    return <LoadingPage />;
  }

  if (status === "error") {
    return <ConnectionErrorPage />;
  }

  if (user !== null) {
    return <Navigate replace to={returnPath} />;
  }

  return <LoginPage />;
}
