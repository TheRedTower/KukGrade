# Permissions

## Confirmed Requirements

- Supported roles are Instructor, Manager, Administrator, and authorised Master.
- Permissions must be enforced by the backend.
- Frontend hiding or disabling controls is not sufficient.
- Apply least privilege throughout the API and UI.
- Sensitive changes must be auditable.
- Students do not directly access the system.

## Implemented Capability Map

Accepted 2026-09-13, implemented in `accounts/groups.py`. Django permissions
are the authority primitive; `User.role` is a label that decides group
membership and is never consulted when authorising a request.

| Capability | Instructor | Administrator | Master |
| --- | --- | --- | --- |
| Read ranks and syllabus | Yes | Yes | via group |
| Students: view, add, change | Yes | Yes | via group |
| Grading sessions: full CRUD | Yes | Yes | via group |
| Candidates: full CRUD | Yes | Yes | via group |
| Assessments and item results | Yes | Yes | via group |
| Propose or revise an outcome | Yes | Yes | via group |
| **Final grading decision** | No | No | **Yes** |
| **Promote a student** | No | No | **Yes** |
| Manage users and roles | No | Yes | via group |

"Master" is not a group. `gradings.can_make_final_grading_decision` and
`gradings.can_promote_student` are granted per user, independently of role, so
authority survives one person being unavailable and never arrives as a side
effect of a role change. The two are separate: holding one does not confer the
other.

`manager` was removed from `User.Role` in 2026-09. Nothing used it.

Syllabus authoring is granted with syllabus versioning in Phase 2b; the
catalogue is read-only until then.

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
