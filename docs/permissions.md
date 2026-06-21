# Permissions

## Confirmed Requirements

- Supported roles are Instructor, Manager, Administrator, and authorised Master.
- Permissions must be enforced by the backend.
- Frontend hiding or disabling controls is not sufficient.
- Apply least privilege throughout the API and UI.
- Sensitive changes must be auditable.
- Students do not directly access the system.

## Proposed Role Capabilities

These capabilities are proposed starting points and must be validated before implementation.

| Capability | Instructor | Manager | Administrator | Authorised Master |
| --- | --- | --- | --- | --- |
| View assigned or branch students | Proposed | Proposed | Proposed | Proposed |
| Edit student profile details | Unresolved | Proposed | Proposed | Unresolved |
| Create grading sessions | Unresolved | Proposed | Proposed | Unresolved |
| Assign candidates | Unresolved | Proposed | Proposed | Unresolved |
| Enter draft assessments | Proposed | Unresolved | Unresolved | Proposed |
| Submit assessments | Proposed | Unresolved | Unresolved | Proposed |
| Make final decisions | Not permitted | Not permitted | Not permitted unless also authorised Master | Confirmed |
| Manage syllabus versions | Unresolved | Unresolved | Proposed | Unresolved |
| Manage users and roles | Unresolved | Unresolved | Proposed | Unresolved |
| View audit events | Unresolved | Unresolved | Proposed | Unresolved |

Do not implement this table as final policy without confirmation.

## Backend Enforcement

The DRF API should enforce:

- authentication for all application endpoints except explicitly public health checks.
- role-based permissions for create, update, delete, decision, and audit endpoints.
- object-level permissions for branch-scoped or session-scoped data.
- immutable or locked states for submitted assessments and finalised decisions.
- audit creation for sensitive writes.
- final-decision endpoints restricted to authorised Masters.
- syllabus-version mutation restricted to confirmed administrative roles and protected by audit logging.

Frontend controls should reflect backend permissions but must not be the enforcement boundary.

## Audit Requirements

Audit events should capture at least:

- actor.
- action.
- entity type and identifier.
- timestamp.
- summary.
- relevant metadata, avoiding unnecessary personal data duplication.

Actions requiring audit include syllabus changes, permission changes, final decisions, overrides, rank changes, student status changes, and changes to submitted or finalised grading records.

## Privacy Rules

- Student details, attendance, grading comments, and outcomes are personal data.
- Development data must be anonymised or synthetic.
- Access should be limited to users with a real operational need.
- Assessment comments, grading outcomes, student status, and audit logs need stricter access than general reference data.

## Unresolved Decisions

- Exact branch or organisation scoping rules for each role.
- Whether Manager is a branch-scoped operational role, an organisation-wide role, or both.
- Whether authorised Master is a role, a permission, or a designation attached to a user.
- Whether instructors can edit student profiles or only view and assess.
- Audit retention period and export policy.
