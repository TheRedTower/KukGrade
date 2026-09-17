import { FormEvent, ReactNode, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";

import "./App.css";
import { ApiError } from "./api";
import { AuthProvider, useAuth } from "./auth";

function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
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
      if (loginError instanceof ApiError) {
        if (loginError.status === 403) {
          setError("Session verification failed. Refresh the page and try again.");
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
  const navigate = useNavigate();
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

function LoadingPage() {
  return (
    <main className="auth-page">
      <p className="loading-state">Loading KukGrade</p>
    </main>
  );
}

/**
 * Gates a route on a signed-in session. "error" means the session is
 * unknown, not that the viewer is signed out, so it must not redirect to the
 * login route - it renders in place, on whatever path was requested.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();

  if (status === "loading") {
    return <LoadingPage />;
  }

  if (status === "error") {
    return <ConnectionErrorPage />;
  }

  if (user === null) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function LoginRoute() {
  const { status, user } = useAuth();

  if (status === "loading") {
    return <LoadingPage />;
  }

  if (status === "error") {
    return <ConnectionErrorPage />;
  }

  if (user !== null) {
    return <Navigate to="/" replace />;
  }

  return <LoginPage />;
}

// A fresh client per mount, not a module-level singleton: the app only ever
// mounts once in production, but each test renders its own <App /> and must
// not inherit another test's cached session query.
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A dropped connection or a 403 is meaningful the moment it happens
        // (see isAnonymousResponse in auth.tsx) - retrying in the background
        // would delay that answer and, in tests, call the fetch mock more
        // times than the test set up responses for.
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

function App() {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<LoginRoute />} path="/login" />
            <Route
              element={
                <RequireAuth>
                  <ApplicationShell />
                </RequireAuth>
              }
              path="*"
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
