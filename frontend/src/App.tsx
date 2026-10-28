import {
  FormEvent,
  lazy,
  ReactNode,
  Suspense,
  useState,
} from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";

import "./theme.css";
import "./layout.css";
import "./controls.css";
import "./App.css";
import { ApiError, type AuthUser, getSetupStatus } from "./api";
import { AuthProvider, hasSignedInBefore, useAuth } from "./auth";
import { LoginBrandPanel, ThemeToggle } from "./AuthChrome";
import { DemoBanner, DemoSignIn } from "./DemoSignIn";
import { NavigationRail } from "./NavigationRail";
import { useSiteSettingsQuery } from "./queries";
import { SidebarProvider } from "./useSidebar";
import { MustChangePassword } from "./MustChangePassword";
import { SetupPage } from "./SetupPage";
import { OverviewScreen } from "./OverviewScreen";
import { StudentsScreen } from "./StudentsScreen";
import { AddStudentScreen } from "./AddStudentScreen";
import { StudentDetailScreen } from "./StudentDetailScreen";
import { GradingSessionsScreen } from "./GradingSessionsScreen";
import { CreateGradingSessionScreen } from "./CreateGradingSessionScreen";
import { BuildGradingCohortScreen } from "./BuildGradingCohortScreen";
import { CandidateAssessmentScreen } from "./CandidateAssessmentScreen";
import { AssessmentCompletionScreen } from "./AssessmentCompletionScreen";
import { SyllabusScreen } from "./SyllabusScreen";
import { PromotionLedgerScreen } from "./PromotionLedgerScreen";
import { CohortAdjudicationScreen } from "./CohortAdjudicationScreen";
import { AuditScreen } from "./AuditScreen";

const UsersScreen = lazy(() =>
  import("./UsersScreen").then((module) => ({ default: module.UsersScreen })),
);
const UserDetailScreen = lazy(() =>
  import("./UserDetailScreen").then((module) => ({ default: module.UserDetailScreen })),
);
const GradingSessionDetailScreen = lazy(() =>
  import("./GradingSessionDetailScreen").then((module) => ({
    default: module.GradingSessionDetailScreen,
  })),
);
const SettingsScreen = lazy(() =>
  import("./SettingsScreen").then((module) => ({ default: module.SettingsScreen })),
);
const ImportsHubScreen = lazy(() =>
  import("./ImportsHubScreen").then((module) => ({ default: module.ImportsHubScreen })),
);
const ImportStartScreen = lazy(() =>
  import("./ImportStartScreen").then((module) => ({ default: module.ImportStartScreen })),
);
const ImportScreen = lazy(() =>
  import("./ImportScreen").then((module) => ({ default: module.ImportScreen })),
);
const LinkRecordsScreen = lazy(() =>
  import("./LinkRecordsScreen").then((module) => ({ default: module.LinkRecordsScreen })),
);
const HistoricalRecordsScreen = lazy(() =>
  import("./HistoricalRecordsScreen").then((module) => ({ default: module.HistoricalRecordsScreen })),
);

function UserManagementFallback(): React.ReactElement {
  return <div className="loading-state" role="status">Loading user management…</div>;
}

function ImportFallback(): React.ReactElement {
  return <div className="loading-state" role="status">Loading import…</div>;
}

