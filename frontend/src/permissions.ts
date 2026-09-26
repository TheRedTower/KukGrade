import type { AuthUser, UserRole } from "./api";

// Mirrors of backend authority, for deciding what to offer. The API enforces
// every one of them regardless.

/** Whether an account holds the Administrator role. */
export function isAdministrator(user: { role?: UserRole } | null | undefined): boolean {
  return user?.role === "administrator";
}

/** Mirrors `accounts.permissions.can_view_audit_log`. */
export function canViewAuditLog(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  return (
    isAdministrator(user) ||
    user.can_make_final_grading_decision ||
    user.can_view_grading_audit_log
  );
}
