import {
  FormEvent,
  lazy,
  ReactNode,
  Suspense,
  useState,
  type CSSProperties,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from "react-router-dom";


import "./theme.css";
import "./App.css";
import { ApiError, type AuthUser } from "./api";
import { AuthProvider, hasSignedInBefore, useAuth } from "./auth";
import {
  AuditIcon,
  GradingsIcon,
  OverviewIcon,
  StudentsIcon,
  SyllabusIcon,
  UsersIcon,
} from "./NavIcons";
import { MonitorIcon, MoonIcon, SunIcon } from "./ThemeIcons";
import { ProfileMenu } from "./ProfileMenu";
import { MustChangePassword } from "./MustChangePassword";
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
import { AuditScreen } from "./AuditScreen";
import { useTheme, type ThemePreference } from "./useTheme";

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
const ImportStudentsScreen = lazy(() =>
  import("./ImportStudentsScreen").then((module) => ({
    default: module.ImportStudentsScreen,
  })),
);
const ImportLegacyGradingsScreen = lazy(() =>
  import("./ImportLegacyGradingsScreen").then((module) => ({
    default: module.ImportLegacyGradingsScreen,
  })),
);
const LegacyReconciliationScreen = lazy(() =>
  import("./LegacyReconciliationScreen").then((module) => ({
    default: module.LegacyReconciliationScreen,
  })),
);

function UserManagementFallback(): React.ReactElement {
  return <div className="loading-state" role="status">Loading user management…</div>;
}

function ImportStudentsFallback(): React.ReactElement {
  return <div className="loading-state" role="status">Loading import…</div>;
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  { value: "light", label: "Light", icon: <SunIcon /> },
  { value: "system", label: "System", icon: <MonitorIcon /> },
  { value: "dark", label: "Dark", icon: <MoonIcon /> },
];

function ThemeToggle() {
  const { preference, setTheme } = useTheme();
  const activeIndex = THEME_OPTIONS.findIndex((option) => option.value === preference);

  return (
    <div aria-label="Theme" className="theme-toggle" role="group">
      <div
        className="theme-toggle-track"
        style={{ "--theme-toggle-active-index": String(activeIndex) } as CSSProperties}
      >
        <div aria-hidden className="theme-toggle-thumb" />
        {THEME_OPTIONS.map((option) => (
          <button
            aria-pressed={preference === option.value}
            className="theme-toggle-option"
            key={option.value}
            onClick={() => setTheme(option.value)}
            title={option.label}
            type="button"
          >
            {option.icon}
            <span className="visually-hidden">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LoginBrandPanel() {
  return (
    <aside className="auth-brand">
      <div>
        <p className="auth-wordmark">
          Kuk<span className="auth-wordmark-accent">Grade</span>
        </p>
        <p className="auth-brand-tagline">Staff grading management</p>
        <p className="auth-brand-values">People &middot; Progress &middot; Purpose</p>
      </div>
      <div className="auth-brand-footer">
        <p>Built for instructors.</p>
        <p>Focused on what matters.</p>
      </div>
    </aside>
  );
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
    <main className="login-page">
      <LoginBrandPanel />
      <div className="login-column">
        <div className="theme-toggle-bar">
          <ThemeToggle />
        </div>
        <section className="login-content" aria-labelledby="login-title">
          <h1 id="login-title">{isReturningVisitor ? "Welcome back" : "Sign in"}</h1>
          <p className="login-subtitle">Sign in to KukGrade</p>
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

function NavigationRail({ user }: { user: AuthUser }) {
  const canViewAudit =
    user.role === "administrator" ||
    user.can_make_final_grading_decision ||
    user.can_view_grading_audit_log;
  const canViewUsers = user.role === "administrator";

  return (
    <aside aria-label="Navigation rail" className="nav-rail">
      <div className="nav-brand">
        <p className="nav-wordmark">
          Kuk<span className="nav-wordmark-accent">Grade</span>
        </p>
        <p className="nav-brand-tagline">People &middot; Progress &middot; Purpose</p>
      </div>

      <nav aria-label="Main navigation" className="nav-links">
        <NavLink
          className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          end
          to="/"
        >
          <OverviewIcon />
          <span>Overview</span>
        </NavLink>
        <NavLink
          className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          to="/students"
        >
          <StudentsIcon />
          <span>Students</span>
        </NavLink>
        <NavLink
          className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          to="/gradings"
        >
          <GradingsIcon />
          <span>Gradings</span>
        </NavLink>
        <NavLink
          className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          to="/syllabus"
        >
          <SyllabusIcon />
          <span>Syllabus</span>
        </NavLink>
        {canViewAudit ? (
          <NavLink
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            to="/audit"
          >
            <AuditIcon />
            <span>Audit</span>
          </NavLink>
        ) : null}
        {canViewUsers ? (
          <NavLink
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            to="/users"
          >
            <UsersIcon />
            <span>Users</span>
          </NavLink>
        ) : null}
      </nav>

      <div className="nav-rail-footer">
        <p className="nav-rail-motto">A stronger generation through discipline</p>
        <p className="nav-rail-tag">Staff only</p>
      </div>
    </aside>
  );
}

function OverviewPage() {
  return <OverviewScreen />;
}

function StudentsPage() {
  return <StudentsScreen />;
}

function StudentDetailPage() {
  return <StudentDetailScreen />;
}


function AddStudentPage() {
  return <AddStudentScreen />;
}

function GradingsPage() {
  return <GradingSessionsScreen />;
}

function CreateGradingSessionPage() {
  return <CreateGradingSessionScreen />;
}

function GradingSessionDetailPage() {
  return (
    <Suspense fallback={<div className="loading-state" role="status">Loading grading session…</div>}>
      <GradingSessionDetailScreen />
    </Suspense>
  );
}

function BuildGradingCohortPage() {
  return <BuildGradingCohortScreen />;
}

function PromotionLedgerPage() {
  return <PromotionLedgerScreen />;
}

function CandidateAssessmentPage() {
  return <CandidateAssessmentScreen />;
}

function AssessmentCompletionPage() {
  return <AssessmentCompletionScreen />;
}

function SyllabusPage() {
  return <SyllabusScreen />;
}

function RequireAuditAccess({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (
    !user ||
    (user.role !== "administrator" &&
      !user.can_make_final_grading_decision &&
      !user.can_view_grading_audit_log)
  ) {
    return <Navigate replace to="/" />;
  }
  return children;
}

function RequireAdminAccess({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user || user.role !== "administrator") {
    return <Navigate replace to="/" />;
  }
  return children;
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
    <div className="app-layout">
      <NavigationRail user={user} />
      <div className="app-main">
        <header className="top-bar">
          <div className="location-summary">
            <span className="location-name">Kuk Sool Won Colchester</span>
          </div>
          <div className="top-bar-controls">
            <span aria-label="System status: Online" className="connectivity-badge">
              <span aria-hidden="true" className="status-dot" />
              Online
            </span>
            <ProfileMenu
              isLoggingOut={isLoggingOut}
              onLogout={handleLogout}
              themeToggle={<ThemeToggle />}
              user={user}
            />
          </div>
        </header>

        {logoutError ? (
          <div className="workspace-alert" role="alert">
            <p className="form-error">{logoutError}</p>
          </div>
        ) : null}

        <main className="workspace">
          <Outlet />
        </main>

        <footer className="app-footer">
          <span className="footer-brand">
            Kuk<span className="nav-wordmark-accent">Grade</span>
          </span>
          <span aria-hidden="true" className="footer-separator">
            &middot;
          </span>
          <span className="footer-tagline">
            Trusted by instructors. Built for what matters.
          </span>
          <span className="footer-version">Version 1.0.0</span>
        </footer>
      </div>
    </div>
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
          <Routes>
            <Route element={<LoginRoute />} path="/login" />
            <Route
              element={
                <RequireAuth>
                  <ApplicationShell />
                </RequireAuth>
              }
            >
              <Route element={<OverviewPage />} index />
              <Route element={<Navigate replace to="/" />} path="overview" />
              <Route element={<StudentsPage />} path="students" />
              <Route element={<AddStudentPage />} path="students/new" />
              <Route
                element={
                  <RequireAdminAccess>
                    <Suspense fallback={<ImportStudentsFallback />}>
                      <ImportStudentsScreen />
                    </Suspense>
                  </RequireAdminAccess>
                }
                path="students/import"
              />
              <Route element={<StudentDetailPage />} path="students/:id" />
              <Route element={<CreateGradingSessionPage />} path="gradings/new" />
              <Route
                element={
                  <RequireAdminAccess>
                    <Suspense fallback={<ImportStudentsFallback />}>
                      <ImportLegacyGradingsScreen />
                    </Suspense>
                  </RequireAdminAccess>
                }
                path="gradings/import-legacy"
              />
              <Route
                element={
                  <RequireAdminAccess>
                    <Suspense fallback={<ImportStudentsFallback />}>
                      <LegacyReconciliationScreen />
                    </Suspense>
                  </RequireAdminAccess>
                }
                path="gradings/legacy-records"
              />
              <Route element={<BuildGradingCohortPage />} path="gradings/:id/register" />
              <Route element={<PromotionLedgerPage />} path="gradings/:id/promotions" />
              <Route element={<AssessmentCompletionPage />} path="gradings/:sessionId/assessments/:candidateId/review" />
              <Route element={<CandidateAssessmentPage />} path="gradings/:sessionId/assessments/:candidateId" />
              <Route element={<GradingSessionDetailPage />} path="gradings/:id" />
              <Route element={<GradingsPage />} path="gradings" />
              <Route element={<SyllabusPage />} path="syllabus" />
              <Route
                element={
                  <RequireAuditAccess>
                    <AuditScreen />
                  </RequireAuditAccess>
                }
                path="audit"
              />
              <Route
                element={
                  <RequireAdminAccess>
                    <Suspense fallback={<UserManagementFallback />}>
                      <UsersScreen />
                    </Suspense>
                  </RequireAdminAccess>
                }
                path="users"
              />
              <Route
                element={
                  <RequireAdminAccess>
                    <Suspense fallback={<UserManagementFallback />}>
                      <UserDetailScreen />
                    </Suspense>
                  </RequireAdminAccess>
                }
                path="users/:id"
              />
              <Route element={<Navigate replace to="/" />} path="*" />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
