import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

const CURRENT_USER_QUERY_KEY = ["currentUser"] as const;

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
  const queryClient = useQueryClient();

  const currentUserQuery = useQuery({
    queryKey: CURRENT_USER_QUERY_KEY,
    queryFn: getCurrentUser,
  });

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      loginUser(email, password),
    onSuccess: (authenticatedUser) => {
      queryClient.setQueryData(CURRENT_USER_QUERY_KEY, authenticatedUser);
    },
  });

  // The cache is only cleared once the server has actually ended the
  // session (onSuccess) - clearing it after a failed request would show a
  // signed-out UI while the session cookie was still valid.
  const logoutMutation = useMutation({
    mutationFn: logoutUser,
    onSuccess: () => {
      queryClient.setQueryData(CURRENT_USER_QUERY_KEY, null);
    },
  });

  const user = currentUserQuery.data ?? null;

  // Fetching covers both the initial load and a retry, so both read as
  // "loading" without a separate attempt counter. A query in flight always
  // takes priority over its previous result or error.
  let status: AuthStatus;
  if (currentUserQuery.isFetching) {
    status = "loading";
  } else if (currentUserQuery.isError) {
    status = isAnonymousResponse(currentUserQuery.error) ? "anonymous" : "error";
  } else if (user === null) {
    // A successful fetch that resolved to no user - true after logout.
    status = "anonymous";
  } else {
    status = "authenticated";
  }

  const error =
    status === "error" ? describeAuthFailure(currentUserQuery.error) : null;

  const refetchCurrentUser = currentUserQuery.refetch;
  const retry = useCallback(() => {
    void refetchCurrentUser();
  }, [refetchCurrentUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      await loginMutation.mutateAsync({ email, password });
    },
    [loginMutation],
  );

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

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
