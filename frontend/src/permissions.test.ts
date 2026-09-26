import type { AuthUser } from "./api";
import { canViewAuditLog, isAdministrator } from "./permissions";

const instructor: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "instructor@example.com",
  first_name: "Ina",
  last_name: "Structor",
  full_name: "Ina Structor",
  role: "instructor",
  role_display: "Instructor",
  can_make_final_grading_decision: false,
  can_promote_student: false,
  can_override_locked_session: false,
  can_view_grading_audit_log: false,
  must_change_password: false,
  is_staff: false,
  is_superuser: false,
};

describe("isAdministrator", () => {
  it("reads the role, and is false without a user", () => {
    expect(isAdministrator({ ...instructor, role: "administrator" })).toBe(true);
    expect(isAdministrator(instructor)).toBe(false);
    expect(isAdministrator(null)).toBe(false);
  });
});

describe("canViewAuditLog", () => {
  it("mirrors the backend rule", () => {
    expect(canViewAuditLog({ ...instructor, role: "administrator" })).toBe(true);
    expect(canViewAuditLog({ ...instructor, can_make_final_grading_decision: true })).toBe(true);
    expect(canViewAuditLog({ ...instructor, can_view_grading_audit_log: true })).toBe(true);
    expect(canViewAuditLog({ ...instructor, is_staff: true, is_superuser: true })).toBe(false);
    expect(canViewAuditLog(undefined)).toBe(false);
  });
});
