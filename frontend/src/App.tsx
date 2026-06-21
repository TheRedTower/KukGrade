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

function ApplicationShell() {
  const { user, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  if (user === null) {
    return null;
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
      navigate("/login");
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
        <p>Welcome back.</p>
      </section>
    </main>
  );
}

function AuthenticatedRoutes() {
  const { status, user } = useAuth();
  const path = usePathname();

  useEffect(() => {
    if (status === "loading") {
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
