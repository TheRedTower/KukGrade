import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";

import "./theme.css";
import "./layout.css";
import "./controls.css";
import "./App.css";
import { Alert } from "./Alert";
import { AuthProvider, SIGN_OUT_ERROR, useAuth } from "./auth";
import { DemoBanner } from "./DemoSignIn";
import { NavigationRail } from "./NavigationRail";
import { useChoicesQuery, useSiteSettingsQuery } from "./queries";
import { SidebarProvider } from "./useSidebar";
import { ThemeProvider } from "./useTheme";
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
import { UsersScreen } from "./UsersScreen";
import { UserDetailScreen } from "./UserDetailScreen";
import { GradingSessionDetailScreen } from "./GradingSessionDetailScreen";
import { SettingsScreen } from "./SettingsScreen";
import { ImportsHubScreen } from "./ImportsHubScreen";
import { ImportStartScreen } from "./ImportStartScreen";
import { ImportScreen } from "./ImportScreen";
import { LinkRecordsScreen } from "./LinkRecordsScreen";
import { HistoricalRecordsScreen } from "./HistoricalRecordsScreen";
import { LoadingPage, LoginRoute, RequireAccess, RequireAuth, SetupGate } from "./AuthGates";
import { PageTrailProvider } from "./PageTrailProvider";

function ApplicationShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Every signed-in route uses the club's clock, including when the sidebar
  // is collapsed. Load it before mounting screens that format dates, and the
  // served choices before screens that offer them.
  const site = useSiteSettingsQuery();
  const choices = useChoicesQuery();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  if (user === null) {
    return null;
  }

  if (site.isPending || choices.isPending) {
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
      setLogoutError(SIGN_OUT_ERROR);
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <SidebarProvider>
      <div className="app-layout">
        <NavigationRail
          clubName={site.data?.club_name}
          isLoggingOut={isLoggingOut}
          onLogout={handleLogout}
          user={user}
        />
        <div className="app-main">
          <DemoBanner />
          {logoutError ? (
            <div className="workspace-alert">
              <Alert>{logoutError}</Alert>
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

// A fresh client per mount, not a module-level singleton: the app only ever
// mounts once in production, but each test renders its own <App /> and must
// not inherit another test's cached session query.
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A dropped connection or a 403 is meaningful the moment it happens
        // (see isAnonymousResponse in api.ts) - retrying in the background
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
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <PageTrailProvider>
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
                    <Route element={<StudentsScreen />} path="students" />
                    <Route element={<AddStudentScreen />} path="students/new" />
                    <Route element={<StudentDetailScreen />} path="students/:id" />
                    <Route element={<CreateGradingSessionScreen />} path="gradings/new" />
                    <Route element={<BuildGradingCohortScreen />} path="gradings/:id/register" />
                    <Route element={<CohortAdjudicationScreen />} path="gradings/:id/decisions" />
                    <Route element={<PromotionLedgerScreen />} path="gradings/:id/promotions" />
                    <Route
                      element={<AssessmentCompletionScreen />}
                      path="gradings/:sessionId/assessments/:candidateId/review"
                    />
                    <Route
                      element={<CandidateAssessmentScreen />}
                      path="gradings/:sessionId/assessments/:candidateId"
                    />
                    <Route element={<GradingSessionDetailScreen />} path="gradings/:id" />
                    <Route element={<GradingSessionsScreen />} path="gradings" />
                    <Route element={<SyllabusScreen />} path="syllabus" />
                    <Route element={<SettingsScreen />} path="settings/*" />
                    <Route
                      element={
                        <RequireAccess flag="can_import_data">
                          <ImportsHubScreen />
                        </RequireAccess>
                      }
                      path="imports"
                    />
                    <Route
                      element={
                        <RequireAccess flag="can_import_data">
                          <ImportStartScreen />
                        </RequireAccess>
                      }
                      path="imports/new"
                    />
                    <Route
                      element={
                        <RequireAccess flag="can_reconcile_imported_history">
                          <LinkRecordsScreen />
                        </RequireAccess>
                      }
                      path="imports/records"
                    />
                    <Route
                      element={
                        <RequireAccess flag="can_reconcile_imported_history">
                          <HistoricalRecordsScreen />
                        </RequireAccess>
                      }
                      path="imports/history/:id?"
                    />
                    <Route
                      element={
                        <RequireAccess flag="can_import_data">
                          <ImportScreen />
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
                          <UsersScreen />
                        </RequireAccess>
                      }
                      path="users"
                    />
                    <Route
                      element={
                        <RequireAccess flag="can_manage_users">
                          <UserDetailScreen />
                        </RequireAccess>
                      }
                      path="users/:id"
                    />
                    <Route element={<Navigate replace to="/" />} path="*" />
                  </Route>
                </Routes>
              </SetupGate>
            </PageTrailProvider>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
