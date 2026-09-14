import { FormEvent, useEffect, useState } from "react";

import "./App.css";
import { ApiError } from "./api";
import { AuthProvider, useAuth } from "./auth";

function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function usePathname(): string {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    function handleLocationChange() {
      setPath(window.location.pathname);
    }

    window.addEventListener("popstate", handleLocationChange);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
    };
  }, []);

  return path;
}

function LoginPage() {
  const { login, status } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
      navigate("/");
    } catch (loginError) {
      if (loginError instanceof ApiError && loginError.status === 403) {
        setError("Session verification failed. Refresh the page and try again.");
      } else {
        setError("Email or password is incorrect.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="login-panel" aria-labelledby="login-title">
        <p className="eyebrow">KukGrade</p>
        <h1 id="login-title">Sign in</h1>
        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input
              autoComplete="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button
            className="primary-button"
            disabled={status === "loading" || isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Signing in" : "Sign in"}
          </button>
        </form>
      </section>
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
        <p className="form-error" role="alert">
          {error ?? "Something went wrong."}
        </p>
        <button className="primary-button" onClick={retry} type="button">
          Try again
        </button>
      </section>
    </main>
  );
}

function ApplicationShell() {
  const { user, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  if (user === null) {
    return null;
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
      navigate("/login");
    } catch {
      // The session may still be live, so the viewer stays signed in
      // rather than being shown a signed-out UI backed by a valid cookie.
      setLogoutError("Could not sign out. Check your connection and retry.");
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Internal grading management</p>
          <h1>KukGrade</h1>
        </div>
        <div className="user-summary">
          <span>{user.full_name}</span>
          <span>{user.role_display}</span>
          <button
            className="secondary-button"
            disabled={isLoggingOut}
            onClick={handleLogout}
            type="button"
          >
            Sign out
          </button>
        </div>
      </header>
      <section className="workspace" aria-labelledby="workspace-title">
        <h2 id="workspace-title">Application</h2>
        {logoutError ? (
          <p className="form-error" role="alert">
            {logoutError}
          </p>
        ) : null}
        <p>Welcome back.</p>
      </section>
    </main>
  );
}

function AuthenticatedRoutes() {
  const { status, user } = useAuth();
  const path = usePathname();

  useEffect(() => {
    // "error" means the session is unknown, not that the viewer is signed
    // out, so it must not redirect to the login route.
    if (status === "loading" || status === "error") {
      return;
    }
    if (user === null && path !== "/login") {
      navigate("/login");
    }
    if (user !== null && path === "/login") {
      navigate("/");
    }
  }, [path, status, user]);

  if (status === "loading") {
    return (
      <main className="auth-page">
        <p className="loading-state">Loading KukGrade</p>
      </main>
    );
  }

  if (status === "error") {
    return <ConnectionErrorPage />;
  }

  if (user === null) {
    return <LoginPage />;
  }

  return <ApplicationShell />;
}

function App() {
  return (
    <AuthProvider>
      <AuthenticatedRoutes />
    </AuthProvider>
  );
}

export default App;
