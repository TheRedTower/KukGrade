import type { AuthUser } from "./api";

/**
 * Whether to offer the audit log. Mirrors the backend's `can_view_audit_log`
 * (accounts/permissions.py); the API enforces it regardless.
 */
export function canViewAuditLog(user: AuthUser): boolean {
  return (
    user.role === "administrator" ||
    user.can_make_final_grading_decision ||
    user.can_view_grading_audit_log
  );
}
