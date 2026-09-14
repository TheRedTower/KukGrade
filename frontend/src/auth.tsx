import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  ApiError,
  type AuthUser,
  getCurrentUser,
  loginUser,
  logoutUser,
} from "./api";

type AuthStatus = "loading" | "authenticated" | "anonymous" | "error";

type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus;
  /** Set only while status is "error"; safe to show to the viewer. */
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-run the session check after a transport failure. */
  retry: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Only a genuine "you are not signed in" answer from the server counts as
 * anonymous. A dropped connection, a 5xx, or a CORS rejection is not
 * evidence about the viewer's session, and treating it as one signed people
 * out mid-grading.
 */
function isAnonymousResponse(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 401 ||
      (error.status === 403 && error.code === "authentication_required"))
  );
}

function describeAuthFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      return "KukGrade is not responding. Your session is unaffected - try again in a moment.";
    }
    return error.message;
  }
  return "KukGrade could not be reached. Check your connection and try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isCurrent = true;

    async function loadUser() {
      try {
        const currentUser = await getCurrentUser();
        if (!isCurrent) {
          return;
        }
        setUser(currentUser);
        setStatus("authenticated");
      } catch (caught) {
        if (!isCurrent) {
          return;
        }
        setUser(null);
        if (isAnonymousResponse(caught)) {
          setStatus("anonymous");
          return;
        }
        setStatus("error");
        setError(describeAuthFailure(caught));
      }
    }

    void loadUser();

    return () => {
      isCurrent = false;
    };
  }, [attempt]);

  // Resets to loading here rather than in the effect: the initial state is
  // already "loading", and setting state synchronously inside an effect body
  // triggers cascading renders.
  const retry = useCallback(() => {
    setStatus("loading");
    setError(null);
    setAttempt((previous) => previous + 1);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const authenticatedUser = await loginUser(email, password);
    setUser(authenticatedUser);
    setError(null);
    setStatus("authenticated");
  }, []);

  // Local state is cleared only once the server has actually ended the
  // session. Clearing it after a failed request would show a signed-out UI
  // while the session cookie was still valid.
  const logout = useCallback(async () => {
    await logoutUser();
    setUser(null);
    setError(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo(
    () => ({ user, status, error, login, logout, retry }),
    [error, login, logout, retry, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === undefined) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return value;
}
