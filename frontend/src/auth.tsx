import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ApiError,
  type AuthUser,
  changePassword as changePasswordApi,
  getCurrentUser,
  loginUser,
  logoutUser,
  updateCurrentUser,
} from "./api";

type AuthStatus = "loading" | "authenticated" | "anonymous" | "error";

type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus;
  /** Set only while status is "error"; safe to show to the viewer. */
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  updateName: (firstName: string, lastName: string) => Promise<void>;
  /** Re-run the session check after a transport failure. */
  retry: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const CURRENT_USER_QUERY_KEY = ["currentUser"] as const;

// Per-device, not per-account: lets the login screen say "Welcome back"
// instead of "Sign in" once this browser has ever seen a signed-in session,
// without needing to know who is about to sign in.
const HAS_SIGNED_IN_STORAGE_KEY = "kukgrade-has-signed-in";

// eslint-disable-next-line react-refresh/only-export-components
export function hasSignedInBefore(): boolean {
  try {
    return window.localStorage.getItem(HAS_SIGNED_IN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

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

  // Ending a session drops everything fetched under it, so the next person
  // on this browser never sees the previous person's students or gradings.
  const forgetSession = useCallback(() => {
    queryClient.setQueryData(CURRENT_USER_QUERY_KEY, null);
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== CURRENT_USER_QUERY_KEY[0],
    });
  }, [queryClient]);

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
    onSuccess: forgetSession,
  });

  const changePasswordMutation = useMutation({
    mutationFn: ({
      currentPassword,
      newPassword,
    }: {
      currentPassword: string;
      newPassword: string;
    }) => changePasswordApi(currentPassword, newPassword),
    onSuccess: async () => {
      await currentUserQuery.refetch();
    },
  });

  const updateNameMutation = useMutation({
    mutationFn: ({ firstName, lastName }: { firstName: string; lastName: string }) =>
      updateCurrentUser({ first_name: firstName, last_name: lastName }),
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(CURRENT_USER_QUERY_KEY, updatedUser);
    },
  });

  // A session that expired - two hours without a request - answers every
  // call with "not signed in". Whichever request hears it first signs the
  // viewer out here, so the next action lands on sign-in rather than an
  // error on whatever screen was open.
  useEffect(() => {
    function signOutIfSessionEnded(error: unknown) {
      if (isAnonymousResponse(error)) {
        forgetSession();
      }
    }
    const stopQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") {
        signOutIfSessionEnded(event.action.error);
      }
    });
    const stopMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") {
        signOutIfSessionEnded(event.action.error);
      }
    });
    return () => {
      stopQueries();
      stopMutations();
    };
  }, [queryClient, forgetSession]);

  const user = currentUserQuery.data ?? null;

  useEffect(() => {
    if (user === null) {
      return;
    }
    try {
      window.localStorage.setItem(HAS_SIGNED_IN_STORAGE_KEY, "true");
    } catch {
      // Private browsing or a blocked store just means the login screen
      // says "Sign in" every time instead of "Welcome back" - not worth
      // surfacing to the viewer.
    }
  }, [user]);

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

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await changePasswordMutation.mutateAsync({ currentPassword, newPassword });
    },
    [changePasswordMutation],
  );

  const updateName = useCallback(
    async (firstName: string, lastName: string) => {
      await updateNameMutation.mutateAsync({ firstName, lastName });
    },
    [updateNameMutation],
  );

  const value = useMemo(
    () => ({ user, status, error, login, logout, changePassword, updateName, retry }),
    [changePassword, error, login, logout, retry, status, updateName, user],
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