function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
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
      navigate("/");
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
            <label>
              Email address
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
              <div className="password-field">
                <input
                  autoComplete="current-password"
                  name="password"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                />
                <button
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="password-toggle"
                  onClick={() => setShowPassword((previous) => !previous)}
                  type="button"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <button
              className="primary-button"
              disabled={status === "loading" || isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Signing in" : "Sign in"}
            </button>
          </form>
          <p className="login-help">
            Having trouble signing in? <strong>Contact your administrator.</strong>
          </p>
          <p className="login-security-note">
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

/** The boolean capability flags `/api/auth/me/` reports for the signed-in user. */
type Capability = {
  [K in keyof AuthUser]: AuthUser[K] extends boolean ? K : never;
}[keyof AuthUser];

/** Renders a route only when the server says this user may use it. */
function RequireAccess({ flag, children }: { flag: Capability; children: ReactNode }) {
  const { user } = useAuth();
  if (!user?.[flag]) {
    return <Navigate replace to="/" />;
  }
  return children;
}

function ApplicationShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Every signed-in route uses the club's clock, including when the sidebar
  // is collapsed. Load it before mounting screens that format dates.
  const site = useSiteSettingsQuery();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  if (user === null) {
    return null;
  }

  if (site.isPending) {
    return <LoadingPage />;
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
    <SidebarProvider>
      <div className="app-layout">
        <NavigationRail clubName={site.data?.club_name} isLoggingOut={isLoggingOut} onLogout={handleLogout} user={user} />
        <div className="app-main">
          <DemoBanner />
          {logoutError ? (
            <div className="workspace-alert" role="alert">
              <p className="form-error">{logoutError}</p>
            </div>
          ) : null}

          <main className="workspace">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
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
    return <Navigate replace to="/login" />;
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
function SetupGate({ children }: { children: ReactNode }) {
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

function LoginRoute() {
  const { status, user } = useAuth();

  if (status === "loading") {
    return <LoadingPage />;
  }

  if (status === "error") {
    return <ConnectionErrorPage />;
  }

  if (user !== null) {
    return <Navigate replace to="/" />;
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
          <SetupGate>
            <Routes>
              <Route element={<LoginRoute />} path="/login" />
              <Route
                element={
                  <RequireAuth>
                    <ApplicationShell />
                  </RequireAuth>
                }
              >
                <Route element={<OverviewScreen />} index />
                <Route element={<Navigate replace to="/" />} path="overview" />
                <Route element={<StudentsScreen />} path="students" />
                <Route element={<AddStudentScreen />} path="students/new" />
                <Route element={<Navigate replace to="/imports/new?kind=STUDENT_ROSTER" />} path="students/import" />
                <Route element={<StudentDetailScreen />} path="students/:id" />
                <Route element={<CreateGradingSessionScreen />} path="gradings/new" />
                <Route element={<Navigate replace to="/imports/new?kind=LEGACY_GRADINGS" />} path="gradings/import-legacy" />
                <Route element={<Navigate replace to="/imports/records" />} path="gradings/legacy-records" />
                <Route element={<BuildGradingCohortScreen />} path="gradings/:id/register" />
                <Route element={<CohortAdjudicationScreen />} path="gradings/:id/decisions" />
                <Route element={<PromotionLedgerScreen />} path="gradings/:id/promotions" />
                <Route element={<AssessmentCompletionScreen />} path="gradings/:sessionId/assessments/:candidateId/review" />
                <Route element={<CandidateAssessmentScreen />} path="gradings/:sessionId/assessments/:candidateId" />
                <Route
                  element={
                    <Suspense fallback={<div className="loading-state" role="status">Loading grading session…</div>}>
                      <GradingSessionDetailScreen />
                    </Suspense>
                  }
                  path="gradings/:id"
                />
                <Route element={<GradingSessionsScreen />} path="gradings" />
                <Route element={<SyllabusScreen />} path="syllabus" />
                <Route
                  element={
                    <Suspense fallback={<div className="loading-state" role="status">Loading settings…</div>}>
                      <SettingsScreen />
                    </Suspense>
                  }
                  path="settings/*"
                />
                <Route
                  element={
                    <RequireAccess flag="can_import_data">
                      <Suspense fallback={<ImportFallback />}>
                        <ImportsHubScreen />
                      </Suspense>
                    </RequireAccess>
                  }
                  path="imports"
                />
                <Route
                  element={
                    <RequireAccess flag="can_import_data">
                      <Suspense fallback={<ImportFallback />}>
                        <ImportStartScreen />
                      </Suspense>
                    </RequireAccess>
                  }
                  path="imports/new"
                />
                <Route
                  element={
                    <RequireAccess flag="can_reconcile_imported_history">
                      <Suspense fallback={<ImportFallback />}>
                        <LinkRecordsScreen />
                      </Suspense>
                    </RequireAccess>
                  }
                  path="imports/records"
                />
                <Route
                  element={
                    <RequireAccess flag="can_reconcile_imported_history">
                      <Suspense fallback={<ImportFallback />}>
                        <HistoricalRecordsScreen />
                      </Suspense>
                    </RequireAccess>
                  }
                  path="imports/history/:id?"
                />
                <Route
                  element={
                    <RequireAccess flag="can_import_data">
                      <Suspense fallback={<ImportFallback />}>
                        <ImportScreen />
                      </Suspense>
                    </RequireAccess>
                  }
                  path="imports/:id"
                />
                <Route
                  element={
                    <RequireAccess flag="can_read_audit_log">
                      <AuditScreen />
                    </RequireAccess>
                  }
                  path="audit"
                />
                <Route
                  element={
                    <RequireAccess flag="can_manage_users">
                      <Suspense fallback={<UserManagementFallback />}>
                        <UsersScreen />
                      </Suspense>
                    </RequireAccess>
                  }
                  path="users"
                />
                <Route
                  element={
                    <RequireAccess flag="can_manage_users">
                      <Suspense fallback={<UserManagementFallback />}>
                        <UserDetailScreen />
                      </Suspense>
                    </RequireAccess>
                  }
                  path="users/:id"
                />
                <Route element={<Navigate replace to="/" />} path="*" />
              </Route>
            </Routes>
          </SetupGate>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
